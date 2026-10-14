'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { db } = require('./common');

const LOG_DIR = process.env.META_LOG_DIR || '/app/logs';
const LOG_FILE = path.join(LOG_DIR, 'meta-api.jsonl');
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const KEEP_LOG_BYTES = 5 * 1024 * 1024;
const als = new AsyncLocalStorage();
let routeRegistered = false;
let rotating = false;

fs.mkdirSync(LOG_DIR, { recursive: true });

const SECRET_KEY = /(access[_-]?token|token|secret|authorization|password|code|proof|cookie|signature|verify)/i;

function shortId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function redact(value, key = '') {
  if (SECRET_KEY.test(String(key))) return '[REDACTED]';
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(v => redact(v));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  return value;
}

function sanitizeUrl(raw) {
  try {
    const u = new URL(String(raw));
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) u.searchParams.set(key, '[REDACTED]');
    }
    return u.toString();
  } catch {
    return String(raw || '').slice(0, 1000);
  }
}

function safeRequestBody(body) {
  if (body == null) return null;
  try {
    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (!trimmed) return null;
      try { return redact(JSON.parse(trimmed)); } catch {}
      const params = new URLSearchParams(trimmed);
      if ([...params.keys()].length) return redact(Object.fromEntries(params.entries()));
      return trimmed.slice(0, 1000);
    }
    if (body instanceof URLSearchParams) return redact(Object.fromEntries(body.entries()));
    return redact(body);
  } catch {
    return '[unavailable]';
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function classifyMetaRequest(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return null; }
  if (!/(^|\.)graph\.facebook\.com$/i.test(u.hostname)) return null;
  const p = u.pathname;
  if (p.endsWith('/oauth/access_token')) {
    return {
      category: 'OAUTH',
      step: u.searchParams.get('grant_type') === 'fb_exchange_token' ? 'OAUTH_LONG_LIVED_TOKEN' : 'OAUTH_CODE_EXCHANGE',
    };
  }
  if (/\/me\/accounts$/.test(p)) return { category: 'OAUTH', step: 'FETCH_MANAGED_PAGES' };
  if (/\/subscribed_apps$/.test(p)) return { category: 'WEBHOOK', step: 'SUBSCRIBE_PAGE_WEBHOOK' };
  if (/\/me\/messages$/.test(p)) return { category: 'MESSENGER', step: 'SEND_MESSAGE' };
  return { category: 'GRAPH', step: 'GRAPH_API_REQUEST' };
}

function successMessage(step) {
  return ({
    OAUTH_CODE_EXCHANGE: 'Đổi authorization code sang User Access Token thành công',
    OAUTH_LONG_LIVED_TOKEN: 'Đổi sang User Access Token dài hạn thành công',
    FETCH_MANAGED_PAGES: 'Lấy danh sách Fanpage quản lý thành công',
    SUBSCRIBE_PAGE_WEBHOOK: 'Đăng ký Page nhận webhook thành công',
    SEND_MESSAGE: 'Gửi tin nhắn qua Messenger API thành công',
    GRAPH_API_REQUEST: 'Meta Graph API trả về thành công',
  })[step] || 'Meta API thành công';
}

function safeMetaResponse(step, payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.error) {
    return {
      error: redact({
        message: payload.error.message,
        type: payload.error.type,
        code: payload.error.code,
        error_subcode: payload.error.error_subcode,
        fbtrace_id: payload.error.fbtrace_id,
      }),
    };
  }
  if (step === 'FETCH_MANAGED_PAGES') {
    const pages = Array.isArray(payload.data) ? payload.data : [];
    return {
      pageCount: pages.length,
      pages: pages.slice(0, 50).map(p => ({ id: p.id, name: p.name, tasks: p.tasks })),
      hasNextPage: !!payload.paging?.next,
    };
  }
  if (step === 'OAUTH_CODE_EXCHANGE' || step === 'OAUTH_LONG_LIVED_TOKEN') {
    return {
      accessTokenReturned: !!payload.access_token,
      tokenType: payload.token_type || null,
      expiresIn: payload.expires_in || null,
    };
  }
  if (step === 'SEND_MESSAGE') return redact({ recipient_id: payload.recipient_id, message_id: payload.message_id });
  return redact(payload);
}

