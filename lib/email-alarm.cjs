const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function createEmailAlarm({ root, env = process.env, mailer = require('nodemailer'), now = Date.now } = {}) {
  const file = path.join(root, 'data/email-alarm.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let busy = false;
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(state));
    fs.renameSync(file + '.tmp', file);
  }
  function observe(sample) {
    if (typeof sample?.alarm !== 'boolean') return;
    if (!sample.alarm) {
      state.active = false; state.pending = null; save(); return;
    }
    if (!state.active) {
      state.active = true;
      state.pending = { id: crypto.randomUUID(), at: sample.receivedAt, temperatureC: sample.temperatureC };
      save();
    }
  }
  async function deliver(sample, availability) {
    if (busy || !state.pending || !sample?.alarm || !Number.isFinite(sample.temperatureC) || now() - sample.receivedAt > 15000 || availability === 'offline') return null;
    if (state.lastAttempt && now() - state.lastAttempt < 30000) return null;
    const to = env.ALERT_TO || env.REPORT_TO;
    if (!env.SMTP_USER || !env.SMTP_PASS || !to) return { ok: false, text: 'Chưa cấu hình Gmail SMTP_USER, SMTP_PASS hoặc ALERT_TO.' };
    const event = { ...state.pending };
    busy = true; state.lastAttempt = now(); save();
    const port = Number(env.SMTP_PORT || 465);
    const transport = mailer.createTransport({ host: env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
    try {
      const info = await transport.sendMail({ from: env.SMTP_USER, to,
        messageId: '<parking-' + event.id + '@smart-parking.local>',
        subject: 'Smart Parking — Cảnh báo nhiệt độ cao',
        text: 'CẢNH BÁO NHIỆT ĐỘ CAO\nNhiệt độ khi bắt đầu cảnh báo: ' + event.temperatureC + ' °C\nThời điểm: ' + new Date(event.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) + '\nNguồn: DHT11 → ESP32 → MQTT → Node-RED. Còi cảnh báo được xử lý tại ESP32.' });
      if (!info.accepted?.length || info.rejected?.length) throw new Error('Recipient not accepted');
      if (state.pending?.id === event.id) { state.pending = null; state.sentAt = now(); save(); }
      return { ok: true, text: 'Máy chủ Gmail đã nhận email cảnh báo.' };
    } catch {
      return { ok: false, text: 'Gửi email chưa thành công; thử lại sau 30 giây khi dữ liệu còn mới và còn cảnh báo.' };
    } finally { transport.close(); busy = false; }
  }
  return { observe, deliver };
}
module.exports = { createEmailAlarm };
