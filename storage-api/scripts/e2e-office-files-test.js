/* eslint-disable */
// Test 2 gap vừa vá: (1) Excel (.xlsx) trước đây KHÔNG được index chút nào,
// (2) ảnh nhúng trong DOCX bị mammoth.extractRawText() bỏ qua hoàn toàn.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ASSETS = path.join(__dirname, 'qa-assets');

function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  return {
    url: get('SUPABASE_URL').replace(/\/$/, ''),
    anon: get('SUPABASE_ANON_KEY'),
    service: get('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:3000';
  const email = `e2e+office${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null;
  const fileIds = {};
  let AUTH = null;
  const log = (...a) => console.log(...a);
  const step = (n) => log('\n▶ ' + n);

  const FILES = [
    { name: 'report_with_embedded_image.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { name: 'bangdiem_tri_tue_nhan_tao.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ];

  try {
    step('1. Tạo user test + đăng nhập');
    let r = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    userId = (await r.json()).id;
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    AUTH = { Authorization: `Bearer ${(await r.json()).access_token}` };
    log('   user =', userId);

    step('2. Upload docx (có ảnh nhúng) + xlsx');
    for (const f of FILES) {
      const bytes = fs.readFileSync(path.join(ASSETS, f.name));
      let rr = await fetch(`${API}/uploads/init`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, size: String(bytes.length), mimeType: f.mime, folderId: null }),
      });
      const init = await rr.json();
      fileIds[f.name] = init.fileId;
      rr = await fetch(`${API}/uploads/part`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': init.fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' },
        body: bytes,
      });
      const etag = (await rr.json()).ETag;
      await fetch(`${API}/uploads/complete`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: init.fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }),
      });
      log('   uploaded', f.name, '->', init.fileId);
    }

    step('3. Chờ index (docx cần thêm 1 lượt Gemini vision cho ảnh nhúng)');
    const pending = new Set(Object.keys(fileIds));
    for (let i = 0; i < 30 && pending.size > 0; i++) {
      await sleep(8000);
      for (const name of [...pending]) {
        const n = await prisma.documentChunk.count({ where: { fileId: fileIds[name] } });
        if (n > 0) {
          pending.delete(name);
          log(`   ✅ đã index: ${name} (${n} chunk)`);
        }
      }
    }
    if (pending.size > 0) log(`   ⚠️ chưa index kịp: ${[...pending].join(', ')}`);

    const doSearch = async (q) => {
      const rr = await fetch(`${API}/search?q=${encodeURIComponent(q)}`, { headers: AUTH });
      return (await rr.json()).results || [];
    };

    step('4. Kiểm tra nội dung đã index (raw DB) để chắc chắn ảnh/sheet thực sự vào chunk');
    const docxChunks = await prisma.documentChunk.findMany({ where: { fileId: fileIds['report_with_embedded_image.docx'] }, select: { content: true } });
    log('   docx chunks:', docxChunks.length);
    for (const c of docxChunks) log('   ---\n  ', c.content.slice(0, 300));
    const xlsxChunks = await prisma.documentChunk.findMany({ where: { fileId: fileIds['bangdiem_tri_tue_nhan_tao.xlsx'] }, select: { content: true } });
    log('   xlsx chunks:', xlsxChunks.length);
    for (const c of xlsxChunks) log('   ---\n  ', c.content.slice(0, 300));

    step('5. Test search thật');
    const tests = [
      ['Nguyen Hoang Lam Phuc', 'bangdiem_tri_tue_nhan_tao.xlsx', 'FTS tên trong Excel'],
      ['Tri tue nhan tao', 'bangdiem_tri_tue_nhan_tao.xlsx', 'FTS tên môn học trong Excel'],
      ['biểu đồ cột', 'report_with_embedded_image.docx', 'nội dung ẢNH NHÚNG trong docx (ảnh là infographic biểu đồ cột)'],
      ['xu hướng ứng dụng AI', 'report_with_embedded_image.docx', 'nội dung ẢNH NHÚNG trong docx (caption ảnh)'],
    ];
    let pass = 0;
    for (const [q, expectedName, purpose] of tests) {
      const res = await doSearch(q);
      const idx = res.findIndex((x) => x.id === fileIds[expectedName]);
      const ok = idx !== -1;
      if (ok) pass++;
      log(
        `   ${ok ? '✅' : '❌'} "${q}" -> mong đợi ${expectedName} | ` +
          (ok ? `rank #${idx + 1}, ${Math.round(res[idx].similarity * 1000) / 10}%, matchedBy=[${res[idx].matchedBy.join(',')}]` : 'KHÔNG TÌM THẤY') +
          ` (${purpose})`,
      );
    }
    log(`\n   Tổng: ${pass}/${tests.length} pass`);
  } catch (e) {
    log('\n❌ LỖI:', e.message, e.stack);
    process.exitCode = 1;
  } finally {
    step('Dọn dẹp');
    for (const fid of Object.values(fileIds)) {
      await fetch(`http://localhost:3000/files/${fid}/trash`, { method: 'PATCH', headers: AUTH }).catch(() => {});
      await fetch(`http://localhost:3000/files/${fid}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
    }
    if (userId) {
      const d = await fetch(`${loadEnv().url}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { apikey: loadEnv().service, Authorization: `Bearer ${loadEnv().service}` },
      });
      log('   xoá user test:', d.status);
    }
    await prisma.$disconnect();
  }
}
main();
