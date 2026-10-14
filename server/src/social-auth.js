const crypto = require('node:crypto');
const { db } = require('./common');
const {
  SESSION_COOKIE,
  normalizeEmail,
  newSessionToken,
  hashSessionToken,
  parseCookies,
  setSessionCookie,
} = require('./security');
const { getSettings } = require('./billing');

const STATE_COOKIE = 'moc_social_oauth';
const STATE_TTL_MS = 10 * 60 * 1000;

function publicWebUrl() {
  return String(process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');
}

function cookieSecure() {
  return process.env.COOKIE_SECURE === 'true' || publicWebUrl().startsWith('https://');
}

function stateSecret() {
  const secret = String(process.env.SOCIAL_OAUTH_STATE_SECRET || process.env.META_OAUTH_STATE_SECRET || '').trim();
  if (!secret || secret.startsWith('CHANGE_')) throw new Error('Chưa cấu hình SOCIAL_OAUTH_STATE_SECRET');
  return secret;
}

function setStateCookie(res, state) {
  const parts = [
    `${STATE_COOKIE}=${encodeURIComponent(state)}`,
    'Path=/auth/social',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
  ];
  if (cookieSecure()) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearStateCookie(res) {
  const parts = [`${STATE_COOKIE}=`, 'Path=/auth/social', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure()) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function makeState(provider, linkUserId = '') {
  const payload = `${Date.now()}.${provider}.${crypto.randomBytes(18).toString('hex')}.${linkUserId || '-'}`;
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function verifyState(req, provider) {
  const supplied = String(req.query.state || '');
  const cookie = String(parseCookies(req.headers.cookie)[STATE_COOKIE] || '');
  if (!supplied || !cookie || supplied.length !== cookie.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(cookie))) {
    throw new Error('OAuth state không khớp trình duyệt. Vui lòng đăng nhập lại.');
  }
  const raw = Buffer.from(supplied, 'base64url').toString('utf8');
  const parts = raw.split('.');
  if (parts.length !== 5) throw new Error('OAuth state không hợp lệ');
  const [ts, stateProvider, nonce, linkUserId, sig] = parts;
  if (!ts || !nonce || stateProvider !== provider) throw new Error('OAuth state không hợp lệ');
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_MS) throw new Error('Phiên OAuth đã hết hạn. Vui lòng thử lại.');
  const payload = `${ts}.${stateProvider}.${nonce}.${linkUserId}`;
  const expected = crypto.createHmac('sha256', stateSecret()).update(payload).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Chữ ký OAuth state không hợp lệ');
  return { linkUserId: linkUserId === '-' ? '' : linkUserId };
}

async function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  }).catch(() => null);
  if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') return null;
  return session.user;
}

async function createSession(res, userId) {
  const token = newSessionToken();
  const days = Math.max(1, Number(process.env.SESSION_DAYS || 30));
  await db.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt: new Date(Date.now() + days * 86400000),
    },
  });
  setSessionCookie(res, token);
}

function redirectUri(provider) {
  if (provider === 'google') {
    return String(process.env.GOOGLE_REDIRECT_URI || `${publicWebUrl()}/auth/social/google/callback`);
  }
  return String(process.env.FACEBOOK_LOGIN_REDIRECT_URI || `${publicWebUrl()}/auth/social/facebook/callback`);
}

function socialError(res, provider, error) {
  clearStateCookie(res);
  const target = new URL(publicWebUrl() + '/');
  target.searchParams.set('social_provider', provider);
  target.searchParams.set('social_error', String(error?.message || error || 'Đăng nhập thất bại').slice(0, 500));
  res.redirect(302, target.toString());
}

function socialSuccess(res, provider) {
  clearStateCookie(res);
  const target = new URL(publicWebUrl() + '/');
  target.searchParams.set('social', 'success');
  target.searchParams.set('social_provider', provider);
  res.redirect(302, target.toString());
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!response.ok || body?.error) {
    const message = body?.error_description || body?.error?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return body;
}

async function resolveSocialUser({ provider, providerUserId, email, name, emailVerified = false, linkUserId = '' }) {
  const providerId = String(providerUserId || '').trim();
  const normalizedEmail = normalizeEmail(email);
  if (!providerId) throw new Error(`${provider} không trả mã định danh người dùng`);
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new Error(`${provider === 'facebook' ? 'Facebook' : 'Google'} không cung cấp email hợp lệ. Hãy bảo đảm tài khoản có email và cấp quyền email.`);
  }

  const linked = await db.oAuthAccount.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: providerId } },
    include: { user: true },
  });
  if (linked) {
    if (linked.user.status !== 'ACTIVE') throw new Error('Tài khoản đang bị khóa');
    return linked.user;
  }

  if (linkUserId) {
    const user = await db.user.findUnique({ where: { id: linkUserId } });
    if (!user || user.status !== 'ACTIVE') throw new Error('Tài khoản cần liên kết không còn hoạt động');
    const emailOwner = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (emailOwner && emailOwner.id !== user.id) throw new Error('Email mạng xã hội đang thuộc một tài khoản Mộc Tâm AI khác');
    await db.oAuthAccount.create({ data: { userId: user.id, provider, providerUserId: providerId, providerEmail: normalizedEmail } });
    return user;
  }

  const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    // Google explicitly asserts email_verified. This makes linking an existing email account safe enough
    // without asking the user to create a second Mộc Tâm AI account.
    if (provider === 'google' && emailVerified) {
      if (existing.status !== 'ACTIVE') throw new Error('Tài khoản đang bị khóa');
      await db.oAuthAccount.create({ data: { userId: existing.id, provider, providerUserId: providerId, providerEmail: normalizedEmail } });
      return existing;
    }
    throw new Error('Email này đã có tài khoản Mộc Tâm AI. Hãy đăng nhập tài khoản hiện có trước khi liên kết Facebook.');
  }

  const settings = await getSettings();
  if (settings.signup_enabled !== 'true') throw new Error('Hệ thống đang tắt đăng ký tài khoản mới');

  try {
    return await db.$transaction(async tx => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: String(name || normalizedEmail.split('@')[0]).trim().slice(0, 100) || 'Người dùng',
          passwordHash: null,
        },
      });
      await tx.oAuthAccount.create({
        data: { userId: user.id, provider, providerUserId: providerId, providerEmail: normalizedEmail },
      });
      return user;
    });
  } catch (e) {
    if (e?.code !== 'P2002') throw e;
    const retry = await db.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: providerId } },
      include: { user: true },
    });
    if (retry?.user) return retry.user;
    throw new Error('Tài khoản đã được tạo đồng thời. Vui lòng thử đăng nhập lại.');
  }
}

