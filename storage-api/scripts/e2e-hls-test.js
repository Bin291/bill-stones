/* eslint-disable */
// E2E HLS: tạo video test → upload → chờ transcode (hlsStatus=ready) → lấy
// master.m3u8 (JWT) → variant playlist (segment = presigned R2) → fetch 1 .ts.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  return { url: get('SUPABASE_URL').replace(/\/$/, ''), anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeTestMp4(out) {
  return new Promise((res, rej) => {
    const args = ['-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out];
    const p = spawn(ffmpegPath, args);
    let e = ''; p.stderr.on('data', d => e += d);
    p.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c + ': ' + e.slice(-300))));
  });
}

async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:3000';
  const email = `e2e+hls${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null, fileId = null, AUTH = null;
  const log = (...a) => console.log(...a);

  try {
    let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    userId = (await r.json()).id;
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    AUTH = { Authorization: `Bearer ${(await r.json()).access_token}` };

    const mp4 = path.join(os.tmpdir(), 'hls-e2e.mp4');
    log('▶ tạo video test (720p, 4s)…'); await makeTestMp4(mp4);
    const bytes = fs.readFileSync(mp4);
    log('  video:', bytes.length, 'bytes');

    r = await fetch(`${API}/uploads/init`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'hls-e2e.mp4', size: String(bytes.length), mimeType: 'video/mp4', folderId: null }) });
    const init = await r.json(); fileId = init.fileId;
    r = await fetch(`${API}/uploads/part`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' }, body: bytes });
    const etag = (await r.json()).ETag;
    r = await fetch(`${API}/uploads/complete`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }) });
    log('  upload complete:', (await r.json()).status);

    log('▶ chờ transcode HLS…');
    let hlsStatus = null;
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      r = await fetch(`${API}/videos/${fileId}/hls/status`, { headers: AUTH });
      hlsStatus = (await r.json()).hlsStatus;
      if (hlsStatus === 'ready' || hlsStatus === 'failed') break;
      if (i % 3 === 0) log('  ...', hlsStatus);
    }
    if (hlsStatus !== 'ready') throw new Error('hlsStatus = ' + hlsStatus);
    log('  hlsStatus = ready ✓');

    // master
    r = await fetch(`${API}/videos/${fileId}/hls/master.m3u8`, { headers: AUTH });
    const master = await r.text();
    log('▶ master.m3u8:', r.status, '| biến thể:', (master.match(/index\.m3u8/g) || []).length);
    const firstVariant = (master.match(/(\d{3,4}p)\/index\.m3u8/) || [])[1];
    log('  biến thể đầu:', firstVariant);

    // variant playlist
    r = await fetch(`${API}/videos/${fileId}/hls/${firstVariant}/index.m3u8`, { headers: AUTH });
    const variant = await r.text();
    const presignedSegs = (variant.match(/https:\/\/[^\s]+\.ts[^\s]*/g) || []);
    log('▶ variant', firstVariant, ':', r.status, '| segment presigned:', presignedSegs.length);

    // fetch 1 segment thẳng từ R2
    const seg = await fetch(presignedSegs[0]);
    const segBuf = Buffer.from(await seg.arrayBuffer());
    log('▶ fetch .ts từ R2:', seg.status, '| type:', seg.headers.get('content-type'), '| size:', segBuf.length, 'bytes');
    // kiểm Range (tua)
    const ranged = await fetch(presignedSegs[0], { headers: { Range: 'bytes=0-99' } });
    log('  Range request:', ranged.status, '(206 = hỗ trợ tua)');

    if (r.status === 200 && presignedSegs.length > 0 && seg.status === 200) log('\n✅ HLS STREAMING OK');
    else throw new Error('HLS không hợp lệ');

    await fetch(`${API}/files/${fileId}/trash`, { method: 'PATCH', headers: AUTH });
    await fetch(`${API}/files/${fileId}`, { method: 'DELETE', headers: AUTH });
    fileId = null;
  } catch (e) {
    log('\n❌ LỖI:', e.message);
    process.exitCode = 1;
  } finally {
    if (userId) await fetch(`${loadEnv().url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: loadEnv().service, Authorization: `Bearer ${loadEnv().service}` } });
    log('  dọn user test xong');
  }
}
main();
