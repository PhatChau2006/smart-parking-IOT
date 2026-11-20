// Server-only Supabase Data API/Auth adapter. Never expose service keys or tokens to Dashboard.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createService({ env = process.env, root = path.resolve(__dirname, '..'), fetchImpl = fetch, now = Date.now } = {}) {
  const locks = new Map();
  const sessionDir = path.join(root, 'data/sessions');
  const duration = 8 * 3600000;
  function config() {
    const url = (env.SUPABASE_URL || '').replace(/\/$/, '');
    const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
    const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!/^https:\/\//.test(url) || !publicKey) throw new Error('Supabase chưa được cấu hình.');
    return { url, publicKey, secretKey };
  }
  async function request(route, { method = 'GET', body, token, database = false, headers = {} } = {}) {
    const c = config();
    const key = database ? c.secretKey : c.publicKey;
    if (!key) throw new Error('Thiếu khóa máy chủ Supabase.');
    const h = { apikey: key, 'Content-Type': 'application/json', ...headers };
    // New sb_secret keys belong in apikey, not the JWT Authorization header.
    if (token) h.Authorization = 'Bearer ' + token;
    else if (database && key.split('.').length === 3) h.Authorization = 'Bearer ' + key;
    const response = await fetchImpl(c.url + route, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let value;
    try { value = text ? JSON.parse(text) : null; } catch { value = null; }
    if (!response.ok) {
      const error = new Error('Supabase request failed');
      error.status = response.status;
      error.code = value?.error_code || value?.code || 'supabase_error';
      throw error;
    }
    return value;
  }
  function encryptionKey() {
    if (!env.NODE_RED_CREDENTIAL_SECRET || env.NODE_RED_CREDENTIAL_SECRET.length < 16) throw new Error('Cần NODE_RED_CREDENTIAL_SECRET ít nhất 16 ký tự.');
    return crypto.createHash('sha256').update(env.NODE_RED_CREDENTIAL_SECRET).digest();
  }
  function file(id) { return path.join(sessionDir, crypto.createHash('sha256').update(id).digest('hex') + '.json'); }
  function save(id, record) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
    fs.mkdirSync(sessionDir, { recursive: true });
    const target = file(id);
    fs.writeFileSync(target + '.tmp', JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('base64') }), { mode: 0o600 });
    fs.renameSync(target + '.tmp', target);
  }
  function load(id) {
    try {
      const value = JSON.parse(fs.readFileSync(file(id), 'utf8'));
      const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'hex'));
      cipher.setAuthTag(Buffer.from(value.tag, 'hex'));
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString());
    } catch { throw Object.assign(new Error('Authentication required'), { status: 401 }); }
  }
  function cookieId(req) {
    const value = (req.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('parking_session='))?.slice(16);
    if (!value || !/^[a-f0-9]{64}$/.test(value)) throw Object.assign(new Error('Authentication required'), { status: 401 });
    return value;
  }
  async function withSession(id, work) {
    const previous = locks.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    locks.set(id, task);
    try { return await task; } finally { if (locks.get(id) === task) locks.delete(id); }
  }
  async function authenticate(action, email, password) {
    return request(action === 'register' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  }
  function createSession(result) {
    if (!result.access_token || !result.refresh_token || !result.user?.id) throw new Error('No authenticated session');
    const id = crypto.randomBytes(32).toString('hex');
    save(id, { access: result.access_token, refresh: result.refresh_token, uid: result.user.id, expires: now() + duration, tokenExpires: now() + (result.expires_in || 3600) * 1000 });
    return { id, maxAge: duration / 1000 };
  }
  async function verifySession(req) {
    const id = cookieId(req);
    return withSession(id, async () => {
      const record = load(id);
      if (record.expires <= now()) {
        fs.rmSync(file(id), { force: true });
        throw Object.assign(new Error('Authentication required'), { status: 401 });
      }
      if (record.tokenExpires <= now() + 60000) {
        try {
          const result = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: record.refresh } });
          record.access = result.access_token; record.refresh = result.refresh_token;
          record.tokenExpires = now() + result.expires_in * 1000;
          save(id, record);
        } catch (error) {
          if ([400, 401, 403].includes(error.status)) { fs.rmSync(file(id), { force: true }); error.status = 401; }
          throw error;
        }
      }
      const user = await request('/auth/v1/user', { token: record.access });
      if (user.id !== record.uid) throw Object.assign(new Error('Authentication required'), { status: 401 });
      return { uid: user.id, email: user.email, exp: Math.floor(record.expires / 1000) };
    });
  }
  async function logout(req) {
    let id;
    try { id = cookieId(req); } catch { return; }
    return withSession(id, async () => {
      let record;
      try { record = load(id); } catch { return; }
      // Local revocation is immediate even when the remote service is unavailable.
      fs.rmSync(file(id), { force: true });
      try { await request('/auth/v1/logout?scope=local', { method: 'POST', token: record.access }); } catch { /* opaque cookie is already revoked */ }
    });
  }
  async function writeEvent(item) {
    const state = item.state;
    if (!item.id || !Number.isFinite(state?.receivedAt)) throw new Error('Invalid event');
    await request('/rest/v1/parking_events?on_conflict=id', { database: true, method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: { id: item.id, kind: state.kind || 'occupancy', received_at: state.receivedAt, payload: state } });
  }
  async function history({ kind, start, end, limit = 500, ascending = false, offset = 0 } = {}) {
    const q = new URLSearchParams({ select: 'id,payload', order: 'received_at.' + (ascending ? 'asc' : 'desc') + ',id.' + (ascending ? 'asc' : 'desc'), limit: String(limit), offset: String(offset) });
    if (kind) q.set('kind', 'eq.' + kind);
    if (start !== undefined) q.append('received_at', 'gte.' + start);
    if (end !== undefined) q.append('received_at', 'lte.' + end);
    const rows = await request('/rest/v1/parking_events?' + q, { database: true });
    return rows.map(row => ({ ...row.payload, key: row.id }));
  }
  async function dayHistory(start, end) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await history({ kind: 'occupancy', start, end, ascending: true, limit: 500, offset });
      rows.push(...page);
      if (page.length < 500) break;
    }
    const baseline = (await history({ kind: 'occupancy', end: start - 1, limit: 1 }))[0] || null;
    return { rows, baseline };
  }
  return { authenticate, createSession, verifySession, logout, writeEvent, history, dayHistory };
}
module.exports = { createService };
