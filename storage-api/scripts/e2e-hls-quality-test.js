/* eslint-disable */
// E2E: tạo user → tạo video 1080p thử bằng ffmpeg → upload → generate HLS →
// poll tới ready → GET master.m3u8 → xác minh liệt kê 144p/240p/360p/480p/1080p.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');

function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
  return { url: get('SUPABASE_URL').replace(/\/$/, ''), anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}

async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:' + (process.env.PORT || '3000');
  const email = `e2e+hlsq${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null, fileId = null;
  const log = (...a) => console.log(...a); const step = (n) => log('\n▶ ' + n);
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

  const tmp = path.join(os.tmpdir(), `hlsq-${Date.now()}.mp4`);
  try {
    step('1. Tạo video 1080p 3s bằng ffmpeg');
    const r0 = spawnSync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      '-c:a', 'aac', '-shortest', tmp,
    ]);
    if (r0.status !== 0) throw new Error('ffmpeg tạo video lỗi: ' + (r0.stderr || '').toString().slice(-300));
    const bytes = fs.readFileSync(tmp);
    log('   video size =', bytes.length, 'bytes');

    let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    userId = (await r.json()).id;
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const access = (await r.json()).access_token; const AUTH = { Authorization: `Bearer ${access}` }; const J = { ...AUTH, 'Content-Type': 'application/json' };

    step('2. Upload video (init/part/complete)');
    r = await fetch(`${API}/uploads/init`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'quality-test.mp4', size: String(bytes.length), mimeType: 'video/mp4', folderId: null }) });
    const init = await r.json(); fileId = init.fileId;
    r = await fetch(`${API}/uploads/part`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' }, body: bytes });
    const etag = (await r.json()).ETag;
    r = await fetch(`${API}/uploads/complete`, { method: 'POST', headers: J, body: JSON.stringify({ fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }) });
    assert(r.ok, 'complete lỗi'); log('   fileId =', fileId);

    step('3. Kích hoạt HLS + poll tới ready');
    await fetch(`${API}/videos/${fileId}/hls/generate`, { method: 'POST', headers: AUTH });
    let status = 'processing';
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      r = await fetch(`${API}/videos/${fileId}/hls/status`, { headers: AUTH });
      status = (await r.json()).hlsStatus;
      process.stdout.write(`   [${i}] status=${status}\r`);
      if (status === 'ready' || status === 'failed') break;
    }
    log('\n   status cuối =', status);
    assert(status === 'ready', 'transcode không ready (=' + status + ')');

    step('4. GET master.m3u8 — kiểm tra các mức chất lượng');
    r = await fetch(`${API}/videos/${fileId}/hls/master.m3u8`, { headers: AUTH });
    const master = await r.text();
    log(master.split('\n').filter((l) => l.includes('RESOLUTION') || l.endsWith('index.m3u8')).join('\n'));
    for (const q of ['144p', '240p', '360p', '480p', '1080p']) {
      assert(master.includes(`${q}/index.m3u8`), `master thiếu ${q}`);
      log('   ✓ có', q);
    }

    step('5. Lấy thử variant 144p (rewrite presigned .ts)');
    r = await fetch(`${API}/videos/${fileId}/hls/144p/index.m3u8`, { headers: AUTH });
    const v = await r.text();
    assert(v.includes('.ts') || v.includes('http'), '144p playlist rỗng');
    log('   144p playlist OK');

    log('\n✅ HLS QUALITY E2E THÀNH CÔNG (144p→1080p thật sự tạo được)');

    step('6. Dọn file');
    await fetch(`${API}/files/${fileId}/trash`, { method: 'PATCH', headers: AUTH });
    await fetch(`${API}/files/${fileId}`, { method: 'DELETE', headers: AUTH });
    fileId = null;
  } catch (e) { log('\n❌ LỖI:', e.message); process.exitCode = 1;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
    if (userId) { const d = await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } }); console.log('   xoá user test:', d.status); }
  }
}
main();
