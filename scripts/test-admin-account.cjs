const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('../hotspot/node_modules/express');
const { installAdminAuth, hashPassword } = require('../hotspot/admin-auth');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-admin-test-'));
  const file = path.join(directory, 'account.json');
  const env = { ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD_HASH: hashPassword('OriginalPassword123!') };
  const app = express();
  app.use(express.json());
  let email;
  let time = Date.now();
  const guard = installAdminAuth(app, { env, file, now: () => time, sendMail: async (mail) => { email = mail; } });
  app.get('/api/admin/private', guard, (_, res) => res.json({ success: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  async function request(route, body, token, method = 'POST') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {})
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    assert.equal((await request('private', null, null, 'GET')).status, 401);
    assert.equal((await request('session', { email: env.ADMIN_EMAIL, password: 'wrong' })).status, 401);
    const login = await request('session', { email: env.ADMIN_EMAIL, password: 'OriginalPassword123!' });
    assert.equal(login.status, 200);
    const token = login.data.token;
    assert.equal((await request('private', null, token, 'GET')).status, 200);
    assert.equal((await request('account', { email: 'new@example.test', currentPassword: 'wrong' }, token, 'PUT')).status, 400);
    assert.equal((await request('account', { email: 'new@example.test', currentPassword: 'OriginalPassword123!', newPassword: 'ChangedPassword123!' }, token, 'PUT')).status, 200);
    assert.equal((await request('private', null, token, 'GET')).status, 401);
    assert.equal((await request('session', { email: env.ADMIN_EMAIL, password: 'OriginalPassword123!' })).status, 401);
    const changed = await request('session', { email: 'new@example.test', password: 'ChangedPassword123!' });
    assert.equal(changed.status, 200);
    await request('forgot-password', { email: 'unknown@example.test' });
    assert.equal(email, undefined);
    assert.equal((await request('forgot-password', { email: 'new@example.test' })).status, 200);
    assert.equal(email.to, 'new@example.test');
    const code = email.text.match(/code is: ([A-F0-9]+)/)[1];
    assert.equal((await request('reset-password', { email: 'new@example.test', code: 'wrong', password: 'ResetPassword123!' })).status, 400);
    assert.equal((await request('reset-password', { email: 'new@example.test', code, password: 'ResetPassword123!' })).status, 200);
    assert.equal((await request('reset-password', { email: 'new@example.test', code, password: 'ResetPassword123!' })).status, 400);
    assert.equal((await request('private', null, changed.data.token, 'GET')).status, 401);
    const resetLogin = await request('session', { email: 'new@example.test', password: 'ResetPassword123!' });
    assert.equal(resetLogin.status, 200);
    await request('session', {}, resetLogin.data.token, 'DELETE');
    assert.equal((await request('private', null, resetLogin.data.token, 'GET')).status, 401);
    await request('forgot-password', { email: 'new@example.test' });
    time += 16 * 60000;
    assert.equal((await request('reset-password', { email: 'new@example.test', code: email.text.match(/code is: ([A-F0-9]+)/)[1], password: 'ResetPassword123!' })).status, 400);
    const stored = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(stored, /OriginalPassword|ChangedPassword|ResetPassword/);
    assert.equal(JSON.parse(stored).email, 'new@example.test');
    for (let i = 0; i < 10; i++) await request('session', { email: 'new@example.test', password: 'wrong' });
    assert.equal((await request('session', { email: 'new@example.test', password: 'wrong' })).status, 429);
    console.log('Backend account checks passed: login, changes, reset email, one-time/expired codes, session revocation, hashes, rate limits.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
