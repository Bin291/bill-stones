/* eslint-disable */
// E2E Hybrid Search (mục 8.E): upload 2 file có nội dung phân biệt bằng SỐ ÁO
// ("Áo số 7" vs "Áo số 49") -> chờ embed -> thử nhiều BIẾN THỂ từ khoá (có
// dấu, không dấu, leet-speak "s0 7") -> in ra % khớp + nhánh khớp (matchedBy)
// cho từng kết quả để kiểm thử trực quan độ chính xác. Dọn sạch.
const fs = require('fs');
const path = require('path');

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
  const email = `e2e+hybrid${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null;
  const fileIds = [];
  let AUTH = null;
  const log = (...a) => console.log(...a);
  const step = (n) => log('\n▶ ' + n);

  try {
    step('1. Admin tạo user test (email_confirm=true)');
    let r = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    userId = (await r.json()).id;
    log('   user id =', userId);

    step('2. Đăng nhập lấy access token');
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    AUTH = { Authorization: `Bearer ${(await r.json()).access_token}` };

    const docs = [
      {
        name: 'cau-thu-so-7.txt',
        content:
          'Trận đấu giao hữu: cầu thủ mang áo số 7 của đội chủ nhà ghi bàn thắng quyết định ở phút 89. ' +
          'Anh là đội trưởng, chơi ở vị trí tiền vệ cánh phải.',
      },
      {
        name: 'cau-thu-so-49.txt',
        content:
          'Buổi tập hôm nay, cầu thủ trẻ mang áo số 49 gây ấn tượng với tốc độ và kỹ thuật rê bóng ' +
          'trong khu vực cấm địa đối phương.',
      },
    ];

    step('3. Upload 2 file test (phân biệt bằng SỐ ÁO)');
    for (const d of docs) {
      const bytes = Buffer.from(d.content, 'utf-8');
      let rr = await fetch(`${API}/uploads/init`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: d.name, size: String(bytes.length), mimeType: 'text/plain', folderId: null }),
      });
      const init = await rr.json();
      fileIds.push(init.fileId);
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
      log('   uploaded', d.name, '->', init.fileId);
    }
    const fileId7 = fileIds[0];
    const fileId49 = fileIds[1];

    const doSearch = async (q) => {
      const rr = await fetch(`${API}/search?q=${encodeURIComponent(q)}`, { headers: AUTH });
      return (await rr.json()).results || [];
    };
    const printResults = (label, list) => {
      log(`   [${label}] ${list.length} kết quả:`);
      for (const it of list) {
        const pct = (it.similarity * 100).toFixed(1) + '%';
        log(`     - ${it.name} | ${pct} | matchedBy=[${it.matchedBy.join(',')}]`);
      }
    };

    step('4. Chờ pipeline AI embed xong (index nền — dense + BGE-M3)');
    let queries = {};
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      queries['áo số 7'] = await doSearch('áo số 7');
      if (queries['áo số 7'].some((x) => x.id === fileId7)) break;
    }

    step('5. Test các BIẾN THỂ từ khoá cho "áo số 7"');
    const variants = ['áo số 7', 'ao so 7', 's0 7', 'cầu thủ số 7', 'áo số 49', 's0 49'];
    const outcomes = {};
    for (const v of variants) {
      const res = await doSearch(v);
      outcomes[v] = res;
      printResults(v, res);
    }

    // --- Kiểm định ---
    const top1Is = (list, fid) => list.length > 0 && list[0].id === fid;

    const checks = [
      ['áo số 7 -> top1 là file số 7', top1Is(outcomes['áo số 7'], fileId7)],
      ['ao so 7 (không dấu) -> top1 là file số 7', top1Is(outcomes['ao so 7'], fileId7)],
      ['s0 7 (leet) -> top1 là file số 7', top1Is(outcomes['s0 7'], fileId7)],
      ['cầu thủ số 7 -> top1 là file số 7', top1Is(outcomes['cầu thủ số 7'], fileId7)],
      ['áo số 49 -> top1 là file số 49', top1Is(outcomes['áo số 49'], fileId49)],
      ['s0 49 (leet) -> top1 là file số 49', top1Is(outcomes['s0 49'], fileId49)],
    ];
    log('\n▶ 6. KẾT QUẢ KIỂM ĐỊNH');
    let allOk = true;
    for (const [label, ok] of checks) {
      log(`   ${ok ? '✅' : '❌'} ${label}`);
      if (!ok) allOk = false;
    }

    if (allOk) log('\n✅ HYBRID SEARCH E2E: TẤT CẢ BIẾN THỂ TỪ KHOÁ ĐỀU ĐÚNG');
    else throw new Error('Một số biến thể từ khoá KHÔNG khớp đúng file mong đợi');
  } catch (e) {
    log('\n❌ LỖI:', e.message);
    process.exitCode = 1;
  } finally {
    step('Dọn dẹp: xoá file test + user test');
    for (const fid of fileIds) {
      await fetch(`${API}/files/${fid}/trash`, { method: 'PATCH', headers: AUTH }).catch(() => {});
      await fetch(`${API}/files/${fid}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
    }
    if (userId) {
      const d = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { apikey: service, Authorization: `Bearer ${service}` },
      });
      log('   xoá user test:', d.status);
    }
  }
}
main();