async function rotateIfNeeded() {
  if (rotating) return;
  rotating = true;
  try {
    const stat = await fs.promises.stat(LOG_FILE).catch(() => null);
    if (!stat || stat.size <= MAX_LOG_BYTES) return;
    const data = await fs.promises.readFile(LOG_FILE);
    const tail = data.subarray(Math.max(0, data.length - KEEP_LOG_BYTES));
    const firstNl = tail.indexOf(10);
    await fs.promises.writeFile(LOG_FILE, firstNl >= 0 ? tail.subarray(firstNl + 1) : tail);
  } catch (e) {
    process.stderr.write(`[meta-observability] rotate failed: ${e.message}\n`);
  } finally {
    rotating = false;
  }
}

async function writeLog(entry) {
  try {
    const ctx = als.getStore() || {};
    const row = {
      id: crypto.randomUUID(),
      flowId: entry.flowId || ctx.flowId || crypto.randomUUID(),
      userId: entry.userId || ctx.userId || null,
      category: entry.category || 'META',
      step: entry.step || 'UNKNOWN',
      status: entry.status || 'INFO',
      method: entry.method || null,
      endpoint: entry.endpoint ? sanitizeUrl(entry.endpoint) : null,
      httpStatus: Number.isFinite(entry.httpStatus) ? entry.httpStatus : null,
      durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
      message: String(entry.message || '').slice(0, 1000),
      details: redact(entry.details || null),
      createdAt: new Date().toISOString(),
    };
    await fs.promises.appendFile(LOG_FILE, JSON.stringify(row) + '\n', 'utf8');
    if (Math.random() < 0.02) rotateIfNeeded();
  } catch (e) {
    process.stderr.write(`[meta-observability] write failed: ${e.message}\n`);
  }
}

async function readLogs({ limit = 300, status, step, q } = {}) {
  const max = Math.max(1, Math.min(1000, Number(limit) || 300));
  const text = await fs.promises.readFile(LOG_FILE, 'utf8').catch(() => '');
  const lines = text.split('\n').filter(Boolean);
  const rows = [];
  for (let i = lines.length - 1; i >= 0 && rows.length < max; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (status && row.status !== status) continue;
      if (step && row.step !== step) continue;
      if (q) {
        const hay = `${row.step} ${row.message} ${row.endpoint || ''} ${row.flowId || ''}`.toLowerCase();
        if (!hay.includes(String(q).toLowerCase())) continue;
      }
      rows.push(row);
    } catch {}
  }
  return rows;
}

function decodeStateUserId(state) {
  try {
    const raw = Buffer.from(String(state || ''), 'base64url').toString('utf8');
    const parts = raw.split('.');
    return parts.length >= 4 ? parts[1] : null;
  } catch { return null; }
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGIN || '').split(',')[0].replace(/\/$/, '');
}

function installFetchTracing() {
  if (global.__mocMetaFetchWrapped || typeof global.fetch !== 'function') return;
  global.__mocMetaFetchWrapped = true;
  const originalFetch = global.fetch.bind(global);
  global.__mocOriginalFetch = originalFetch;

  global.fetch = async function tracedFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || input);
    const meta = classifyMetaRequest(rawUrl);
    if (!meta) return originalFetch(input, init);

    const started = Date.now();
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    const ctx = als.getStore() || {};
    let response;
    try {
      response = await originalFetch(input, init);
      let payload = null;
      try { payload = parseJson(await response.clone().text()); } catch {}
      const apiError = payload?.error;
      await writeLog({
        flowId: ctx.flowId,
        userId: ctx.userId,
        category: meta.category,
        step: meta.step,
        status: response.ok && !apiError ? 'SUCCESS' : 'ERROR',
        method,
        endpoint: rawUrl,
        httpStatus: response.status,
        durationMs: Date.now() - started,
        message: apiError?.message ? `Meta lỗi: ${apiError.message}` : response.ok ? successMessage(meta.step) : `Meta API HTTP ${response.status}`,
        details: {
          request: { body: safeRequestBody(init?.body) },
          response: safeMetaResponse(meta.step, payload),
        },
      });
      return response;
    } catch (e) {
      await writeLog({
        flowId: ctx.flowId,
        userId: ctx.userId,
        category: meta.category,
        step: meta.step,
        status: 'ERROR',
        method,
        endpoint: rawUrl,
        durationMs: Date.now() - started,
        message: `Không kết nối được Meta API: ${e.message}`,
        details: { error: e.message },
      });
      throw e;
    }
  };
}

function installConsoleErrorTracing() {
  if (global.__mocMetaConsoleWrapped) return;
  global.__mocMetaConsoleWrapped = true;
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    try {
      const first = String(args[0] || '');
      if (first.includes('Facebook OAuth callback')) {
        const err = args.find(v => v instanceof Error);
        writeLog({
          category: 'OAUTH',
          step: 'OAUTH_CALLBACK_ERROR',
          status: 'ERROR',
          message: err?.message || String(args[1] || 'Facebook OAuth callback lỗi'),
        });
      }
    } catch {}
    return originalError(...args);
  };
}

