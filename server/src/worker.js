const { Worker } = require('bullmq');
const OpenAI = require('openai');
const { db, connection } = require('./common');
const { decryptSecret } = require('./security');
const { getOpenAiConfig, calculateCharge, calculateReserve, reserveCredits, refundCredits, settleCredits } = require('./billing');

function selectProducts(products, question) {
  const terms = String(question || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x => x.length >= 2);
  const scored = products.map(p => {
    const hay = `${p.name} ${p.description}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    return { p, score };
  }).sort((a, b) => b.score - a.score);
  const selected = scored.filter(x => x.score > 0).slice(0, 8);
  return (selected.length ? selected : scored.slice(0, 6)).map(x => x.p);
}

async function systemMessage(conversationId, body) {
  await db.message.create({ data: { conversationId, direction: 'system', body } });
}

async function handle({ pageId, senderId, mid, text, demo }) {
  const page = await db.page.findUnique({ where: { pageId }, include: { products: true, owner: { include: { wallet: true } } } });
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

  const history = await db.message.findMany({ where: { conversationId: conversation.id, direction: { in: ['incoming', 'outgoing', 'demo'] } }, orderBy: { createdAt: 'desc' }, take: 10 });
  const products = selectProducts(page.products, text);
  const catalog = products.map(p => `${p.name}: ${p.description}; giá ${p.price == null ? 'chưa có' : p.price + ' VND'}`).join('\n');
  const systemPrompt = `${page.prompt}\nChỉ sử dụng thông tin đã được xác minh. Không bịa giá, tác dụng chữa bệnh hay cam kết giao hàng. Nếu không rõ hãy đề nghị chuyển nhân viên. Trả lời ngắn gọn, phù hợp Messenger.\nSản phẩm liên quan:\n${catalog || '(chưa có dữ liệu)'}`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.reverse().map(m => ({ role: m.direction === 'incoming' ? 'user' : 'assistant', content: m.body })),
  ];
  const promptText = messages.map(m => `${m.role}:${m.content}`).join('\n');
  const reserve = calculateReserve(cfg, promptText);

  const usage = await db.aiUsage.create({
    data: { requestId: String(mid), userId: page.ownerId, pageId: page.id, conversationId: conversation.id, model: cfg.model, reservedCredits: reserve, status: 'RESERVED' },
  });

  try {
    await reserveCredits(page.ownerId, reserve, `ai:${usage.id}:reserve`, `Tạm giữ cho AI - ${page.name}`);
  } catch (e) {
    await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'FAILED', error: e.code === 'INSUFFICIENT_CREDIT' ? 'INSUFFICIENT_CREDIT' : e.message, completedAt: new Date() } });
    if (e.code === 'INSUFFICIENT_CREDIT') await systemMessage(conversation.id, 'AI tạm dừng: tài khoản không đủ tín dụng.');
    else console.error('Reserve credits failed:', e);
    return;
  }

  let reply, inputTokens = 0, outputTokens = 0;
  try {
    const ai = new OpenAI({ apiKey: cfg.apiKey });
    const response = await ai.chat.completions.create({ model: cfg.model, temperature: 0.3, max_tokens: cfg.maxOutputTokens, messages });
    reply = response.choices[0]?.message?.content?.trim() || 'Dạ, em xin chuyển nhân viên hỗ trợ ạ.';
    inputTokens = Number(response.usage?.prompt_tokens || 0);
    outputTokens = Number(response.usage?.completion_tokens || 0);
  } catch (e) {
    await refundCredits(page.ownerId, reserve, `ai:${usage.id}:fail-refund`, 'Hoàn tín dụng do OpenAI lỗi').catch(err => console.error('Refund failed:', err));
    await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'FAILED', error: String(e.message || e).slice(0, 500), completedAt: new Date() } });
    await systemMessage(conversation.id, 'AI gặp lỗi khi tạo câu trả lời; tín dụng đã được hoàn lại.');
    return;
  }

  const priced = calculateCharge(cfg, inputTokens, outputTokens);
  const settled = await settleCredits(page.ownerId, reserve, priced.retailCredits, `ai:${usage.id}`, `AI ${cfg.model} - ${page.name}`);
  await db.aiUsage.update({
    where: { id: usage.id },
    data: { inputTokens, outputTokens, realCostVnd: priced.realCostVnd, retailCredits: settled.charged, error: settled.shortfall ? `Billing shortfall ${settled.shortfall} credits` : null },
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
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pageToken}` }, body: JSON.stringify({ recipient: { id: senderId }, messaging_type: 'RESPONSE', message: { text: reply } }) });
  if (!response.ok) {
    const err = `Meta send error ${response.status}: ${(await response.text()).slice(0, 300)}`;
    await db.message.create({ data: { conversationId: conversation.id, direction: 'failed', body: reply } });
    await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'DELIVERY_FAILED', error: err, completedAt: new Date() } });
    console.error(err); return;
  }

  await db.message.create({ data: { conversationId: conversation.id, direction: 'outgoing', body: reply } });
  await db.aiUsage.update({ where: { id: usage.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
}

const worker = new Worker('messages', async job => handle(job.data), { connection, concurrency: 4 });
worker.on('completed', j => console.log('Processed', j.id));
worker.on('failed', (j, e) => console.error('Worker failed', j?.id, e.message));
console.log('Mộc Tâm AI V2.0 worker ready');
