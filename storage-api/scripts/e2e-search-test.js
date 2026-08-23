/* eslint-disable */
// E2E FTS search: upload .txt tiếng Việt → chờ index → tìm không dấu theo nội
// dung + theo tên. Dọn sạch.
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
  const email = `e2e+search${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null, fileId = null, AUTH = null;
  const log = (...a) => console.log(...a);
  try {
    let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    userId = (await r.json()).id;
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    AUTH = { Authorization: `Bearer ${(await r.json()).access_token}` };

    const content = Buffer.from('Báo cáo trận đấu: Cầu thủ Garnacho ghi bàn tuyệt đẹp ở phút 90. Đội tuyển thắng 2-1.');
    const name = 'bao-cao-bong-da.txt';
    log('▶ upload', name);
    r = await fetch(`${API}/uploads/init`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, size: String(content.length), mimeType: 'text/plain', folderId: null }) });
    const init = await r.json(); fileId = init.fileId;
    r = await fetch(`${API}/uploads/part`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' }, body: content });
    const etag = (await r.json()).ETag;
    await fetch(`${API}/uploads/complete`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }) });

    const doSearch = async (q) => {
      const rr = await fetch(`${API}/search?q=${encodeURIComponent(q)}`, { headers: AUTH });
      return (await rr.json()).results || [];
    };

    log('▶ chờ index + tìm theo NỘI DUNG không dấu: "cau thu"');
    let byContent = [];
    for (let i = 0; i < 10; i++) { await sleep(1500); byContent = await doSearch('cau thu'); if (byContent.some(x => x.id === fileId)) break; }
    log('  kết quả:', byContent.length, '| có file test:', byContent.some(x => x.id === fileId), '| snippet:', (byContent.find(x=>x.id===fileId)||{}).snippet?.slice(0,50));

    log('▶ tìm theo TÊN không dấu: "bong da"');
    const byName = await doSearch('bong da');
    log('  kết quả:', byName.length, '| có file test:', byName.some(x => x.id === fileId));

    log('▶ tìm từ khoá "garnacho"');
    const byKw = await doSearch('garnacho');
    log('  có file test:', byKw.some(x => x.id === fileId));

    if (byContent.some(x=>x.id===fileId) && byName.some(x=>x.id===fileId)) log('\n✅ FTS SEARCH OK (nội dung + tên, không dấu)');
    else throw new Error('FTS không tìm thấy như mong đợi');

    await fetch(`${API}/files/${fileId}/trash`, { method: 'PATCH', headers: AUTH });
    await fetch(`${API}/files/${fileId}`, { method: 'DELETE', headers: AUTH });
    fileId = null;
  } catch (e) { log('\n❌ LỖI:', e.message); process.exitCode = 1; }
  finally { if (userId) await fetch(`${loadEnv().url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: loadEnv().service, Authorization: `Bearer ${loadEnv().service}` } }); log('  dọn user test xong'); }
}
main();
