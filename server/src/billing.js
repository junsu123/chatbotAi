const { db } = require('./common');
const { decryptSecret } = require('./security');

const DEFAULT_SETTINGS = {
  signup_enabled: 'true',
  openai_model: 'gpt-4.1-mini',
  openai_input_usd_per_million: '0.40',
  openai_output_usd_per_million: '1.60',
  usd_to_vnd: '25910',
  ai_max_output_tokens: '400',
  ai_tokens_per_unit: '2500',
  ai_max_units_per_reply: '3',
};

async function ensureDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
}

async function getSettings() {
  const rows = await db.systemSetting.findMany();
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) if (row.value != null) out[row.key] = row.value;
  return out;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function getOpenAiConfig() {
  const rows = await db.systemSetting.findMany();
  const map = new Map(rows.map(r => [r.key, r]));
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.value != null) s[r.key] = r.value;
  const encrypted = map.get('openai_api_key')?.encryptedValue;
  return {
    apiKey: encrypted ? decryptSecret(encrypted) : '',
    model: s.openai_model || 'gpt-4.1-mini',
    inputUsdPerMillion: positiveNumber(s.openai_input_usd_per_million, 0.4),
    outputUsdPerMillion: positiveNumber(s.openai_output_usd_per_million, 1.6),
    usdToVnd: positiveNumber(s.usd_to_vnd, 25910),
    maxOutputTokens: Math.max(64, Math.min(2000, Math.ceil(positiveNumber(s.ai_max_output_tokens, 400)))),
    tokensPerUnit: Math.max(500, Math.min(10000, Math.ceil(positiveNumber(s.ai_tokens_per_unit, 2500)))),
    maxUnitsPerReply: Math.max(1, Math.min(10, Math.ceil(positiveNumber(s.ai_max_units_per_reply, 3)))),
  };
}

function estimateTokensFromText(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 3.4));
}

function calculateRealCost(config, inputTokens, outputTokens) {
  const inputUsd = (Math.max(0, inputTokens) / 1_000_000) * config.inputUsdPerMillion;
  const outputUsd = (Math.max(0, outputTokens) / 1_000_000) * config.outputUsdPerMillion;
  return (inputUsd + outputUsd) * config.usdToVnd;
}

function calculateUnits(config, inputTokens, outputTokens) {
  const total = Math.max(1, Number(inputTokens || 0) + Number(outputTokens || 0));
  return Math.max(1, Math.min(config.maxUnitsPerReply, Math.ceil(total / config.tokensPerUnit)));
}

function calculateReserveUnits(config, promptText) {
  return calculateUnits(config, estimateTokensFromText(promptText), config.maxOutputTokens);
}

function quotaView(subscription) {
  if (!subscription) return { totalUnits: 0, usedUnits: 0, reservedUnits: 0, availableUnits: 0 };
  const totalUnits = Math.max(0, subscription.baseUnits + subscription.addonUnits);
  const usedUnits = Math.max(0, subscription.usedUnits);
  const reservedUnits = Math.max(0, subscription.reservedUnits);
  return { totalUnits, usedUnits, reservedUnits, availableUnits: Math.max(0, totalUnits - usedUnits - reservedUnits) };
}

async function expireOldSubscriptions(userId) {
  await db.subscription.updateMany({
    where: { ...(userId ? { userId } : {}), status: 'ACTIVE', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED', reservedUnits: 0 },
  });
}

async function getActiveSubscription(userId) {
  await expireOldSubscriptions(userId);
  return db.subscription.findFirst({
    where: { userId, status: 'ACTIVE', startedAt: { lte: new Date() }, expiresAt: { gt: new Date() } },
    include: { plan: true },
    orderBy: { startedAt: 'desc' },
  });
}

async function createQuotaTransaction(tx, subscription, type, units, reference, description) {
  const q = quotaView(subscription);
  return tx.quotaTransaction.create({
    data: {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      type,
      units: Math.trunc(units),
      availableAfter: q.availableUnits,
      usedAfter: q.usedUnits,
      reservedAfter: q.reservedUnits,
      reference,
      description,
    },
  });
}

async function reserveUnits(userId, amount, reference, description) {
  const reserve = Math.max(1, Math.ceil(Number(amount)));
  await expireOldSubscriptions(userId);
  return db.$transaction(async tx => {
    const sub = await tx.subscription.findFirst({
      where: { userId, status: 'ACTIVE', startedAt: { lte: new Date() }, expiresAt: { gt: new Date() } },
      orderBy: { startedAt: 'desc' },
    });
    if (!sub) {
      const err = new Error('Không có gói dịch vụ đang hoạt động');
      err.code = 'NO_ACTIVE_SUBSCRIPTION';
      throw err;
    }
    const changed = await tx.$executeRaw`
      UPDATE "Subscription"
      SET "reservedUnits" = "reservedUnits" + ${reserve}, "updatedAt" = NOW()
      WHERE "id" = ${sub.id}
        AND ("baseUnits" + "addonUnits" - "usedUnits" - "reservedUnits") >= ${reserve}
    `;
    if (changed !== 1) {
      const err = new Error('Đã hết lượt AI trong gói');
      err.code = 'INSUFFICIENT_QUOTA';
      throw err;
    }
    const updated = await tx.subscription.findUnique({ where: { id: sub.id } });
    await createQuotaTransaction(tx, updated, 'AI_RESERVE', -reserve, reference, description);
    return updated;
  });
}

async function releaseUnits(userId, subscriptionId, amount, reference, description) {
  const release = Math.max(0, Math.ceil(Number(amount)));
  if (!release) return db.subscription.findUnique({ where: { id: subscriptionId } });
  return db.$transaction(async tx => {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub || sub.userId !== userId) throw new Error('Gói dịch vụ không hợp lệ');
    const actual = Math.min(release, sub.reservedUnits);
    if (!actual) return sub;
    await tx.subscription.update({ where: { id: sub.id }, data: { reservedUnits: { decrement: actual } } });
    const updated = await tx.subscription.findUnique({ where: { id: sub.id } });
    await createQuotaTransaction(tx, updated, 'AI_RELEASE', actual, reference, description);
    return updated;
  });
}

