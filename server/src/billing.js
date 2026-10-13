const { db } = require('./common');
const { decryptSecret } = require('./security');

const DEFAULT_SETTINGS = {
  signup_enabled: 'true',
  signup_bonus: '0',
  openai_model: 'gpt-4.1-mini',
  openai_input_usd_per_million: '0.40',
  openai_output_usd_per_million: '1.60',
  usd_to_vnd: '25910',
  ai_markup: '3.5',
  ai_min_credits: '20',
  ai_max_output_tokens: '400',
  ai_reserve_factor: '1.35',
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
    markup: positiveNumber(s.ai_markup, 3.5),
    minCredits: Math.max(1, Math.ceil(positiveNumber(s.ai_min_credits, 20))),
    maxOutputTokens: Math.max(64, Math.min(2000, Math.ceil(positiveNumber(s.ai_max_output_tokens, 400)))),
    reserveFactor: Math.max(1, positiveNumber(s.ai_reserve_factor, 1.35)),
  };
}

function estimateTokensFromText(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 3.4));
}

function calculateCharge(config, inputTokens, outputTokens) {
  const inputUsd = (Math.max(0, inputTokens) / 1_000_000) * config.inputUsdPerMillion;
  const outputUsd = (Math.max(0, outputTokens) / 1_000_000) * config.outputUsdPerMillion;
  const realCostVnd = (inputUsd + outputUsd) * config.usdToVnd;
  const retailCredits = Math.max(config.minCredits, Math.ceil(realCostVnd * config.markup));
  return { realCostVnd, retailCredits };
}

function calculateReserve(config, promptText) {
  const estimatedInput = estimateTokensFromText(promptText);
  const estimated = calculateCharge(config, estimatedInput, config.maxOutputTokens);
  return Math.max(config.minCredits, Math.ceil(estimated.retailCredits * config.reserveFactor));
}

async function ensureWallet(userId) {
  return db.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
}

async function reserveCredits(userId, amount, reference, description) {
  const reserve = Math.max(1, Math.ceil(Number(amount)));
  return db.$transaction(async tx => {
    await tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    const changed = await tx.wallet.updateMany({
      where: { userId, balance: { gte: reserve } },
      data: { balance: { decrement: reserve }, reserved: { increment: reserve } },
    });
    if (changed.count !== 1) {
      const err = new Error('Không đủ tín dụng');
      err.code = 'INSUFFICIENT_CREDIT';
      throw err;
    }
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    await tx.creditTransaction.create({
      data: { userId, type: 'AI_RESERVE', amount: -reserve, balanceAfter: wallet.balance, reservedAfter: wallet.reserved, reference, description },
    });
    return wallet;
  });
}

async function refundCredits(userId, amount, reference, description) {
  const refund = Math.max(0, Math.ceil(Number(amount)));
  if (!refund) return ensureWallet(userId);
  return db.$transaction(async tx => {
    const current = await tx.wallet.findUnique({ where: { userId } });
    if (!current) throw new Error('Wallet không tồn tại');
    const release = Math.min(refund, current.reserved);
    const wallet = await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: release }, reserved: { decrement: release } },
    });
    await tx.creditTransaction.create({
      data: { userId, type: 'AI_REFUND', amount: release, balanceAfter: wallet.balance, reservedAfter: wallet.reserved, reference, description },
    });
    return wallet;
  });
}

async function settleCredits(userId, reservedAmount, finalCharge, referenceBase, description) {
  const reserved = Math.max(0, Math.ceil(Number(reservedAmount)));
  const target = Math.max(0, Math.ceil(Number(finalCharge)));
  return db.$transaction(async tx => {
    const current = await tx.wallet.findUnique({ where: { userId } });
    if (!current) throw new Error('Wallet không tồn tại');
    const releaseReserved = Math.min(reserved, current.reserved);
    let extra = Math.max(0, target - releaseReserved);
    let actualExtra = 0;
    if (extra > 0) {
      const changed = await tx.wallet.updateMany({
        where: { userId, balance: { gte: extra } },
        data: { balance: { decrement: extra } },
      });
      if (changed.count === 1) actualExtra = extra;
    }
    const refund = Math.max(0, releaseReserved - target);
    let wallet = await tx.wallet.update({
      where: { userId },
      data: { reserved: { decrement: releaseReserved }, balance: refund ? { increment: refund } : undefined },
    });
    if (refund > 0) {
      await tx.creditTransaction.create({ data: { userId, type: 'AI_REFUND', amount: refund, balanceAfter: wallet.balance, reservedAfter: wallet.reserved, reference: `${referenceBase}:refund`, description } });
    }
    if (actualExtra > 0) {
      wallet = await tx.wallet.findUnique({ where: { userId } });
      await tx.creditTransaction.create({ data: { userId, type: 'AI_EXTRA_CHARGE', amount: -actualExtra, balanceAfter: wallet.balance, reservedAfter: wallet.reserved, reference: `${referenceBase}:extra`, description } });
    }
    return { wallet, charged: releaseReserved - refund + actualExtra, shortfall: Math.max(0, target - (releaseReserved - refund + actualExtra)) };
  });
}

async function adjustCredits(userId, amount, type, reference, description) {
  const delta = Math.trunc(Number(amount));
  if (!Number.isFinite(delta) || delta === 0) throw new Error('Số credit không hợp lệ');
  return db.$transaction(async tx => {
    await tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    if (delta < 0) {
      const changed = await tx.wallet.updateMany({ where: { userId, balance: { gte: -delta } }, data: { balance: { increment: delta } } });
      if (changed.count !== 1) throw new Error('Số dư không đủ để trừ');
    } else {
      await tx.wallet.update({ where: { userId }, data: { balance: { increment: delta } } });
    }
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    await tx.creditTransaction.create({ data: { userId, type, amount: delta, balanceAfter: wallet.balance, reservedAfter: wallet.reserved, reference, description } });
    return wallet;
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  ensureDefaultSettings,
  getSettings,
  getOpenAiConfig,
  calculateCharge,
  calculateReserve,
  ensureWallet,
  reserveCredits,
  refundCredits,
  settleCredits,
  adjustCredits,
};