function installExpressTracing() {
  const resolved = require.resolve('express');
  const originalExpress = require('express');
  if (originalExpress.__mocMetaWrapped) return;

  function wrappedExpress(...args) {
    const app = originalExpress(...args);

    app.use((req, res, next) => {
      const requestPath = req.path || req.url?.split('?')[0] || '';
      const state = req.query?.state;
      const ctx = {
        flowId: state ? `oauth-${shortId(state)}` : crypto.randomUUID(),
        userId: state ? decodeStateUserId(state) : null,
        path: requestPath,
      };

      if (requestPath === '/api/facebook/login-url') {
        const originalJson = res.json.bind(res);
        res.json = body => {
          try {
            if (body?.url) {
              const oauthUrl = new URL(body.url);
              const oauthState = oauthUrl.searchParams.get('state');
              if (oauthState) ctx.flowId = `oauth-${shortId(oauthState)}`;
              ctx.loginUrlDetails = {
                graphVersion: process.env.META_GRAPH_VERSION || 'v23.0',
                redirectUri: oauthUrl.searchParams.get('redirect_uri'),
                scopes: String(oauthUrl.searchParams.get('scope') || '').split(',').filter(Boolean),
              };
            }
          } catch {}
          return originalJson(body);
        };
      }

      res.on('finish', () => {
        try {
          const userId = req.user?.id || ctx.userId || null;
          if (requestPath === '/api/facebook/login-url') {
            writeLog({
              flowId: ctx.flowId,
              userId,
              category: 'OAUTH',
              step: 'CREATE_LOGIN_URL',
              status: res.statusCode < 400 ? 'SUCCESS' : 'ERROR',
              method: req.method,
              endpoint: requestPath,
              httpStatus: res.statusCode,
              message: res.statusCode < 400 ? 'Đã tạo URL đăng nhập Facebook' : 'Không tạo được URL đăng nhập Facebook',
              details: ctx.loginUrlDetails,
            });
          } else if (requestPath === '/auth/facebook/callback') {
            writeLog({
              flowId: ctx.flowId,
              userId,
              category: 'OAUTH',
              step: 'OAUTH_CALLBACK',
              status: res.statusCode < 400 ? 'SUCCESS' : 'ERROR',
              method: req.method,
              endpoint: requestPath,
              httpStatus: res.statusCode,
              message: res.statusCode < 400 ? 'OAuth callback hoàn tất' : `OAuth callback thất bại${req.query?.error_description ? ': ' + req.query.error_description : ''}`,
              details: { hasCode: !!req.query?.code, facebookError: req.query?.error || null },
            });
          } else if (requestPath === '/webhook' && req.method === 'GET') {
            writeLog({
              category: 'WEBHOOK',
              step: 'WEBHOOK_VERIFY',
              status: res.statusCode === 200 ? 'SUCCESS' : 'ERROR',
              method: 'GET',
              endpoint: '/webhook',
              httpStatus: res.statusCode,
              message: res.statusCode === 200 ? 'Meta xác minh Webhook thành công' : 'Meta xác minh Webhook thất bại: Verify Token hoặc mode không hợp lệ',
              details: { mode: req.query?.['hub.mode'] || null, challengePresent: !!req.query?.['hub.challenge'] },
            });
          } else if (requestPath === '/webhook' && req.method === 'POST') {
            const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
            writeLog({
              category: 'WEBHOOK',
              step: 'WEBHOOK_EVENT',
              status: res.statusCode < 400 ? 'SUCCESS' : 'ERROR',
              method: 'POST',
              endpoint: '/webhook',
              httpStatus: res.statusCode,
              message: res.statusCode < 400 ? 'Đã nhận sự kiện Webhook từ Meta' : 'Webhook bị từ chối; kiểm tra App Secret và X-Hub-Signature-256',
              details: { object: req.body?.object || null, entryCount: entries.length, pageIds: entries.slice(0, 20).map(e => e.id).filter(Boolean) },
            });
          }
        } catch {}
      });

      als.run(ctx, () => next());
    });

    const originalListen = app.listen.bind(app);
    app.listen = (...listenArgs) => {
      registerAdminRoutes(app);
      return originalListen(...listenArgs);
    };
    return app;
  }

  for (const key of Object.keys(originalExpress)) wrappedExpress[key] = originalExpress[key];
  wrappedExpress.__mocMetaWrapped = true;
  require.cache[resolved].exports = wrappedExpress;
}

