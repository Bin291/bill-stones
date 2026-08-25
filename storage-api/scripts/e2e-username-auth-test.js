/* eslint-disable */
// E2E: đăng nhập bằng TÊN ĐĂNG NHẬP.
// admin tạo user (email_confirm) → POST /auth/register-profile (chiếm username) →
// POST /auth/username-login (đổi lấy token) → token gọi được route bảo vệ (/tags) →
// kiểm tra /auth/username-available phản ánh đúng → dọn sạch (xoá profile + user).
// KHÔNG in token/secret. Chạy: node scripts/e2e-username-auth-test.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => {
    const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].trim() : '';
  };
  return { url: get('SUPABASE_URL').replace(/\/$/, ''), anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}

async function main() {
  const { url, service } = loadEnv();
  const API = 'http://localhost:' + (process.env.PORT || '3000');
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const email = `e2e+uname${stamp}@example.com`;
  const username = `e2e_user_${stamp}`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null;
  const log = (...a) => console.log(...a);
  const step = (n) => log('\n▶ ' + n);
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

  try {
    step('1. Admin tạo user (email_confirm)');
    let r = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username, display_name: username } }),
    });
    if (!r.ok) throw new Error(`admin create ${r.status}: ${await r.text()}`);
    userId = (await r.json()).id;
    log('  userId ok');

    step('2. username-available TRƯỚC khi chiếm → true');
    r = await fetch(`${API}/auth/username-available?u=${encodeURIComponent(username)}`);
    assert(r.ok && (await r.json()).available === true, 'phải còn trống');

    step('3. register-profile (chiếm username, verify email khớp)');
    r = await fetch(`${API}/auth/register-profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, username, email }),
    });
    if (!r.ok) throw new Error(`register-profile ${r.status}: ${await r.text()}`);
    log('  claimed');

    step('4. username-available SAU khi chiếm → false');
    r = await fetch(`${API}/auth/username-available?u=${encodeURIComponent(username)}`);
    assert(r.ok && (await r.json()).available === false, 'phải bị chiếm');

    step('5. register-profile với email KHÔNG khớp → 400');
    r = await fetch(`${API}/auth/register-profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, username: username + '_x', email: 'wrong@example.com' }),
    });
    assert(r.status === 400, 'email sai phải 400, nhận ' + r.status);

    step('6. username-login SAI mật khẩu → 401');
    r = await fetch(`${API}/auth/username-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'wrong-pass-123' }),
    });
    assert(r.status === 401, 'sai mật khẩu phải 401, nhận ' + r.status);

    step('7. username-login ĐÚNG → có access_token');
    r = await fetch(`${API}/auth/username-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error(`username-login ${r.status}: ${await r.text()}`);
    const session = await r.json();
    assert(!!session.access_token && !!session.refresh_token, 'thiếu token');
    log('  got session tokens');

    step('8. Token gọi được route bảo vệ (GET /tags)');
    r = await fetch(`${API}/tags`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    assert(r.ok, 'GET /tags phải 200, nhận ' + r.status);
    assert(Array.isArray(await r.json()), '/tags trả mảng');
    log('  protected route ok');

    step('9. username-login với username không tồn tại → 401');
    r = await fetch(`${API}/auth/username-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'khong_ton_tai_' + stamp, password }),
    });
    assert(r.status === 401, 'username lạ phải 401, nhận ' + r.status);

    log('\n✅ TẤT CẢ BƯỚC PASS');
  } finally {
    step('Dọn sạch');
    try { await prisma.userProfile.deleteMany({ where: { userId } }); } catch {}
    await prisma.$disconnect();
    if (userId) {
      await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` },
      }).catch(() => {});
    }
    log('  done');
  }
}

main().catch((e) => { console.error('\n❌ FAIL:', e.message); process.exit(1); });
