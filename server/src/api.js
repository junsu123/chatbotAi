const express = require('express');
const crypto = require('node:crypto');
const OpenAI = require('openai');
const { db, queue } = require('./common');
const {
  SESSION_COOKIE, normalizeEmail, hashPassword, verifyPassword, encryptSecret,
  newSessionToken, hashSessionToken, parseCookies, setSessionCookie, clearSessionCookie,
} = require('./security');
const { ensureDefaultSettings, getSettings, getOpenAiConfig, ensureWallet, adjustCredits } = require('./billing');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb', verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));

const allowedOrigins = new Set(String(process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map(x => x.trim()).filter(Boolean));
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const fail = (res, e, status = 400) => { console.error(e); res.status(status).json({ error: e.message || 'Request failed' }); };
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => fail(res, e));
const graphVersion = () => process.env.META_GRAPH_VERSION || 'v23.0';
const appSecretProof = token => crypto.createHmac('sha256', process.env.META_APP_SECRET || '').update(token).digest('hex');

async function auth(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return res.status(401).json({ error: 'Bạn chưa đăng nhập' });
    const session = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: { include: { wallet: true } } },
    });
    if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
      if (session) await db.session.delete({ where: { id: session.id } }).catch(() => {});
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
    }
    req.user = session.user;
    req.session = session;
    if (Date.now() - session.lastSeenAt.getTime() > 10 * 60 * 1000) db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    next();
  } catch (e) { fail(res, e, 401); }
}

function superAdmin(req, res, next) {
  if (req.user?.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Chỉ Super Admin được phép thực hiện thao tác này' });
  next();
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status, wallet: user.wallet || null };
}

async function createSession(res, userId) {
  const token = newSessionToken();
  const days = Math.max(1, Number(process.env.SESSION_DAYS || 30));
  await db.session.create({ data: { tokenHash: hashSessionToken(token), userId, expiresAt: new Date(Date.now() + days * 86400000) } });
  setSessionCookie(res, token);
}

async function graphJson(url, options) {
  const r = await fetch(url, options);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok || body?.error) throw new Error(body?.error?.message || `Meta API ${r.status}`);
  return body;
}

function oauthStateSecret() { return String(process.env.META_OAUTH_STATE_SECRET || ''); }
function makeOauthState(userId) {
  const secret = oauthStateSecret();
  if (!secret || secret.startsWith('CHANGE_')) throw new Error('Chưa cấu hình META_OAUTH_STATE_SECRET');
  const payload = `${Date.now()}.${userId}.${crypto.randomBytes(16).toString('hex')}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}
function verifyOauthState(value) {
  try {
    const raw = Buffer.from(String(value || ''), 'base64url').toString('utf8');
    const [ts, userId, nonce, sig] = raw.split('.');
    if (!ts || !userId || !nonce || !sig) return null;
    const age = Date.now() - Number(ts);
    if (!Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) return null;
    const payload = `${ts}.${userId}.${nonce}`;
    const expected = crypto.createHmac('sha256', oauthStateSecret()).update(payload).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return userId;
  } catch { return null; }
}

async function exchangeForLongLivedUserToken(shortToken) {
  try {
    const u = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
    u.searchParams.set('grant_type', 'fb_exchange_token');
    u.searchParams.set('client_id', process.env.META_APP_ID || '');
    u.searchParams.set('client_secret', process.env.META_APP_SECRET || '');
    u.searchParams.set('fb_exchange_token', shortToken);
    const out = await graphJson(u);
    return out.access_token || shortToken;
  } catch (e) { console.warn('Long-lived token exchange skipped:', e.message); return shortToken; }
}

async function fetchManagedPages(userToken) {
  let url = new URL(`https://graph.facebook.com/${graphVersion()}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token,tasks');
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', userToken);
  url.searchParams.set('appsecret_proof', appSecretProof(userToken));
  const pages = [];
  for (let i = 0; i < 5 && url; i++) {
    const out = await graphJson(url);
    for (const p of out.data || []) if (p?.id && p?.name && p?.access_token) pages.push(p);
    url = out.paging?.next ? new URL(out.paging.next) : null;
  }
  return pages;
}