async function getLogFileSize() {
  const stat = await fs.promises.stat(LOG_FILE).catch(() => null);
  return stat?.size || 0;
}

function registerAdminRoutes(app) {
  if (routeRegistered) return;
  routeRegistered = true;

  app.get('/api/admin/meta-observability', async (req, res) => {
    try {
      const [logs, pages, logFileSize] = await Promise.all([
        readLogs({ limit: req.query.limit, status: req.query.status, step: req.query.step, q: req.query.q }),
        db.page.findMany({
          select: { id: true, pageId: true, name: true, enabled: true, tokenEncrypted: true, token: true, owner: { select: { email: true } } },
          orderBy: { createdAt: 'desc' },
          take: 500,
        }),
        getLogFileSize(),
      ]);
      const base = publicBaseUrl();
      res.json({
        config: {
          appId: process.env.META_APP_ID || '',
          appSecretConfigured: !!process.env.META_APP_SECRET,
          verifyTokenConfigured: !!process.env.META_VERIFY_TOKEN,
          oauthStateSecretConfigured: !!process.env.META_OAUTH_STATE_SECRET,
          graphVersion: process.env.META_GRAPH_VERSION || 'v23.0',
          redirectUri: process.env.META_REDIRECT_URI || '',
          webhookUrl: base ? `${base}/webhook` : '',
          scopes: String(process.env.META_OAUTH_SCOPES || 'pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement').split(',').map(x => x.trim()).filter(Boolean),
        },
        pages: pages.map(p => ({ id: p.id, pageId: p.pageId, name: p.name, enabled: p.enabled, ownerEmail: p.owner?.email || null, tokenConfigured: !!(p.tokenEncrypted || p.token) })),
        logs,
        logFileSize,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/meta-observability/test', async (req, res) => {
    const flowId = `diag-${crypto.randomUUID()}`;
    const result = { flowId, app: null, webhook: null };
    await als.run({ flowId, userId: req.user?.id || null, path: req.path }, async () => {
      try {
        const appId = process.env.META_APP_ID || '';
        const secret = process.env.META_APP_SECRET || '';
        if (!appId || !secret) throw new Error('Thiếu META_APP_ID hoặc META_APP_SECRET');
        const u = new URL(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/${encodeURIComponent(appId)}`);
        u.searchParams.set('fields', 'id,name');
        u.searchParams.set('access_token', `${appId}|${secret}`);
        const r = await global.fetch(u);
        const body = parseJson(await r.text());
        result.app = r.ok ? { ok: true, id: body?.id || appId, name: body?.name || null } : { ok: false, status: r.status, error: body?.error?.message || 'Meta App test failed' };
      } catch (e) {
        result.app = { ok: false, error: e.message };
      }

      try {
        const base = publicBaseUrl();
        const verify = process.env.META_VERIFY_TOKEN || '';
        if (!base || !verify) throw new Error('Thiếu PUBLIC_WEB_URL hoặc META_VERIFY_TOKEN');
        const challenge = `META_DIAGNOSTIC_${Date.now()}`;
        const u = new URL(`${base}/webhook`);
        u.searchParams.set('hub.mode', 'subscribe');
        u.searchParams.set('hub.verify_token', verify);
        u.searchParams.set('hub.challenge', challenge);
        const started = Date.now();
        const r = await (global.__mocOriginalFetch || global.fetch)(u);
        const text = await r.text();
        const ok = r.status === 200 && text === challenge;
        result.webhook = { ok, status: r.status, responseMatched: text === challenge };
        await writeLog({
          flowId,
          userId: req.user?.id,
          category: 'WEBHOOK',
          step: 'WEBHOOK_SELF_TEST',
          status: ok ? 'SUCCESS' : 'ERROR',
          method: 'GET',
          endpoint: `${base}/webhook`,
          httpStatus: r.status,
          durationMs: Date.now() - started,
          message: ok ? 'Tự kiểm tra URL Webhook và Verify Token thành công' : 'Tự kiểm tra Webhook thất bại',
          details: { responseMatched: text === challenge },
        });
      } catch (e) {
        result.webhook = { ok: false, error: e.message };
        await writeLog({ flowId, userId: req.user?.id, category: 'WEBHOOK', step: 'WEBHOOK_SELF_TEST', status: 'ERROR', message: e.message });
      }
    });
    res.json(result);
  });

  app.delete('/api/admin/meta-observability/logs', async (req, res) => {
    try {
      await fs.promises.writeFile(LOG_FILE, '', 'utf8');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

installFetchTracing();
installConsoleErrorTracing();
installExpressTracing();

module.exports = { writeLog, readLogs };
