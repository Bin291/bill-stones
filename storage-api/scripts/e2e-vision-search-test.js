/* eslint-disable */
// E2E Vision auto-caption (mục 8.E §image): upload 1 ảnh thật -> chờ Gemini
// vision sinh OCR+MÔ TẢ+TỪ KHOÁ -> chunk/embed như text -> search bằng từ
// khoá mô tả (không phải OCR chữ trong ảnh) để xác nhận "tìm ảnh bằng ngôn
// ngữ tự nhiên" hoạt động. Dọn sạch bằng chính token của user test.
const fs = require('fs');
const path = require('path');
function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  return { url: get('SUPABASE_URL').replace(/\/$/, ''), anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:3000';
  const email = `e2e+vision${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null, fileId = null, AUTH = null;
  const log = (...a) => console.log(...a);
  try {
    let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    userId = (await r.json()).id;
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    AUTH = { Authorization: `Bearer ${(await r.json()).access_token}` };

    const bytes = fs.readFileSync(path.join(__dirname, '..', '..', 'storage', 'public', 'logo.png'));
    log('▶ upload logo.png,', bytes.length, 'bytes');
    r = await fetch(`${API}/uploads/init`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'logo-vision-test.png', size: String(bytes.length), mimeType: 'image/png', folderId: null }) });
    const init = await r.json(); fileId = init.fileId;
    r = await fetch(`${API}/uploads/part`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' }, body: bytes });
    const etag = (await r.json()).ETag;
    await fetch(`${API}/uploads/complete`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }) });

    const doSearch = async (q) => {
      const rr = await fetch(`${API}/search?q=${encodeURIComponent(q)}`, { headers: AUTH });
      return (await rr.json()).results || [];
    };

    log('▶ chờ vision caption + embed xong (dò tối đa 30s)');
    let found = null;
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const res = await doSearch('quét dữ liệu thư mục');
      found = res.find((x) => x.id === fileId);
      if (found) break;
    }
    if (!found) throw new Error('Không tìm thấy ảnh bằng mô tả ngữ nghĩa sau 30s');
    log('  ✅ tìm bằng mô tả "quét dữ liệu thư mục":', (found.similarity * 100).toFixed(1) + '%', found.matchedBy);

    for (const q of ['thư mục tài liệu', 'bánh răng', 'kính lúp']) {
      const res = await doSearch(q);
      const hit = res.find((x) => x.id === fileId);
      log(`  [${q}] ->`, hit ? `✅ ${(hit.similarity * 100).toFixed(1)}% ${hit.matchedBy}` : '❌ không thấy');
    }

    log('\n✅ VISION AUTO-CAPTION SEARCH E2E OK');
  } catch (e) {
    log('\n❌ LỖI:', e.message);
    process.exitCode = 1;
  } finally {
    if (fileId && AUTH) {
      await fetch(`${API}/files/${fileId}/trash`, { method: 'PATCH', headers: AUTH }).catch(() => {});
      await fetch(`${API}/files/${fileId}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
    }
    if (userId) {
      const d = await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } });
      log('  dọn user test:', d.status);
    }
  }
}
main();
