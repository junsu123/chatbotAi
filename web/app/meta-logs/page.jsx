'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './meta-logs.module.css';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const dt = v => v ? new Date(v).toLocaleString('vi-VN') : '—';
const kb = n => `${(Number(n || 0) / 1024).toFixed(1)} KB`;

async function call(path, method = 'GET') {
  const r = await fetch(BASE + path, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
  let body = {}; try { body = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(body.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return body;
}

function statusLabel(status) {
  return status === 'SUCCESS' ? 'Thành công' : status === 'ERROR' ? 'Lỗi' : 'Thông tin';
}

function stepLabel(step) {
  const map = {
    CREATE_LOGIN_URL: '1. Tạo URL đăng nhập Facebook',
    OAUTH_CALLBACK: '2. Nhận OAuth callback',
    OAUTH_CALLBACK_ERROR: 'OAuth callback lỗi',
    OAUTH_CODE_EXCHANGE: '3. Đổi code → User Access Token',
    OAUTH_LONG_LIVED_TOKEN: '4. Đổi token dài hạn',
    FETCH_MANAGED_PAGES: '5. Lấy danh sách Fanpage',
    SUBSCRIBE_PAGE_WEBHOOK: '6. Đăng ký webhook cho Page',
    WEBHOOK_VERIFY: 'Xác minh Webhook từ Meta',
    WEBHOOK_SELF_TEST: 'Tự kiểm tra Webhook',
    WEBHOOK_EVENT: 'Nhận sự kiện Webhook',
    SEND_MESSAGE: 'Gửi tin nhắn Messenger',
    GRAPH_API_REQUEST: 'Graph API khác',
  };
  return map[step] || step;
}

export default function MetaLogsPage() {
  const [me, setMe] = useState(null);
  const [data, setData] = useState({ config: {}, pages: [], logs: [], logFileSize: 0 });
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [auto, setAuto] = useState(true);

  const load = useCallback(async () => {
    try {
      const user = await call('/auth/me');
      setMe(user.user);
      if (user.user?.role !== 'SUPER_ADMIN') { setError('Chỉ Super Admin được xem Meta API Logs.'); return; }
      const out = await call('/api/admin/meta-observability?limit=500');
      setData(out);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!auto || me?.role !== 'SUPER_ADMIN') return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [auto, load, me]);

  async function runTest() {
    setTesting(true); setError(''); setInfo('');
    try {
      const r = await call('/api/admin/meta-observability/test', 'POST');
      const ok = r.app?.ok && r.webhook?.ok;
      setInfo(ok ? 'Kiểm tra Meta App + Webhook thành công.' : 'Đã chạy kiểm tra. Có bước chưa thành công, xem log bên dưới.');
      await load();
    } catch (e) { setError(e.message); }
    finally { setTesting(false); }
  }

  async function clearLogs() {
    if (!window.confirm('Xóa toàn bộ Meta API log hiện tại?')) return;
    try {
      await call('/api/admin/meta-observability/logs', 'DELETE');
      setInfo('Đã xóa log.');
      await load();
    } catch (e) { setError(e.message); }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.logs || []).filter(x => {
      if (status && x.status !== status) return false;
      if (!q) return true;
      return `${x.step} ${x.message} ${x.endpoint || ''} ${x.flowId || ''}`.toLowerCase().includes(q);
    });
  }, [data.logs, query, status]);

  const flows = useMemo(() => {
    const groups = new Map();
    for (const log of filtered) {
      const key = log.flowId || log.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(log);
    }
    return [...groups.entries()].map(([flowId, logs]) => ({
      flowId,
      logs: logs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      hasError: logs.some(x => x.status === 'ERROR'),
      latest: logs.reduce((m, x) => new Date(x.createdAt) > new Date(m.createdAt) ? x : m, logs[0]),
    })).sort((a, b) => new Date(b.latest.createdAt) - new Date(a.latest.createdAt));
  }, [filtered]);

  if (loading) return <main className={styles.center}>Đang tải Meta API Logs…</main>;
  if (!me) return <main className={styles.center}><div><h1>Chưa đăng nhập</h1><a href="/">Về trang đăng nhập</a></div></main>;

  const cfg = data.config || {};
  const checks = [
    ['META_APP_ID', !!cfg.appId, cfg.appId || 'Chưa cấu hình'],
    ['META_APP_SECRET', !!cfg.appSecretConfigured, cfg.appSecretConfigured ? 'Đã cấu hình' : 'Chưa cấu hình'],
    ['META_VERIFY_TOKEN', !!cfg.verifyTokenConfigured, cfg.verifyTokenConfigured ? 'Đã cấu hình' : 'Chưa cấu hình'],
    ['META_OAUTH_STATE_SECRET', !!cfg.oauthStateSecretConfigured, cfg.oauthStateSecretConfigured ? 'Đã cấu hình' : 'Chưa cấu hình'],
    ['OAuth Redirect URI', /^https:\/\//.test(cfg.redirectUri || ''), cfg.redirectUri || 'Chưa cấu hình'],
    ['Webhook URL', /^https:\/\//.test(cfg.webhookUrl || ''), cfg.webhookUrl || 'Chưa cấu hình'],
  ];

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <a className={styles.back} href="/">← Dashboard</a>
        <h1>Meta API Diagnostics</h1>
        <p>Theo dõi từng bước OAuth, Graph API, Webhook và Messenger để xác định chính xác lỗi kết nối.</p>
      </div>
      <div className={styles.actions}>
        <button onClick={runTest} disabled={testing}>{testing ? 'Đang kiểm tra…' : 'Chạy kiểm tra Meta'}</button>
        <button className={styles.secondary} onClick={load}>Làm mới</button>
      </div>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {info && <div className={styles.info}>{info}</div>}

    <section className={styles.grid}>
      <div className={styles.card}>
        <h2>Cấu hình Meta</h2>
        <div className={styles.checks}>{checks.map(([name, ok, value]) => <div className={styles.check} key={name}>
          <span className={ok ? styles.dotOk : styles.dotBad} />
          <div><b>{name}</b><small>{value}</small></div>
        </div>)}</div>
        <div className={styles.metaLine}><b>Graph:</b> {cfg.graphVersion || '—'}</div>
        <div className={styles.metaLine}><b>Scopes:</b> {(cfg.scopes || []).join(', ') || '—'}</div>
      </div>

      <div className={styles.card}>
        <h2>Fanpage đã lưu</h2>
        <div className={styles.bigNumber}>{(data.pages || []).length}</div>
        <p>{(data.pages || []).filter(x => x.tokenConfigured).length} Page có Access Token · {(data.pages || []).filter(x => x.enabled).length} Page đang bật AI</p>
        <div className={styles.pageList}>{(data.pages || []).slice(0, 8).map(p => <div key={p.id}><span className={p.tokenConfigured ? styles.dotOk : styles.dotBad} /><b>{p.name}</b><small>{p.pageId} · {p.ownerEmail || 'không có owner'}</small></div>)}</div>
      </div>
    </section>

    <section className={styles.card}>
      <div className={styles.toolbar}>
        <div>
          <h2>Luồng kết nối Meta</h2>
          <p>{filtered.length} log · {flows.length} luồng · file {kb(data.logFileSize)}</p>
        </div>
        <div className={styles.filters}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm lỗi, endpoint, flow…" />
          <select value={status} onChange={e => setStatus(e.target.value)}><option value="">Tất cả trạng thái</option><option value="SUCCESS">Thành công</option><option value="ERROR">Lỗi</option><option value="INFO">Thông tin</option></select>
          <label className={styles.auto}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Auto 5s</label>
          <button className={styles.danger} onClick={clearLogs}>Xóa log</button>
        </div>
      </div>

      {!flows.length && <div className={styles.empty}>Chưa có log. Bấm <b>Chạy kiểm tra Meta</b> hoặc thử <b>Kết nối với Facebook</b> trong Dashboard.</div>}

      <div className={styles.flows}>{flows.map(flow => <article className={`${styles.flow} ${flow.hasError ? styles.flowError : ''}`} key={flow.flowId}>
        <div className={styles.flowHead}>
          <div><b>{flow.hasError ? '⚠ Luồng có lỗi' : '✓ Luồng thành công / đang xử lý'}</b><small>Flow: {flow.flowId}</small></div>
          <time>{dt(flow.latest.createdAt)}</time>
        </div>
        <div className={styles.timeline}>{flow.logs.map(log => <div className={styles.log} key={log.id}>
          <span className={log.status === 'SUCCESS' ? styles.markerOk : log.status === 'ERROR' ? styles.markerBad : styles.markerInfo} />
          <div className={styles.logBody}>
            <div className={styles.logTop}><b>{stepLabel(log.step)}</b><span className={`${styles.badge} ${log.status === 'SUCCESS' ? styles.success : log.status === 'ERROR' ? styles.failed : styles.neutral}`}>{statusLabel(log.status)}</span></div>
            <div className={styles.message}>{log.message}</div>
            <div className={styles.logMeta}>
              <span>{dt(log.createdAt)}</span>
              {log.method && <span>{log.method}</span>}
              {log.httpStatus != null && <span>HTTP {log.httpStatus}</span>}
              {log.durationMs != null && <span>{log.durationMs} ms</span>}
              <span>{log.category}</span>
            </div>
            {log.endpoint && <code className={styles.endpoint}>{log.endpoint}</code>}
            {log.details && <details className={styles.details}><summary>Chi tiết kỹ thuật</summary><pre>{JSON.stringify(log.details, null, 2)}</pre></details>}
          </div>
        </div>)}</div>
      </article>)}</div>
    </section>

    <section className={styles.note}>
      <b>Bảo mật log:</b> Access Token, App Secret, authorization code, verify token, chữ ký và appsecret_proof được tự động che trước khi ghi log. Không dùng màn hình này để hiển thị secret thực tế.
    </section>
  </main>;
}