async function googleProfile(code) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '');
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '');
  if (!clientId || !clientSecret) throw new Error('Chưa cấu hình Google OAuth trên máy chủ');
  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri('google'),
      grant_type: 'authorization_code',
    }),
  });
  if (!token.access_token) throw new Error('Google không trả access token');
  const profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (profile.email_verified !== true) throw new Error('Google chưa xác minh email của tài khoản này');
  return {
    providerUserId: profile.sub,
    email: profile.email,
    name: profile.name || profile.given_name || profile.email,
    emailVerified: true,
  };
}

async function facebookProfile(code) {
  const appId = String(process.env.META_APP_ID || '');
  const appSecret = String(process.env.META_APP_SECRET || '');
  if (!appId || !appSecret) throw new Error('Chưa cấu hình Meta App trên máy chủ');
  const tokenUrl = new URL(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri('facebook'));
  tokenUrl.searchParams.set('code', code);
  const token = await fetchJson(tokenUrl);
  if (!token.access_token) throw new Error('Facebook không trả access token');
  const me = new URL(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/me`);
  me.searchParams.set('fields', 'id,name,email');
  me.searchParams.set('access_token', token.access_token);
  me.searchParams.set('appsecret_proof', crypto.createHmac('sha256', appSecret).update(token.access_token).digest('hex'));
  const profile = await fetchJson(me);
  return {
    providerUserId: profile.id,
    email: profile.email,
    name: profile.name || profile.email,
    emailVerified: false,
  };
}

function registerSocialAuthRoutes(app) {
  app.get('/auth/social/providers', (req, res) => {
    res.json({
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      facebook: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    });
  });

  app.get('/auth/social/google/start', async (req, res) => {
    try {
      const clientId = String(process.env.GOOGLE_CLIENT_ID || '');
      if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('Chưa cấu hình Google OAuth');
      const user = await currentUser(req);
      const state = makeState('google', user?.id || '');
      setStateCookie(res, state);
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri('google'));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('prompt', 'select_account');
      res.redirect(302, url.toString());
    } catch (e) { socialError(res, 'google', e); }
  });

  app.get('/auth/social/google/callback', async (req, res) => {
    try {
      const state = verifyState(req, 'google');
      if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
      const code = String(req.query.code || '');
      if (!code) throw new Error('Google không trả authorization code');
      const profile = await googleProfile(code);
      const user = await resolveSocialUser({ provider: 'google', ...profile, linkUserId: state.linkUserId });
      await createSession(res, user.id);
      socialSuccess(res, 'google');
    } catch (e) { socialError(res, 'google', e); }
  });

  app.get('/auth/social/facebook/start', async (req, res) => {
    try {
      const appId = String(process.env.META_APP_ID || '');
      if (!appId || !process.env.META_APP_SECRET) throw new Error('Chưa cấu hình Meta App');
      const user = await currentUser(req);
      const state = makeState('facebook', user?.id || '');
      setStateCookie(res, state);
      const url = new URL(`https://www.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/dialog/oauth`);
      url.searchParams.set('client_id', appId);
      url.searchParams.set('redirect_uri', redirectUri('facebook'));
      url.searchParams.set('state', state);
      url.searchParams.set('response_type', 'code');
      const configId = String(process.env.FACEBOOK_SSO_CONFIG_ID || '').trim();
      if (configId) {
        url.searchParams.set('config_id', configId);
        url.searchParams.set('override_default_response_type', 'true');
      } else {
        url.searchParams.set('scope', 'public_profile,email');
      }
      res.redirect(302, url.toString());
    } catch (e) { socialError(res, 'facebook', e); }
  });

  app.get('/auth/social/facebook/callback', async (req, res) => {
    try {
      const state = verifyState(req, 'facebook');
      if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
      const code = String(req.query.code || '');
      if (!code) throw new Error('Facebook không trả authorization code');
      const profile = await facebookProfile(code);
      const user = await resolveSocialUser({ provider: 'facebook', ...profile, linkUserId: state.linkUserId });
      await createSession(res, user.id);
      socialSuccess(res, 'facebook');
    } catch (e) { socialError(res, 'facebook', e); }
  });
}

module.exports = { registerSocialAuthRoutes };