async function subscribePage(page) {
  try {
    const u = new URL(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(page.id)}/subscribed_apps`);
    const body = new URLSearchParams({ subscribed_fields: 'messages,messaging_postbacks', access_token: page.access_token, appsecret_proof: appSecretProof(page.access_token) });
    await graphJson(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    return true;
  } catch (e) { console.warn(`Could not subscribe page ${page.id}:`, e.message); return false; }
}

function oauthResultHtml({ ok, count = 0, skipped = 0, error = '' }) {
  const target = (process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGIN || 'http://localhost:3000').split(',')[0].replace(/\/$/, '');
  const message = ok ? `Đã kết nối ${count} Fanpage${skipped ? `, bỏ qua ${skipped} Page đang thuộc tài khoản khác` : ''}.` : `Không thể kết nối Facebook: ${error}`;
  const safe = message.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Mộc Tâm AI</title><style>body{font:16px system-ui;padding:32px;max-width:680px;margin:auto;color:#172033}.ok{color:#087a45}.err{color:#b42318}</style></head><body><h1 class="${ok ? 'ok' : 'err'}">${ok ? 'Kết nối thành công' : 'Kết nối thất bại'}</h1><p>${safe}</p><p>Bạn có thể đóng cửa sổ này.</p><script>try{if(window.opener){window.opener.postMessage(${JSON.stringify({ type: 'moc-facebook-connected', ok, count, skipped, error })},${JSON.stringify(target)});setTimeout(()=>window.close(),700)}}catch(e){}</script></body></html>`;
}

async function ownedPage(id, user) {
  const page = await db.page.findUnique({ where: { id } });
  if (!page || (user.role !== 'SUPER_ADMIN' && page.ownerId !== user.id)) return null;
  return page;
}
function tenantWhere(user) { return user.role === 'SUPER_ADMIN' ? {} : { ownerId: user.id }; }
function conversationWhere(user) { return user.role === 'SUPER_ADMIN' ? {} : { page: { ownerId: user.id } }; }
function productWhere(user) { return user.role === 'SUPER_ADMIN' ? {} : { page: { ownerId: user.id } }; }

app.get('/health', (req, res) => res.json({ ok: true, service: 'moc-tam-ai-api', version: '2.0.0' }));

app.get('/webhook', (req, res) => {
  const q = req.query;
  if (q['hub.mode'] === 'subscribe' && process.env.META_VERIFY_TOKEN && q['hub.verify_token'] === process.env.META_VERIFY_TOKEN) return res.status(200).send(String(q['hub.challenge'] || ''));
  res.sendStatus(403);
});

app.post('/webhook', wrap(async (req, res) => {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return res.sendStatus(503);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.alloc(0)).digest('hex');
  const actual = req.get('X-Hub-Signature-256') || '';
  if (actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return res.sendStatus(403);
  if (req.body?.object === 'page') for (const entry of req.body.entry || []) for (const evt of entry.messaging || []) {
    const m = evt.message;
    if (!m?.mid || m.is_echo || typeof m.text !== 'string' || !evt.sender?.id || !evt.recipient?.id) continue;
    await queue.add('incoming', { pageId: String(evt.recipient.id), senderId: String(evt.sender.id), mid: String(m.mid), text: m.text, demo: false }, { jobId: 'in-' + crypto.createHash('sha256').update(String(m.mid)).digest('hex'), attempts: 1, removeOnComplete: 1000 });
  }
  res.send('EVENT_RECEIVED');
}));

app.post('/auth/register', wrap(async (req, res) => {
  const settings = await getSettings();
  if (settings.signup_enabled !== 'true') return res.status(403).json({ error: 'Hệ thống đang tắt đăng ký tài khoản mới' });
  const email = normalizeEmail(req.body.email);
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!/^\S+@\S+\.\S+$/.test(email) || !name) return res.status(400).json({ error: 'Tên hoặc email không hợp lệ' });
  if (await db.user.findUnique({ where: { email } })) return res.status(409).json({ error: 'Email đã được sử dụng' });
  const passwordHash = await hashPassword(req.body.password);
  const bonus = Math.max(0, Math.trunc(Number(settings.signup_bonus || 0)));
  const user = await db.$transaction(async tx => {
    const u = await tx.user.create({ data: { email, name, passwordHash, wallet: { create: { balance: bonus } } }, include: { wallet: true } });
    if (bonus) await tx.creditTransaction.create({ data: { userId: u.id, type: 'SIGNUP_BONUS', amount: bonus, balanceAfter: bonus, description: 'Tín dụng tặng khi đăng ký' } });
    return u;
  });
  await createSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

app.post('/auth/login', wrap(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = await db.user.findUnique({ where: { email }, include: { wallet: true } });
  if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
  if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Tài khoản đang bị khóa' });
  await createSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

app.post('/auth/logout', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }).catch(() => {});
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/auth/facebook/callback', async (req, res) => {
  try {
    const userId = verifyOauthState(req.query.state);
    if (!userId) throw new Error('OAuth state không hợp lệ hoặc đã hết hạn');
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw new Error('Tài khoản Mộc Tâm AI không còn hoạt động');
    const code = String(req.query.code || '');
    if (!code) throw new Error(String(req.query.error_description || req.query.error || 'Facebook không trả authorization code'));
    const appId = process.env.META_APP_ID, secret = process.env.META_APP_SECRET, redirect = process.env.META_REDIRECT_URI;
    if (!appId || !secret || !redirect) throw new Error('Thiếu cấu hình Meta App');
    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', appId); tokenUrl.searchParams.set('client_secret', secret); tokenUrl.searchParams.set('redirect_uri', redirect); tokenUrl.searchParams.set('code', code);
    const tokenData = await graphJson(tokenUrl);
    const userToken = await exchangeForLongLivedUserToken(tokenData.access_token);
    const pages = await fetchManagedPages(userToken);
    let imported = 0, skipped = 0;
    for (const p of pages) {
      const existing = await db.page.findUnique({ where: { pageId: String(p.id) } });
      if (existing?.ownerId && existing.ownerId !== userId) { skipped++; continue; }
      const tokenEncrypted = encryptSecret(String(p.access_token));
      if (existing) await db.page.update({ where: { id: existing.id }, data: { ownerId: userId, name: String(p.name), tokenEncrypted, token: null } });
      else await db.page.create({ data: { ownerId: userId, pageId: String(p.id), name: String(p.name), tokenEncrypted } });
      await subscribePage(p); imported++;
    }
    res.type('html').send(oauthResultHtml({ ok: true, count: imported, skipped }));
  } catch (e) { console.error('Facebook OAuth callback:', e); res.status(400).type('html').send(oauthResultHtml({ ok: false, error: e.message || 'Unknown error' })); }
});

app.use('/api', auth);

app.get('/api/dashboard', wrap(async (req, res) => {
  const pageWhere = tenantWhere(req.user);
  const usageWhere = req.user.role === 'SUPER_ADMIN' ? {} : { userId: req.user.id };
  const [pages, conversations, messages, usage, wallet, users] = await Promise.all([
    db.page.count({ where: pageWhere }),
    db.conversation.count({ where: conversationWhere(req.user) }),
    db.message.count({ where: req.user.role === 'SUPER_ADMIN' ? {} : { conversation: { page: { ownerId: req.user.id } } } }),
    db.aiUsage.aggregate({ where: usageWhere, _sum: { retailCredits: true, realCostVnd: true }, _count: true }),
    ensureWallet(req.user.id),
    req.user.role === 'SUPER_ADMIN' ? db.user.count() : Promise.resolve(undefined),
  ]);
  res.json({ pages, conversations, messages, aiRequests: usage._count, creditsUsed: usage._sum.retailCredits || 0, aiCostVnd: usage._sum.realCostVnd || 0, wallet, users });
}));

app.get('/api/facebook/login-url', (req, res) => {
  const appId = process.env.META_APP_ID, redirect = process.env.META_REDIRECT_URI, secret = process.env.META_APP_SECRET;
  if (!appId || !redirect || !secret) return res.status(400).json({ error: 'Super Admin chưa cấu hình Meta App trên máy chủ' });
  const scopes = process.env.META_OAUTH_SCOPES || 'pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement';
  const u = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  u.searchParams.set('client_id', appId); u.searchParams.set('redirect_uri', redirect); u.searchParams.set('state', makeOauthState(req.user.id)); u.searchParams.set('scope', scopes); u.searchParams.set('response_type', 'code');
  res.json({ url: u.toString() });
});

app.get('/api/pages', wrap(async (req, res) => {
  const rows = await db.page.findMany({ where: tenantWhere(req.user), select: { id: true, pageId: true, name: true, enabled: true, prompt: true, tokenEncrypted: true, token: true, owner: { select: { email: true } } }, orderBy: { createdAt: 'desc' } });
  res.json(rows.map(p => ({ id: p.id, pageId: p.pageId, name: p.name, enabled: p.enabled, prompt: p.prompt, owner: p.owner, tokenConfigured: !!(p.tokenEncrypted || p.token) })));
}));
app.post('/api/pages', wrap(async (req, res) => {
  const pageId = String(req.body.pageId || '').trim(), name = String(req.body.name || '').trim();
  if (!pageId || !name) return res.status(400).json({ error: 'Thiếu Page ID hoặc tên' });
  const existing = await db.page.findUnique({ where: { pageId } });
  if (existing?.ownerId && existing.ownerId !== req.user.id && req.user.role !== 'SUPER_ADMIN') return res.status(409).json({ error: 'Page này đã thuộc tài khoản khác' });
  const ownerId = req.user.id;
  const row = existing ? await db.page.update({ where: { id: existing.id }, data: { ownerId, name } }) : await db.page.create({ data: { pageId, name, ownerId } });
  res.json({ id: row.id, pageId: row.pageId, name: row.name, enabled: row.enabled });
}));
app.patch('/api/pages/:id', wrap(async (req, res) => {
  const page = await ownedPage(req.params.id, req.user); if (!page) return res.status(404).json({ error: 'Không tìm thấy Page' });
  const data = {};
  if (typeof req.body.enabled === 'boolean') data.enabled = req.body.enabled;
  if (typeof req.body.prompt === 'string') data.prompt = req.body.prompt.slice(0, 12000);
  if (typeof req.body.token === 'string' && req.body.token.trim()) { data.tokenEncrypted = encryptSecret(req.body.token.trim()); data.token = null; }
  const row = await db.page.update({ where: { id: page.id }, data });
  res.json({ id: row.id, name: row.name, enabled: row.enabled, prompt: row.prompt });
}));

app.get('/api/conversations', wrap(async (req, res) => res.json(await db.conversation.findMany({ where: conversationWhere(req.user), include: { page: { select: { name: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 100 }))));
app.get('/api/conversations/:id/messages', wrap(async (req, res) => {
  const c = await db.conversation.findUnique({ where: { id: req.params.id }, include: { page: true } });
  if (!c || (req.user.role !== 'SUPER_ADMIN' && c.page.ownerId !== req.user.id)) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  res.json(await db.message.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'asc' }, take: 200 }));
}));
app.patch('/api/conversations/:id', wrap(async (req, res) => {
  const c = await db.conversation.findUnique({ where: { id: req.params.id }, include: { page: true } });
  if (!c || (req.user.role !== 'SUPER_ADMIN' && c.page.ownerId !== req.user.id)) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  const data = {}; if (typeof req.body.handoff === 'boolean') data.handoff = req.body.handoff; if (typeof req.body.enabled === 'boolean') data.enabled = req.body.enabled;
  res.json(await db.conversation.update({ where: { id: c.id }, data }));
}));

app.get('/api/products', wrap(async (req, res) => res.json(await db.product.findMany({ where: productWhere(req.user), include: { page: { select: { name: true } }, }, orderBy: { name: 'asc' } }))));
app.post('/api/products', wrap(async (req, res) => {
  const page = await ownedPage(String(req.body.pageId || ''), req.user); if (!page) return res.status(404).json({ error: 'Page không hợp lệ' });
  const name = String(req.body.name || '').trim(); if (!name) return res.status(400).json({ error: 'Thiếu tên sản phẩm' });
  res.json(await db.product.create({ data: { pageId: page.id, name, description: String(req.body.description || '').slice(0, 10000), price: req.body.price == null || req.body.price === '' ? null : Math.trunc(Number(req.body.price)) } }));
}));

app.post('/api/demo', wrap(async (req, res) => {
  if (process.env.DEMO_MODE !== 'true') return res.status(403).json({ error: 'Demo disabled' });
  const page = await db.page.findUnique({ where: { pageId: String(req.body.pageId || '') } });
  if (!page || (req.user.role !== 'SUPER_ADMIN' && page.ownerId !== req.user.id)) return res.status(404).json({ error: 'Page không hợp lệ' });
  const text = String(req.body.text || '').trim(); if (!text) return res.status(400).json({ error: 'Thiếu nội dung' });
  const mid = 'demo-' + crypto.randomUUID(); await queue.add('incoming', { pageId: page.pageId, senderId: 'demo-customer', mid, text, demo: true }, { attempts: 1 }); res.json({ queued: true, mid });
}));

app.get('/api/wallet', wrap(async (req, res) => {
  const wallet = await ensureWallet(req.user.id);
  const transactions = await db.creditTransaction.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ wallet, transactions });
}));
app.get('/api/packages', wrap(async (req, res) => res.json(await db.topupPackage.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { priceVnd: 'asc' }] }))));
app.get('/api/topup-orders', wrap(async (req, res) => res.json(await db.topupOrder.findMany({ where: { userId: req.user.id }, include: { package: true }, orderBy: { createdAt: 'desc' }, take: 50 }))));
app.post('/api/topup-orders', wrap(async (req, res) => {
  const pack = await db.topupPackage.findUnique({ where: { id: String(req.body.packageId || '') } });
  if (!pack || !pack.active) return res.status(404).json({ error: 'Gói tín dụng không tồn tại' });
  const paymentCode = `MT${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  res.json(await db.topupOrder.create({ data: { userId: req.user.id, packageId: pack.id, amountVnd: pack.priceVnd, credits: pack.credits, paymentCode } }));
}));

app.use('/api/admin', superAdmin);

app.get('/api/admin/overview', wrap(async (req, res) => {
  const [users, pages, orders, wallets, usage] = await Promise.all([
    db.user.count(), db.page.count(), db.topupOrder.count({ where: { status: 'PENDING' } }), db.wallet.aggregate({ _sum: { balance: true, reserved: true } }), db.aiUsage.aggregate({ _sum: { retailCredits: true, realCostVnd: true }, _count: true }),
  ]);
  res.json({ users, pages, pendingOrders: orders, creditsInWallets: wallets._sum.balance || 0, creditsReserved: wallets._sum.reserved || 0, aiRequests: usage._count, creditsCharged: usage._sum.retailCredits || 0, realAiCostVnd: usage._sum.realCostVnd || 0 });
}));
app.get('/api/admin/users', wrap(async (req, res) => res.json(await db.user.findMany({ select: { id: true, email: true, name: true, role: true, status: true, createdAt: true, wallet: true, _count: { select: { pages: true, aiUsages: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }))));
app.patch('/api/admin/users/:id', wrap(async (req, res) => {
  if (req.params.id === req.user.id && req.body.status === 'SUSPENDED') return res.status(400).json({ error: 'Không thể tự khóa tài khoản Super Admin đang đăng nhập' });
  const data = {}; if (['ACTIVE', 'SUSPENDED'].includes(req.body.status)) data.status = req.body.status;
  res.json(await db.user.update({ where: { id: req.params.id }, data, select: { id: true, email: true, status: true, role: true } }));
}));
app.post('/api/admin/users/:id/credits', wrap(async (req, res) => {
  const amount = Math.trunc(Number(req.body.amount)); if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Số credit không hợp lệ' });
  const target = await db.user.findUnique({ where: { id: req.params.id } }); if (!target) return res.status(404).json({ error: 'Không tìm thấy user' });
  const wallet = await adjustCredits(target.id, amount, 'ADMIN_ADJUST', `admin:${crypto.randomUUID()}`, String(req.body.description || `Điều chỉnh bởi ${req.user.email}`).slice(0, 250));
  res.json(wallet);
}));

app.get('/api/admin/topup-orders', wrap(async (req, res) => res.json(await db.topupOrder.findMany({ include: { user: { select: { email: true, name: true } }, package: true }, orderBy: { createdAt: 'desc' }, take: 200 }))));
app.post('/api/admin/topup-orders/:id/approve', wrap(async (req, res) => {
  const result = await db.$transaction(async tx => {
    const order = await tx.topupOrder.findUnique({ where: { id: req.params.id } }); if (!order) throw new Error('Không tìm thấy yêu cầu nạp');
    if (order.status === 'PAID') return order;
    if (order.status !== 'PENDING') throw new Error('Yêu cầu không còn ở trạng thái chờ');
    const changed = await tx.topupOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date() } });
    if (changed.count !== 1) throw new Error('Yêu cầu đã được xử lý');
    await tx.wallet.upsert({ where: { userId: order.userId }, create: { userId: order.userId }, update: {} });
    const wallet = await tx.wallet.update({ where: { userId: order.userId }, data: { balance: { increment: order.credits } } });
    await tx.creditTransaction.create({ data: { userId: order.userId, type: 'TOPUP', amount: order.credits, balanceAfter: wallet.balance, reservedAfter: wallet.reserved, reference: `topup:${order.id}`, description: `Nạp ${order.amountVnd.toLocaleString('vi-VN')}đ - ${order.paymentCode}` } });
    return tx.topupOrder.findUnique({ where: { id: order.id } });
  });
  res.json(result);
}));
app.post('/api/admin/topup-orders/:id/cancel', wrap(async (req, res) => res.json(await db.topupOrder.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } }))));

app.get('/api/admin/packages', wrap(async (req, res) => res.json(await db.topupPackage.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceVnd: 'asc' }] }))));
app.post('/api/admin/packages', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim(); const priceVnd = Math.trunc(Number(req.body.priceVnd)); const credits = Math.trunc(Number(req.body.credits));
  if (!name || priceVnd <= 0 || credits <= 0) return res.status(400).json({ error: 'Gói tín dụng không hợp lệ' });
  res.json(await db.topupPackage.create({ data: { name, priceVnd, credits, sortOrder: Math.trunc(Number(req.body.sortOrder || 0)) } }));
}));
app.patch('/api/admin/packages/:id', wrap(async (req, res) => {
  const data = {}; if (typeof req.body.active === 'boolean') data.active = req.body.active; if (req.body.name) data.name = String(req.body.name).trim();
  if (req.body.priceVnd != null) data.priceVnd = Math.trunc(Number(req.body.priceVnd)); if (req.body.credits != null) data.credits = Math.trunc(Number(req.body.credits));
  res.json(await db.topupPackage.update({ where: { id: req.params.id }, data }));
}));

app.get('/api/admin/openai', wrap(async (req, res) => {
  const settings = await getSettings(); const secret = await db.systemSetting.findUnique({ where: { key: 'openai_api_key' } });
  let keyHint = ''; if (secret?.encryptedValue) { try { const k = (await getOpenAiConfig()).apiKey; keyHint = k ? `••••${k.slice(-4)}` : ''; } catch { keyHint = 'đã mã hóa'; } }
  res.json({ keyConfigured: !!secret?.encryptedValue, keyHint, model: settings.openai_model, inputUsdPerMillion: Number(settings.openai_input_usd_per_million), outputUsdPerMillion: Number(settings.openai_output_usd_per_million), usdToVnd: Number(settings.usd_to_vnd), markup: Number(settings.ai_markup), minCredits: Number(settings.ai_min_credits), maxOutputTokens: Number(settings.ai_max_output_tokens) });
}));
app.put('/api/admin/openai', wrap(async (req, res) => {
  const fields = {
    openai_model: req.body.model,
    openai_input_usd_per_million: req.body.inputUsdPerMillion,
    openai_output_usd_per_million: req.body.outputUsdPerMillion,
    usd_to_vnd: req.body.usdToVnd,
    ai_markup: req.body.markup,
    ai_min_credits: req.body.minCredits,
    ai_max_output_tokens: req.body.maxOutputTokens,
  };
  for (const [key, value] of Object.entries(fields)) if (value != null && String(value).trim() !== '') await db.systemSetting.upsert({ where: { key }, create: { key, value: String(value).trim() }, update: { value: String(value).trim() } });
  if (typeof req.body.apiKey === 'string' && req.body.apiKey.trim()) await db.systemSetting.upsert({ where: { key: 'openai_api_key' }, create: { key: 'openai_api_key', encryptedValue: encryptSecret(req.body.apiKey.trim()) }, update: { encryptedValue: encryptSecret(req.body.apiKey.trim()) } });
  res.json({ ok: true });
}));
app.post('/api/admin/openai/test', wrap(async (req, res) => {
  const cfg = await getOpenAiConfig(); if (!cfg.apiKey) return res.status(400).json({ error: 'Chưa cấu hình OpenAI API Key' });
  const client = new OpenAI({ apiKey: cfg.apiKey }); const model = await client.models.retrieve(cfg.model); res.json({ ok: true, model: model.id });
}));

ensureDefaultSettings().catch(e => console.error('Default settings:', e.message));
app.listen(4000, '0.0.0.0', () => console.log('Mộc Tâm AI V2.0 API listening on 4000'));
