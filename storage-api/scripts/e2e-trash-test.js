/* eslint-disable */
// E2E: tạo user → upload file → trash → GET /trash (thấy 1) → POST /trash/empty →
// GET /trash (rỗng) + file đã biến mất. Xác minh "Dọn thùng rác" xoá thật.
const fs = require('fs');
const path = require('path');
function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
  return { url: get('SUPABASE_URL').replace(/\/$/, ''), anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}
async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:' + (process.env.PORT || '3000');
  const email = `e2e+trash${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null, fileId = null;
  const log = (...a) => console.log(...a); const step = (n) => log('\n▶ ' + n);
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
  try {
    let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    if (!r.ok) throw new Error(`admin ${r.status}`); userId = (await r.json()).id;
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const access = (await r.json()).access_token; const AUTH = { Authorization: `Bearer ${access}` }; const J = { ...AUTH, 'Content-Type': 'application/json' };
    step('1. Upload file');
    const bytes = Buffer.from('trash e2e ' + Date.now());
    r = await fetch(`${API}/uploads/init`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'to-trash.txt', size: String(bytes.length), mimeType: 'text/plain', folderId: null }) });
    const init = await r.json(); fileId = init.fileId;
    r = await fetch(`${API}/uploads/part`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' }, body: bytes });
    const etag = (await r.json()).ETag;
    await fetch(`${API}/uploads/complete`, { method: 'POST', headers: J, body: JSON.stringify({ fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }) });
    log('   fileId =', fileId);
    step('2. Chuyển vào Thùng rác');
    await fetch(`${API}/files/${fileId}/trash`, { method: 'PATCH', headers: AUTH });
    r = await fetch(`${API}/trash`, { headers: AUTH }); const before = await r.json();
    assert(before.some((i) => i.id === fileId), 'file phải có trong trash');
    log('   trash count =', before.length);
    step('3. POST /trash/empty (Dọn thùng rác)');
    r = await fetch(`${API}/trash/empty`, { method: 'POST', headers: AUTH });
    assert(r.ok, 'empty phải 2xx, nhận ' + r.status); log('   empty →', (await r.json()).success);
    step('4. Kiểm tra Thùng rác đã sạch + file biến mất');
    r = await fetch(`${API}/trash`, { headers: AUTH }); const after = await r.json();
    assert(!after.some((i) => i.id === fileId), 'file VẪN còn trong trash sau khi dọn!');
    r = await fetch(`${API}/files/${fileId}`, { headers: AUTH });
    assert(r.status === 404, 'file phải bị xoá hẳn (404), nhận ' + r.status);
    log('   trash count sau =', after.length, '| GET file =', r.status);
    fileId = null;
    log('\n✅ EMPTY-TRASH E2E THÀNH CÔNG');
  } catch (e) { log('\n❌ LỖI:', e.message); process.exitCode = 1;
    if (fileId) { try { const { url, service } = loadEnv(); } catch {} }
  } finally {
    if (userId) { const d = await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } }); console.log('   xoá user test:', d.status); }
  }
}
main();
