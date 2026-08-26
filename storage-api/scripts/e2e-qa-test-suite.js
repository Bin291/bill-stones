/* eslint-disable */
// QA Test Suite cho AI Hybrid Search (mục 8.E) — chuyển thể từ test-plan.md.
// Tạo user test riêng -> upload 9 file (5 ảnh synthetic qua sharp/SVG, 4 văn
// bản) -> chờ index (ảnh cần Gemini vision, có giãn cách quota nên có thể
// chậm) -> chạy toàn bộ ma trận từ khoá -> in bảng pass/fail + similarity/
// matchedBy -> dọn dẹp.
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

const FILES = [
  { name: 'meme_banana.png', mime: 'image/png' },
  { name: 'screenshot_code.png', mime: 'image/png' },
  { name: 'receipt_invoice.png', mime: 'image/png' },
  { name: 'red_car_banner.png', mime: 'image/png' },
  { name: 'infographic_ai.png', mime: 'image/png' },
  { name: 'baocao_taichinh_2025.txt', mime: 'text/plain' },
  { name: 'system_architecture.md', mime: 'text/markdown' },
  { name: 'danhsach_sinhvien.csv', mime: 'text/csv' },
  { name: 'env_config.txt', mime: 'text/plain' },
];

// [group, query, expectedFileName, purpose]
const MATRIX = [
  ['Visual', 'chuối', 'meme_banana.png', 'nhận diện đối tượng'],
  ['Visual', 'quả chuối màu vàng', 'meme_banana.png', 'đối tượng + màu'],
  ['Visual', 'xe hơi đỏ ban đêm', 'red_car_banner.png', 'đối tượng + màu + bối cảnh'],
  ['OCR', 'useDebouncedValue', 'screenshot_code.png', 'đọc chữ trong ảnh (code)'],
  ['OCR', 'tổng tiền', 'receipt_invoice.png', 'trích số/chữ nhỏ trong hoá đơn'],
  ['OCR', 'mã hoá đơn', 'receipt_invoice.png', 'trích nhãn trong hoá đơn'],
  ['Semantic', 'phẫn nộ hét lớn', 'meme_banana.png', 'cảm xúc/biểu cảm'],
  ['Semantic', 'meme hài hước', 'meme_banana.png', 'thể loại ảnh'],
  ['Semantic', 'kiến trúc hệ thống cơ sở dữ liệu', 'system_architecture.md', 'chủ đề tài liệu'],
  ['Semantic', 'lợi nhuận gộp', 'baocao_taichinh_2025.txt', 'thuật ngữ tài chính'],
  ['Cross-lang', 'banana', 'meme_banana.png', 'EN query -> nội dung VI'],
  ['Cross-lang', 'red car night', 'red_car_banner.png', 'EN query -> nội dung VI'],
  ['Cross-lang', 'Saga Pattern', 'system_architecture.md', 'thuật ngữ kỹ thuật chính xác'],
  ['Cross-lang', 'Supabase Redis', 'system_architecture.md', 'thuật ngữ kỹ thuật chính xác'],
  ['Structured', 'Nguyen Hoang Lam Phuc', 'danhsach_sinhvien.csv', 'FTS trên CSV'],
  ['Structured', 'FEATURE_FLAG_NEW_SEARCH', 'env_config.txt', 'FTS trên key=value'],
];

const EDGE_CASES = [
  ['xe hoi do ban dem', 'red_car_banner.png', 'không dấu'],
  ['xe ô tô đỏ', 'red_car_banner.png', 'từ đồng nghĩa (ô tô/xe hơi)'],
  ['màu vàng', null, 'nhiễu — query chung chung, không assert file cụ thể'],
];

