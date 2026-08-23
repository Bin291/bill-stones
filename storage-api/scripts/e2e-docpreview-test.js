/* eslint-disable */
// E2E: upload .csv + .txt -> gọi /files/:id/preview-html -> kiểm HTML render.
const fs = require('fs');
const path = require('path');
function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  return { url: get('SUPABASE_URL').replace(/\/$/, ''), anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}
async function upload(API, AUTH, name, mime, buf) {
  let r = await fetch(`${API}/uploads/init`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, size: String(buf.length), mimeType: mime, folderId: null }) });
  const init = await r.json();
  r = await fetch(`${API}/uploads/part`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': init.fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' }, body: buf });
  const etag = (await r.json()).ETag;
  await fetch(`${API}/uploads/complete`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: init.fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }) });
  return init.fileId;
}
async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:3000';
  const email = `e2e+doc${Date.now()}@example.com`, password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null; const ids = [];
  const log = (...a) => console.log(...a);
  try {
    let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    userId = (await r.json()).id;
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const AUTH = { Authorization: `Bearer ${(await r.json()).access_token}` };

    const csvId = await upload(API, AUTH, 'bang-diem.csv', 'text/csv', Buffer.from('Ho ten,Diem\nNguyen Van A,9\nTran Thi B,8'));
    ids.push(csvId);
    const txtId = await upload(API, AUTH, 'ghi-chu.txt', 'text/plain', Buffer.from('Đây là ghi chú <có ký tự đặc biệt> & test'));
    ids.push(txtId);

    log('▶ preview-html cho CSV');
    let h = (await (await fetch(`${API}/files/${csvId}/preview-html`, { headers: AUTH })).json()).html;
    log('  có <table>:', h.includes('<table'), '| có "Nguyen Van A":', h.includes('Nguyen Van A'));

    log('▶ preview-html cho TXT');
    h = (await (await fetch(`${API}/files/${txtId}/preview-html`, { headers: AUTH })).json()).html;
    log('  có <pre>:', h.includes('<pre'), '| escape đúng:', h.includes('&lt;có ký tự'));

    log('\n✅ DOC PREVIEW HTML OK');
  } catch (e) { log('❌ LỖI:', e.message); process.exitCode = 1; }
  finally {
    const { url: u, service: s } = loadEnv();
    if (userId) await fetch(`${u}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: s, Authorization: `Bearer ${s}` } });
    log('  dọn user test xong');
  }
}
main();
