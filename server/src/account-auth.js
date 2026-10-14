const crypto = require('node:crypto');
const { db } = require('./common');
const {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  newSessionToken,
  hashSessionToken,
  setSessionCookie,
  clearSessionCookie,
} = require('./security');
const { getSettings } = require('./billing');

const OTP_CHANNEL = 'EMAIL';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 8;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

function normalizePhone(value) {
  let raw = String(value || '').trim().replace(/[\s().-]/g, '');
  if (!raw) return '';
  const defaultCode = String(process.env.DEFAULT_PHONE_COUNTRY_CODE || '84').replace(/\D/g, '');
  if (raw.startsWith('+')) raw = '+' + raw.slice(1).replace(/\D/g, '');
  else {
    raw = raw.replace(/\D/g, '');
    if (raw.startsWith('0')) raw = `+${defaultCode}${raw.slice(1)}`;
    else if (defaultCode && raw.startsWith(defaultCode)) raw = `+${raw}`;
    else raw = `+${raw}`;
  }
  if (!/^\d{8,15}$/.test(raw.slice(1))) throw new Error('Số điện thoại không hợp lệ');
  return raw;
}

function validEmail(email) {
  return /^\S+@\S+\.\S+$/.test(String(email || ''));
}

function profileComplete(user) {
  if (user?.role === 'SUPER_ADMIN') return true;
  return Boolean(user?.email && user?.phone && user?.emailVerifiedAt);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone || '',
    name: user.name,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: false,
    hasPassword: Boolean(user.passwordHash),
    profileComplete: profileComplete(user),
    createdAt: user.createdAt,
  };
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || req.socket?.remoteAddress || '').slice(0, 80) || null;
}

function deviceName(userAgent) {
  const ua = String(userAgent || '');
  let browser = 'Trình duyệt';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  let os = 'Thiết bị';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/i.test(ua)) os = 'iOS';
  else if (/Mac OS|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return `${browser} · ${os}`;
}

async function createSession(req, res, userId) {
  const token = newSessionToken();
  const days = Math.max(1, Number(process.env.SESSION_DAYS || 30));
  const ua = String(req.get?.('user-agent') || req.headers?.['user-agent'] || '').slice(0, 500);
  await db.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt: new Date(Date.now() + days * 86400000),
      userAgent: ua || null,
      ipAddress: clientIp(req),
      deviceName: deviceName(ua),
    },
  });
  setSessionCookie(res, token);
}

function otpSecret() {
  const value = String(
    process.env.OTP_PEPPER ||
    process.env.SOCIAL_OAUTH_STATE_SECRET ||
    process.env.META_OAUTH_STATE_SECRET ||
    process.env.MASTER_ENCRYPTION_KEY || ''
  ).trim();
  if (!value || value.startsWith('CHANGE_') || value.startsWith('GENERATE_')) {
    throw new Error('Chưa cấu hình OTP_PEPPER hoặc SOCIAL_OAUTH_STATE_SECRET');
  }
  return value;
}

function codeHash({ purpose, destination, code }) {
  return crypto.createHmac('sha256', otpSecret())
    .update(`${purpose}|${OTP_CHANNEL}|${destination}|${code}`)
    .digest('hex');
}

function maskEmail(destination) {
  const [name, domain] = String(destination || '').split('@');
  if (!domain) return '••••';
  return `${(name || '').slice(0, 2)}•••@${domain}`;
}

function emailDeliveryAvailable() {
  return process.env.OTP_DEV_MODE === 'true' || Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmailCode(destination, code, purpose) {
  const minutes = Math.round(OTP_TTL_MS / 60000);
  const text = `Mã xác nhận Mộc Tâm AI của bạn là ${code}. Mã có hiệu lực ${minutes} phút. Không chia sẻ mã này cho bất kỳ ai.`;

  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [destination],
        subject: purpose === 'PASSWORD_RESET' ? 'Đặt lại mật khẩu Mộc Tâm AI' : 'Mã xác nhận Mộc Tâm AI',
        text,
      }),
    });
    if (!r.ok) throw new Error(`Không gửi được email xác nhận (${r.status})`);
    return;
  }

  if (process.env.OTP_DEV_MODE === 'true') {
    console.warn(`[OTP DEV] EMAIL ${destination} ${purpose}: ${code}`);
    return;
  }

  throw new Error('Chưa cấu hình dịch vụ gửi email (RESEND_API_KEY + EMAIL_FROM)');
}

