const { Worker } = require('bullmq');
const OpenAI = require('openai');
const { db, connection } = require('./common');
const { decryptSecret } = require('./security');
const {
  getOpenAiConfig,
  calculateRealCost,
  calculateUnits,
  calculateReserveUnits,
  reserveUnits,
  releaseUnits,
  settleUnits,
} = require('./billing');

function selectProducts(products, question) {
  const terms = String(question || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x => x.length >= 2);
  const scored = products.map(p => {
    const hay = `${p.name} ${p.description}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    return { p, score };
  }).sort((a, b) => b.score - a.score);
  const selected = scored.filter(x => x.score > 0).slice(0, 6);
  return (selected.length ? selected : scored.slice(0, 5)).map(x => x.p);
}

async function systemMessage(conversationId, body) {
  await db.message.create({ data: { conversationId, direction: 'system', body } });
}

async function handle({ pageId, senderId, mid, text, demo }) {
  const page = await db.page.findUnique({ where: { pageId }, include: { products: true, owner: true } });
  if (!page) { console.warn('Page not found', pageId); return; }
  if (!page.owner) { console.warn('Page has no owner', pageId); return; }

  const conversation = await db.conversation.upsert({
    where: { pageId_senderId: { pageId: page.id, senderId } },
    create: { pageId: page.id, senderId }, update: {},
  });

  let incoming = await db.message.findUnique({ where: { metaId: mid } });
  if (!incoming) incoming = await db.message.create({ data: { conversationId: conversation.id, metaId: mid, direction: 'incoming', body: text } });

  if (!page.enabled || !conversation.enabled || conversation.handoff || page.owner.status !== 'ACTIVE') return;
  if (await db.aiUsage.findUnique({ where: { requestId: String(mid) } })) return;

  if (!demo && !(page.tokenEncrypted || page.token)) {
    await systemMessage(conversation.id, 'AI chưa gửi: Fanpage chưa có Page Access Token.');
    return;
  }

  const cfg = await getOpenAiConfig();
  if (!cfg.apiKey) {
    await systemMessage(conversation.id, 'AI tạm dừng: Super Admin chưa cấu hình OpenAI API Key.');
    return;
  }

  const history = await db.message.findMany({
    where: { conversationId: conversation.id, direction: { in: ['incoming', 'outgoing', 'demo'] } },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  const products = selectProducts(page.products, text);
  const catalog = products.map(p => `${p.name}: ${String(p.description || '').slice(0, 1200)}; giá ${p.price == null ? 'chưa có' : p.price + ' VND'}`).join('\n');
  const systemPrompt = `${String(page.prompt || '').slice(0, 6000)}\nChỉ sử dụng thông tin đã được xác minh. Không bịa giá, tác dụng chữa bệnh hay cam kết giao hàng. Nếu không rõ hãy đề nghị chuyển nhân viên. Trả lời ngắn gọn, phù hợp Messenger.\nSản phẩm liên quan:\n${catalog || '(chưa có dữ liệu)'}`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.reverse().map(m => ({ role: m.direction === 'incoming' ? 'user' : 'assistant', content: String(m.body || '').slice(0, 1600) })),
  ];
  const promptText = messages.map(m => `${m.role}:${m.content}`).join('\n');
  const estimatedUnits = calculateReserveUnits(cfg, promptText);
  const isAdmin = page.owner.role === 'SUPER_ADMIN';

  const usage = await db.aiUsage.create({
    data: {
      requestId: String(mid),
      userId: page.ownerId,
      pageId: page.id,
      conversationId: conversation.id,
      model: cfg.model,
      reservedUnits: isAdmin ? 0 : estimatedUnits,
      status: 'RESERVED',
    },
  });

  let subscriptionId = null;
  if (!isAdmin) {
    try {
      const sub = await reserveUnits(page.ownerId, estimatedUnits, `ai:${usage.id}:reserve`, `Tạm giữ AI Unit - ${page.name}`);
      subscriptionId = sub.id;
      await db.aiUsage.update({ where: { id: usage.id }, data: { subscriptionId } });
    } catch (e) {
      const reason = e.code === 'NO_ACTIVE_SUBSCRIPTION' ? 'NO_ACTIVE_SUBSCRIPTION' : e.code === 'INSUFFICIENT_QUOTA' ? 'INSUFFICIENT_QUOTA' : String(e.message || e);
      await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'FAILED', error: reason, completedAt: new Date() } });
      if (e.code === 'NO_ACTIVE_SUBSCRIPTION') await systemMessage(conversation.id, 'AI tạm dừng: tài khoản chưa có gói dịch vụ đang hoạt động.');
      else if (e.code === 'INSUFFICIENT_QUOTA') await systemMessage(conversation.id, 'AI tạm dừng: gói dịch vụ đã hết lượt AI. Vui lòng mua add-on hoặc gia hạn gói.');
      else console.error('Reserve quota failed:', e);
      return;
    }
  }

  let reply, inputTokens = 0, outputTokens = 0;
  try {
    const ai = new OpenAI({ apiKey: cfg.apiKey });
    const response = await ai.chat.completions.create({ model: cfg.model, temperature: 0.3, max_tokens: cfg.maxOutputTokens, messages });
    reply = response.choices[0]?.message?.content?.trim() || 'Dạ, em xin chuyển nhân viên hỗ trợ ạ.';
    inputTokens = Number(response.usage?.prompt_tokens || 0);
    outputTokens = Number(response.usage?.completion_tokens || 0);
  } catch (e) {
    if (!isAdmin && subscriptionId) {
      await releaseUnits(page.ownerId, subscriptionId, estimatedUnits, `ai:${usage.id}:fail-release`, 'Hoàn AI Unit do OpenAI lỗi').catch(err => console.error('Quota release failed:', err));
    }
    await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'FAILED', error: String(e.message || e).slice(0, 500), completedAt: new Date() } });
    await systemMessage(conversation.id, 'AI gặp lỗi khi tạo câu trả lời; lượt AI tạm giữ đã được hoàn lại.');
    return;
  }

  const realCostVnd = calculateRealCost(cfg, inputTokens, outputTokens);
  const finalUnits = calculateUnits(cfg, inputTokens, outputTokens);
  let charged = 0, shortfall = 0;
  if (!isAdmin) {
    const settled = await settleUnits(page.ownerId, subscriptionId, estimatedUnits, finalUnits, `ai:${usage.id}`, `AI ${cfg.model} - ${page.name}`);
    charged = settled.charged;
    shortfall = settled.shortfall;
  }

  await db.aiUsage.update({
    where: { id: usage.id },
    data: {
      inputTokens,
      outputTokens,
      realCostVnd,
      unitsCharged: charged,
      error: shortfall ? `Quota shortfall ${shortfall} unit(s)` : null,
    },
  });

  const current = await db.conversation.findUnique({ where: { id: conversation.id } });
  const currentPage = await db.page.findUnique({ where: { id: page.id } });
  if (!current?.enabled || current.handoff || !currentPage?.enabled) {
    await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    return;
  }

  if (demo) {
    await db.message.create({ data: { conversationId: conversation.id, direction: 'demo', body: reply } });
    await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    return;
  }

  let pageToken = '';
  try { pageToken = currentPage.tokenEncrypted ? decryptSecret(currentPage.tokenEncrypted) : String(currentPage.token || ''); }
  catch (e) {
    await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'DELIVERY_FAILED', error: `Token decrypt: ${e.message}`, completedAt: new Date() } });
    await systemMessage(conversation.id, 'AI đã tạo trả lời nhưng không giải mã được Page Token.');
    return;
  }

  const url = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/me/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pageToken}` },
    body: JSON.stringify({ recipient: { id: senderId }, messaging_type: 'RESPONSE', message: { text: reply } }),
  });
  if (!response.ok) {
    const err = `Meta send error ${response.status}: ${(await response.text()).slice(0, 300)}`;
    await db.message.create({ data: { conversationId: conversation.id, direction: 'failed', body: reply } });
    await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'DELIVERY_FAILED', error: err, completedAt: new Date() } });
    console.error(err);
    return;
  }

  await db.message.create({ data: { conversationId: conversation.id, direction: 'outgoing', body: reply } });
  await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
}

const worker = new Worker('messages', async job => handle(job.data), { connection, concurrency: 4 });
worker.on('completed', j => console.log('Processed', j.id));
worker.on('failed', (j, e) => console.error('Worker failed', j?.id, e.message));
console.log('Mộc Tâm AI V2.1 worker ready');
