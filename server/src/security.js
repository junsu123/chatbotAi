const crypto = require('node:crypto');

const SESSION_COOKIE = 'moc_session';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 10) throw new Error('Mật khẩu phải có ít nhất 10 ký tự');
  if (p.length > 200) throw new Error('Mật khẩu quá dài');
  return p;
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => err ? reject(err) : resolve(key));
  });
}

async function hashPassword(password) {
  const p = validatePassword(password);
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(p, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password, encoded) {
  try {
    const [kind, saltB64, hashB64] = String(encoded || '').split('$');
    if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = await scryptAsync(String(password || ''), Buffer.from(saltB64, 'base64url'));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function masterKey() {
  const raw = String(process.env.MASTER_ENCRYPTION_KEY || '').trim();
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64'); } catch { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) throw new Error('MASTER_ENCRYPTION_KEY phải là 32 bytes (khuyên dùng: openssl rand -hex 32)');
  return key;
}

function encryptSecret(value) {
  const text = String(value || '');
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptSecret(value) {
  if (!value) return '';
  const [version, ivB64, tagB64, dataB64] = String(value).split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Dữ liệu bí mật không đúng định dạng');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieSecure() {
  return process.env.COOKIE_SECURE === 'true' || String(process.env.PUBLIC_WEB_URL || '').startsWith('https://');
}

function setSessionCookie(res, token) {
  const days = Math.max(1, Number(process.env.SESSION_DAYS || 30));
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(days * 86400)}`,
  ];
  if (cookieSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

module.exports = {
  SESSION_COOKIE,
  normalizeEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  encryptSecret,
  decryptSecret,
  newSessionToken,
  hashSessionToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
};