async function issueEmailCode({ userId = null, purpose, destination }) {
  const email = normalizeEmail(destination);
  if (!validEmail(email)) throw new Error('Email nhận mã xác nhận không hợp lệ');
  if (!emailDeliveryAvailable()) throw new Error('Chưa cấu hình dịch vụ gửi email xác nhận');

  const recent = await db.verificationCode.findFirst({
    where: {
      destination: email,
      purpose,
      channel: OTP_CHANNEL,
      createdAt: { gt: new Date(Date.now() - OTP_COOLDOWN_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) throw new Error('Vui lòng chờ 60 giây trước khi yêu cầu mã mới');

  const count = await db.verificationCode.count({
    where: { destination: email, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (count >= OTP_MAX_PER_HOUR) throw new Error('Bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const row = await db.verificationCode.create({
    data: {
      userId,
      purpose,
      channel: OTP_CHANNEL,
      destination: email,
      codeHash: codeHash({ purpose, destination: email, code }),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  try {
    await sendEmailCode(email, code, purpose);
  } catch (e) {
    await db.verificationCode.delete({ where: { id: row.id } }).catch(() => {});
    throw e;
  }

  return {
    channel: OTP_CHANNEL,
    destination: maskEmail(email),
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    ...(process.env.OTP_DEV_MODE === 'true' ? { devCode: code } : {}),
  };
}

async function consumeEmailCode({ userId = null, purpose, destination, code }) {
  const email = normalizeEmail(destination);
  const row = await db.verificationCode.findFirst({
    where: { userId, purpose, channel: OTP_CHANNEL, destination: email, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt <= new Date()) throw new Error('Mã xác nhận không tồn tại hoặc đã hết hạn');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new Error('Mã xác nhận đã bị khóa do nhập sai quá nhiều lần');

  const actual = codeHash({ purpose, destination: email, code: String(code || '') });
  const expected = row.codeHash;
  const ok = actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  if (!ok) {
    await db.verificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new Error('Mã xác nhận không đúng');
  }

  await db.verificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return row;
}

async function findUserByIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return db.user.findUnique({ where: { email: normalizeEmail(raw) } });
  let phone;
  try { phone = normalizePhone(raw); } catch { return null; }
  return db.user.findUnique({ where: { phone } });
}

async function verifyCurrentPassword(user, currentPassword) {
  if (!user.passwordHash) return;
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new Error('Mật khẩu hiện tại không đúng');
}

function requireCompleteProfile(req, res, next) {
  if (profileComplete(req.user)) return next();
  return res.status(428).json({
    error: 'Vui lòng hoàn tất email và số điện thoại, đồng thời xác minh email trước khi sử dụng hệ thống',
    code: 'PROFILE_INCOMPLETE',
  });
}

function registerPublicAccountRoutes(app) {
  app.post('/auth/register', async (req, res) => {
    try {
      const settings = await getSettings();
      if (settings.signup_enabled !== 'true') return res.status(403).json({ error: 'Hệ thống đang tắt đăng ký tài khoản mới' });

      const email = normalizeEmail(req.body.email);
      const phone = normalizePhone(req.body.phone);
      const name = String(req.body.name || '').trim().slice(0, 100);
      if (!validEmail(email) || !name || !phone) return res.status(400).json({ error: 'Họ tên, email và số điện thoại là bắt buộc' });
      if (await db.user.findUnique({ where: { email } })) return res.status(409).json({ error: 'Email đã được sử dụng' });
      if (await db.user.findUnique({ where: { phone } })) return res.status(409).json({ error: 'Số điện thoại đã được sử dụng' });

      const passwordHash = await hashPassword(req.body.password);
      const user = await db.user.create({ data: { email, phone, name, passwordHash, status: 'PENDING_VERIFICATION' } });
      try {
        const verification = await issueEmailCode({ userId: user.id, purpose: 'SIGNUP', destination: email });
        return res.json({ userId: user.id, verificationRequired: true, ...verification });
      } catch (e) {
        await db.user.delete({ where: { id: user.id } }).catch(() => {});
        throw e;
      }
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể đăng ký' });
    }
  });

  app.post('/auth/register/resend', async (req, res) => {
    try {
      const user = await db.user.findUnique({ where: { id: String(req.body.userId || '') } });
      if (!user || user.status !== 'PENDING_VERIFICATION') return res.status(404).json({ error: 'Phiên đăng ký không còn hợp lệ' });
      const out = await issueEmailCode({ userId: user.id, purpose: 'SIGNUP', destination: user.email });
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể gửi mã' });
    }
  });

  app.post('/auth/register/verify', async (req, res) => {
    try {
      const user = await db.user.findUnique({ where: { id: String(req.body.userId || '') } });
      if (!user || user.status !== 'PENDING_VERIFICATION') return res.status(404).json({ error: 'Phiên đăng ký không còn hợp lệ' });

      await consumeEmailCode({ userId: user.id, purpose: 'SIGNUP', destination: user.email, code: req.body.code });
      const active = await db.user.update({
        where: { id: user.id },
        data: {
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await createSession(req, res, active.id);
      res.json({ user: publicUser(active) });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể xác minh' });
    }
  });

  app.post('/auth/login', async (req, res) => {
    try {
      const user = await findUserByIdentifier(req.body.identifier || req.body.email);
      if (!user) return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng' });
      if (user.status === 'PENDING_VERIFICATION') {
        return res.status(403).json({ error: 'Tài khoản chưa hoàn tất xác minh email', code: 'PENDING_VERIFICATION', userId: user.id });
      }
      if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Tài khoản đang bị khóa' });
      if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(429).json({ error: 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.' });

      const ok = await verifyPassword(req.body.password, user.passwordHash);
      if (!ok) {
        const failed = Number(user.failedLoginCount || 0) + 1;
        await db.user.update({
          where: { id: user.id },
          data: failed >= LOGIN_MAX_ATTEMPTS
            ? { failedLoginCount: failed, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MS) }
            : { failedLoginCount: failed },
        });
        return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng' });
      }

      const fresh = await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await createSession(req, res, fresh.id);
      res.json({ user: publicUser(fresh) });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể đăng nhập' });
    }
  });

  app.post('/auth/password/reset/request', async (req, res) => {
    try {
      if (!emailDeliveryAvailable()) return res.status(503).json({ error: 'Chưa cấu hình dịch vụ gửi email' });
      const user = await findUserByIdentifier(req.body.identifier);
      let devCode;
      if (user && user.status === 'ACTIVE' && validEmail(user.email)) {
        try {
          const out = await issueEmailCode({ userId: user.id, purpose: 'PASSWORD_RESET', destination: user.email });
          devCode = out.devCode;
        } catch (e) {
          if (process.env.OTP_DEV_MODE === 'true') throw e;
        }
      }
      res.json({
        ok: true,
        channel: OTP_CHANNEL,
        message: 'Nếu tài khoản hợp lệ, mã xác nhận đã được gửi tới email của tài khoản.',
        ...(devCode ? { devCode } : {}),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể gửi mã' });
    }
  });

  app.post('/auth/password/reset/confirm', async (req, res) => {
    try {
      const user = await findUserByIdentifier(req.body.identifier);
      if (!user || user.status !== 'ACTIVE') return res.status(400).json({ error: 'Không thể đặt lại mật khẩu' });
      await consumeEmailCode({ userId: user.id, purpose: 'PASSWORD_RESET', destination: user.email, code: req.body.code });
      const passwordHash = await hashPassword(req.body.newPassword);
      await db.$transaction([
        db.user.update({
          where: { id: user.id },
          data: { passwordHash, emailVerifiedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        }),
        db.session.deleteMany({ where: { userId: user.id } }),
      ]);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể đặt lại mật khẩu' });
    }
  });
}

function registerProtectedAccountRoutes(app) {
  app.get('/api/account', async (req, res) => {
    try {
      const user = await db.user.findUnique({
        where: { id: req.user.id },
        include: { oauthAccounts: { select: { provider: true, providerEmail: true, createdAt: true } } },
      });
      res.json({ user: publicUser(user), oauthAccounts: user.oauthAccounts });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể tải thông tin tài khoản' });
    }
  });

  app.patch('/api/account/profile', async (req, res) => {
    try {
      const name = String(req.body.name || '').trim().slice(0, 100);
      if (!name) throw new Error('Họ tên không được để trống');
      const user = await db.user.update({ where: { id: req.user.id }, data: { name } });
      res.json({ user: publicUser(user) });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể cập nhật hồ sơ' });
    }
  });

  app.post('/api/account/contact/request', async (req, res) => {
    try {
      const field = req.body.field === 'phone' ? 'phone' : 'email';
      const user = await db.user.findUnique({ where: { id: req.user.id } });
      const current = field === 'email' ? user.email : user.phone;
      const value = field === 'email'
        ? normalizeEmail(req.body.value || current)
        : normalizePhone(req.body.value || current);
      if (!value) throw new Error(field === 'email' ? 'Email là bắt buộc' : 'Số điện thoại là bắt buộc');
      if (field === 'email' && !validEmail(value)) throw new Error('Email không hợp lệ');

      const changing = value !== current;
      if (changing) {
        await verifyCurrentPassword(user, req.body.currentPassword);
        const exists = await db.user.findUnique({ where: field === 'email' ? { email: value } : { phone: value } });
        if (exists && exists.id !== user.id) throw new Error(field === 'email' ? 'Email đã được sử dụng' : 'Số điện thoại đã được sử dụng');
      }

      const purpose = changing
        ? (field === 'email' ? 'CHANGE_EMAIL' : 'CHANGE_PHONE')
        : (field === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE');
      const destination = field === 'email' ? value : user.email;
      const out = await issueEmailCode({ userId: user.id, purpose, destination });
      res.json({ ok: true, field, valueMasked: field === 'email' ? out.destination : value, ...out });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể gửi mã xác nhận' });
    }
  });

  app.post('/api/account/contact/confirm', async (req, res) => {
    try {
      const field = req.body.field === 'phone' ? 'phone' : 'email';
      const user = await db.user.findUnique({ where: { id: req.user.id } });
      const current = field === 'email' ? user.email : user.phone;
      const value = field === 'email'
        ? normalizeEmail(req.body.value || current)
        : normalizePhone(req.body.value || current);
      if (!value) throw new Error(field === 'email' ? 'Email là bắt buộc' : 'Số điện thoại là bắt buộc');

      const changing = value !== current;
      const purpose = changing
        ? (field === 'email' ? 'CHANGE_EMAIL' : 'CHANGE_PHONE')
        : (field === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE');
      const destination = field === 'email' ? value : user.email;
      await consumeEmailCode({ userId: user.id, purpose, destination, code: req.body.code });

      const data = field === 'email'
        ? { email: value, emailVerifiedAt: new Date() }
        : { phone: value, phoneVerifiedAt: null, emailVerifiedAt: new Date() };
      const updated = await db.user.update({ where: { id: user.id }, data });
      res.json({ user: publicUser(updated) });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể xác nhận thông tin' });
    }
  });

  app.delete('/api/account/contact/:field', (req, res) => {
    const label = req.params.field === 'phone' ? 'Số điện thoại' : 'Email';
    res.status(400).json({ error: `${label} là trường bắt buộc. Bạn có thể thay đổi nhưng không thể xóa khỏi tài khoản.` });
  });

  app.post('/api/account/password/change/request', async (req, res) => {
    try {
      const user = await db.user.findUnique({ where: { id: req.user.id } });
      await verifyCurrentPassword(user, req.body.currentPassword);
      const out = await issueEmailCode({ userId: user.id, purpose: 'PASSWORD_CHANGE', destination: user.email });
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể gửi mã xác nhận' });
    }
  });

  app.post('/api/account/password/change/confirm', async (req, res) => {
    try {
      const user = await db.user.findUnique({ where: { id: req.user.id } });
      await verifyCurrentPassword(user, req.body.currentPassword);
      await consumeEmailCode({ userId: user.id, purpose: 'PASSWORD_CHANGE', destination: user.email, code: req.body.code });
      const passwordHash = await hashPassword(req.body.newPassword);

      await db.$transaction([
        db.user.update({
          where: { id: user.id },
          data: { passwordHash, emailVerifiedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        }),
        db.session.deleteMany({ where: { userId: user.id, id: { not: req.session.id } } }),
      ]);
      const updated = await db.user.findUnique({ where: { id: user.id } });
      res.json({ ok: true, user: publicUser(updated), otherSessionsRevoked: true });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể đổi mật khẩu' });
    }
  });

  app.get('/api/account/sessions', async (req, res) => {
    try {
      const rows = await db.session.findMany({
        where: { userId: req.user.id, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
          deviceName: true,
          ipAddress: true,
          userAgent: true,
        },
      });
      res.json(rows.map(s => ({ ...s, current: s.id === req.session.id })));
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể tải phiên đăng nhập' });
    }
  });

  app.delete('/api/account/sessions/:id', async (req, res) => {
    try {
      const session = await db.session.findFirst({ where: { id: req.params.id, userId: req.user.id } });
      if (!session) return res.status(404).json({ error: 'Không tìm thấy phiên đăng nhập' });
      await db.session.delete({ where: { id: session.id } });
      if (session.id === req.session.id) clearSessionCookie(res);
      res.json({ ok: true, currentRevoked: session.id === req.session.id });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể đăng xuất phiên' });
    }
  });

  app.post('/api/account/sessions/revoke-others', async (req, res) => {
    try {
      const out = await db.session.deleteMany({ where: { userId: req.user.id, id: { not: req.session.id } } });
      res.json({ ok: true, revoked: out.count });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Không thể đăng xuất các thiết bị khác' });
    }
  });
}

module.exports = {
  publicUser,
  requireCompleteProfile,
  registerPublicAccountRoutes,
  registerProtectedAccountRoutes,
};