async function settleUnits(userId, subscriptionId, reservedAmount, finalCharge, referenceBase, description) {
  const reserved = Math.max(0, Math.ceil(Number(reservedAmount)));
  const target = Math.max(1, Math.ceil(Number(finalCharge)));
  return db.$transaction(async tx => {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub || sub.userId !== userId) throw new Error('Gói dịch vụ không hợp lệ');
    const releaseReserved = Math.min(reserved, sub.reservedUnits);
    const q = quotaView(sub);
    const extraAvailable = q.availableUnits;
    const charged = Math.min(target, releaseReserved + extraAvailable);
    const shortfall = Math.max(0, target - charged);
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        reservedUnits: { decrement: releaseReserved },
        usedUnits: { increment: charged },
      },
    });
    let updated = await tx.subscription.findUnique({ where: { id: sub.id } });
    if (charged > 0) await createQuotaTransaction(tx, updated, 'AI_CONSUME', -charged, `${referenceBase}:consume`, description);
    const released = Math.max(0, releaseReserved - charged);
    if (released > 0) {
      updated = await tx.subscription.findUnique({ where: { id: sub.id } });
      await createQuotaTransaction(tx, updated, 'AI_RELEASE', released, `${referenceBase}:release`, 'Hoàn phần AI Unit tạm giữ dư');
    }
    return { subscription: updated, charged, shortfall };
  });
}

async function adjustQuota(userId, amount, reference, description) {
  const delta = Math.trunc(Number(amount));
  if (!Number.isFinite(delta) || delta === 0) throw new Error('Số AI Unit không hợp lệ');
  await expireOldSubscriptions(userId);
  return db.$transaction(async tx => {
    const sub = await tx.subscription.findFirst({
      where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      orderBy: { startedAt: 'desc' },
    });
    if (!sub) throw new Error('User chưa có gói dịch vụ đang hoạt động');
    if (delta < 0 && sub.addonUnits < -delta) throw new Error('Chỉ có thể trừ AI Unit bổ sung, không thể trừ quota nền của gói');
    await tx.subscription.update({ where: { id: sub.id }, data: { addonUnits: { increment: delta } } });
    const updated = await tx.subscription.findUnique({ where: { id: sub.id } });
    await createQuotaTransaction(tx, updated, 'ADMIN_ADJUST', delta, reference, description);
    return updated;
  });
}

async function approveServiceOrder(orderId) {
  return db.$transaction(async tx => {
    const order = await tx.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('Không tìm thấy đơn dịch vụ');
    if (order.status === 'PAID') return order;
    if (order.status !== 'PENDING') throw new Error('Đơn không còn ở trạng thái chờ');

    if (order.planType === 'SUBSCRIPTION') {
      await tx.subscription.updateMany({ where: { userId: order.userId, status: 'ACTIVE' }, data: { status: 'CANCELLED', reservedUnits: 0 } });
      const startedAt = new Date();
      const expiresAt = new Date(startedAt.getTime() + Math.max(1, order.durationDays) * 86400000);
      const sub = await tx.subscription.create({
        data: {
          userId: order.userId,
          planId: order.planId,
          planName: order.planName,
          baseUnits: order.units,
          maxPages: order.maxPages,
          startedAt,
          expiresAt,
        },
      });
      await createQuotaTransaction(tx, sub, 'PLAN_GRANT', order.units, `order:${order.id}:plan`, `Kích hoạt gói ${order.planName}`);
      await tx.serviceOrder.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date(), activatedAt: new Date(), subscriptionId: sub.id } });
    } else {
      const sub = await tx.subscription.findFirst({ where: { userId: order.userId, status: 'ACTIVE', expiresAt: { gt: new Date() } }, orderBy: { startedAt: 'desc' } });
      if (!sub) throw new Error('Không thể kích hoạt add-on vì user chưa có gói thuê bao đang hoạt động');
      await tx.subscription.update({ where: { id: sub.id }, data: { addonUnits: { increment: order.units } } });
      const updated = await tx.subscription.findUnique({ where: { id: sub.id } });
      await createQuotaTransaction(tx, updated, 'ADDON_GRANT', order.units, `order:${order.id}:addon`, `Mua add-on ${order.planName}`);
      await tx.serviceOrder.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date(), activatedAt: new Date(), subscriptionId: sub.id } });
    }
    return tx.serviceOrder.findUnique({ where: { id: order.id }, include: { plan: true, subscription: true } });
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  ensureDefaultSettings,
  getSettings,
  getOpenAiConfig,
  estimateTokensFromText,
  calculateRealCost,
  calculateUnits,
  calculateReserveUnits,
  quotaView,
  expireOldSubscriptions,
  getActiveSubscription,
  reserveUnits,
  releaseUnits,
  settleUnits,
  adjustQuota,
  approveServiceOrder,
};