async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:3000';
  const email = `e2e+qa${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null;
  const fileIds = {}; // name -> id
  let AUTH = null;
  const log = (...a) => console.log(...a);
  const step = (n) => log('\n▶ ' + n);

  const results = []; // { group, query, expected, pass, top, purpose }

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

    step('2. Upload 9 file test');
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

    const doSearch = async (q) => {
      const rr = await fetch(`${API}/search?q=${encodeURIComponent(q)}`, { headers: AUTH });
      return (await rr.json()).results || [];
    };

    step('3. Chờ index TỪNG file (kiểm tra trực tiếp DocumentChunk trong DB — không đoán qua search, vì search còn phụ thuộc ngưỡng lọc)');
    const pending = new Set(Object.keys(fileIds));
    for (let i = 0; i < 60 && pending.size > 0; i++) {
      await sleep(8000);
      for (const name of [...pending]) {
        const n = await prisma.documentChunk.count({ where: { fileId: fileIds[name] } });
        if (n > 0) {
          pending.delete(name);
          log(`   ✅ đã index: ${name} (${n} chunk)`);
        }
      }
      if (pending.size > 0) process.stdout.write(`   [${i}] còn chờ: ${[...pending].join(', ')}\r`);
    }
    if (pending.size > 0) {
      log(`\n   ⚠️ hết thời gian chờ — vẫn còn CHƯA index: ${[...pending].join(', ')} (test case liên quan sẽ fail do chưa có nội dung, không phải do search sai)`);
    } else {
      log('   ✅ toàn bộ 9 file đã có chunk trong DB');
    }

    step('4. Chạy ma trận từ khoá chính');
    for (const [group, query, expectedName, purpose] of MATRIX) {
      const res = await doSearch(query);
      const expectedId = expectedName ? fileIds[expectedName] : null;
      const idx = res.findIndex((x) => x.id === expectedId);
      const pass = idx !== -1 && idx < 3; // top-3
      const hit = idx !== -1 ? res[idx] : null;
      results.push({
        group, query, expected: expectedName, pass,
        rank: idx === -1 ? null : idx + 1,
        sim: hit ? Math.round(hit.similarity * 1000) / 10 : null,
        matchedBy: hit ? hit.matchedBy.join(',') : null,
        purpose,
      });
    }

    step('5. Edge cases (độ bền)');
    const edgeResults = [];
    for (const [query, expectedName, note] of EDGE_CASES) {
      const res = await doSearch(query);
      const expectedId = expectedName ? fileIds[expectedName] : null;
      const idx = expectedId ? res.findIndex((x) => x.id === expectedId) : -1;
      edgeResults.push({
        query, note,
        found: expectedId ? idx !== -1 : null,
        rank: idx === -1 ? null : idx + 1,
        topNames: res.slice(0, 5).map((x) => x.name),
      });
    }

    step('6. KẾT QUẢ — Ma trận chính');
    let passCount = 0;
    for (const r of results) {
      const mark = r.pass ? '✅' : '❌';
      if (r.pass) passCount++;
      log(
        `   ${mark} [${r.group}] "${r.query}" -> mong đợi: ${r.expected} | ` +
          (r.rank ? `rank #${r.rank}, ${r.sim}%, matchedBy=[${r.matchedBy}]` : 'KHÔNG TÌM THẤY') +
          ` (${r.purpose})`,
      );
    }
    log(`\n   Tổng: ${passCount}/${results.length} pass`);

    log('\n▶ 7. Edge cases');
    for (const e of edgeResults) {
      if (e.found === null) {
        log(`   ℹ️ "${e.query}" (${e.note}) -> top kết quả: ${e.topNames.join(', ') || '(rỗng)'}`);
      } else {
        log(`   ${e.found ? '✅' : '❌'} "${e.query}" (${e.note}) -> ${e.found ? `rank #${e.rank}` : 'không tìm thấy'}`);
      }
    }

    if (passCount < results.length) {
      log(`\n⚠️ ${results.length - passCount} test case KHÔNG đạt top-3 — xem chi tiết ở trên.`);
    } else {
      log('\n✅ TẤT CẢ TEST CASE CHÍNH ĐỀU PASS (top-3)');
    }
  } catch (e) {
    log('\n❌ LỖI:', e.message, e.stack);
    process.exitCode = 1;
  } finally {
    step('Dọn dẹp: xoá file test + user test');
    for (const fid of Object.values(fileIds)) {
      await fetch(`${API_URL()}/files/${fid}/trash`, { method: 'PATCH', headers: AUTH }).catch(() => {});
      await fetch(`${API_URL()}/files/${fid}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
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

function API_URL() {
  return 'http://localhost:3000';
}

main();
