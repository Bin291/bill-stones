/* eslint-disable */
// E2E: tạo user test → upload 1 file nhỏ → tạo thẻ + sửa màu/tên → gán thẻ cho
// file → kiểm tra list file kèm tags + lăng kính Thẻ (GET /files?tagId=) → bỏ gán
// → xoá thẻ → dọn sạch. KHÔNG in token/secret. Chạy: node scripts/e2e-tags-test.js
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => {
    const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].trim() : '';
  };
  return { url: get('SUPABASE_URL').replace(/\/$/, ''), anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}

async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:' + (process.env.PORT || '3000');
  const email = `e2e+tags${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null, fileId = null, tagId = null;
  const log = (...a) => console.log(...a);
  const step = (n) => log('\n▶ ' + n);
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

  try {
    step('1. Admin tạo user test');
    let r = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!r.ok) throw new Error(`admin create ${r.status}: ${await r.text()}`);
    userId = (await r.json()).id;

    step('2. Lấy access token');
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(`grant ${r.status}`);
    const access = (await r.json()).access_token;
    const AUTH = { Authorization: `Bearer ${access}` };
    const J = { ...AUTH, 'Content-Type': 'application/json' };

    step('3. Upload 1 file nhỏ (init/part/complete)');
    const bytes = Buffer.from('tag e2e ' + Date.now());
    r = await fetch(`${API}/uploads/init`, { method: 'POST', headers: J,
      body: JSON.stringify({ name: 'tagged.txt', size: String(bytes.length), mimeType: 'text/plain', folderId: null }) });
    if (!r.ok) throw new Error(`init ${r.status}`);
    const init = await r.json(); fileId = init.fileId;
    r = await fetch(`${API}/uploads/part`, { method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' },
      body: bytes });
    if (!r.ok) throw new Error(`part ${r.status}`);
    const etag = (await r.json()).ETag;
    r = await fetch(`${API}/uploads/complete`, { method: 'POST', headers: J,
      body: JSON.stringify({ fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }) });
    if (!r.ok) throw new Error(`complete ${r.status}`);
    log('   fileId =', fileId);

    step('4. POST /tags (tạo thẻ "Quan trọng")');
    r = await fetch(`${API}/tags`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Quan trọng', color: '#da1e28' }) });
    if (!r.ok) throw new Error(`create tag ${r.status}: ${await r.text()}`);
    const tag = await r.json(); tagId = tag.id;
    assert(tag.name === 'Quan trọng' && tag.color === '#da1e28', 'thẻ tạo sai');
    log('   tagId =', tagId, '| color =', tag.color);

    step('5. Chống trùng tên (POST cùng tên → 409)');
    r = await fetch(`${API}/tags`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Quan trọng' }) });
    assert(r.status === 409, 'phải 409 khi trùng tên, nhận ' + r.status);
    log('   OK 409 trùng tên');

    step('6. PATCH /tags/:id (đổi tên + màu)');
    r = await fetch(`${API}/tags/${tagId}`, { method: 'PATCH', headers: J, body: JSON.stringify({ name: 'Ưu tiên', color: '#0f62fe' }) });
    if (!r.ok) throw new Error(`update ${r.status}`);
    const upd = await r.json();
    assert(upd.name === 'Ưu tiên' && upd.color === '#0f62fe', 'sửa thẻ sai');
    log('   → name =', upd.name, '| color =', upd.color);

    step('7. Gán thẻ cho file (POST /tags/:id/files/:fileId)');
    r = await fetch(`${API}/tags/${tagId}/files/${fileId}`, { method: 'POST', headers: AUTH });
    if (!r.ok) throw new Error(`assign ${r.status}`);

    step('8. GET /tags — fileCount = 1');
    r = await fetch(`${API}/tags`, { headers: AUTH });
    const tags = await r.json();
    const mine = tags.find((t) => t.id === tagId);
    assert(mine && mine.fileCount === 1, 'fileCount phải =1, nhận ' + (mine && mine.fileCount));
    log('   fileCount =', mine.fileCount);

    step('9. GET /files — file kèm mảng tags');
    r = await fetch(`${API}/files?folderId=`, { headers: AUTH });
    const files = await r.json();
    const f = files.find((x) => x.id === fileId);
    assert(f && Array.isArray(f.tags) && f.tags.some((t) => t.id === tagId), 'file thiếu tag');
    log('   file.tags =', f.tags.map((t) => t.name).join(','));

    step('10. Lăng kính Thẻ: GET /files?tagId= — chỉ file được gắn');
    r = await fetch(`${API}/files?tagId=${tagId}`, { headers: AUTH });
    const tagged = await r.json();
    assert(tagged.length === 1 && tagged[0].id === fileId, 'lọc theo tagId sai (' + tagged.length + ')');
    log('   số file trong lăng kính thẻ =', tagged.length);

    step('11. Bỏ gán (DELETE /tags/:id/files/:fileId)');
    r = await fetch(`${API}/tags/${tagId}/files/${fileId}`, { method: 'DELETE', headers: AUTH });
    if (!r.ok) throw new Error(`unassign ${r.status}`);
    r = await fetch(`${API}/files?tagId=${tagId}`, { headers: AUTH });
    assert((await r.json()).length === 0, 'sau bỏ gán phải rỗng');
    log('   OK lăng kính thẻ rỗng');

    step('12. DELETE /tags/:id');
    r = await fetch(`${API}/tags/${tagId}`, { method: 'DELETE', headers: AUTH });
    if (!r.ok) throw new Error(`delete tag ${r.status}`);
    r = await fetch(`${API}/tags`, { headers: AUTH });
    assert(!(await r.json()).some((t) => t.id === tagId), 'thẻ vẫn còn sau xoá');
    tagId = null;
    log('   OK thẻ đã xoá');

    log('\n✅ TAGS E2E THÀNH CÔNG');

    step('13. Dọn dẹp file');
    await fetch(`${API}/files/${fileId}/trash`, { method: 'PATCH', headers: AUTH });
    await fetch(`${API}/files/${fileId}`, { method: 'DELETE', headers: AUTH });
    fileId = null;
  } catch (e) {
    log('\n❌ LỖI:', e.message);
    process.exitCode = 1;
  } finally {
    if (userId) {
      const d = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` },
      });
      console.log('   xoá user test:', d.status);
    }
  }
}
main();
