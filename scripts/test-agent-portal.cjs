const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createTownApp } = require('../hotspot/server');
const { createMultiTownApp } = require('../hotspot/towns');
const { hashPassword, installAdminAuth } = require('../hotspot/admin-auth');

async function main(mode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-agents-'));
  const env = { ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD_HASH: hashPassword('OriginalPassword123!'),
    ADMIN_ACCOUNT_FILE: path.join(directory, 'account.json'), DATA_FILE: path.join(directory, 'manager.json'),
    TOWNS_FILE: path.join(directory, 'towns.json'), VOUCHER_AUTH_MODE: mode, RADIUS_REST_SECRET: 'test-secret-that-is-at-least-32-characters',
    MIKROTIK_USERNAME: 'test', MIKROTIK_PASSWORD: 'test' };
  const routerCalls = [];
  let factory = createTownApp;
  if (mode === 'local') {
    class Router {
      on() {}
      async connect() {}
      async close() {}
      async write(command, args) { routerCalls.push({ command, args }); return []; }
    }
    const sourceFile = path.resolve('hotspot/server.js');
    const realRequire = createRequire(sourceFile);
    const moduleObject = { exports: {} };
    vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), {
      require: (name) => name === 'routeros-client' ? { RouterOSAPI: Router } : realRequire(name),
      module: moduleObject, __dirname: path.dirname(sourceFile), process, Buffer, console, URL, fetch, setTimeout, setInterval, clearInterval
    });
    factory = moduleObject.exports.createTownApp;
  }
  fs.writeFileSync(env.TOWNS_FILE, JSON.stringify([{ id: 'default', name: 'Main' }, { id: 'second', name: 'Second', router: {
    MIKROTIK_HOST: '10.1.1.2', MIKROTIK_USERNAME: 'test', MIKROTIK_PASSWORD: 'test'
  } }]));
  let server;
  let recoveryMail;
  let smsFail = true;
  const messages = [];
  const smsServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      messages.push(JSON.parse(body));
      res.writeHead(smsFail ? 503 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(smsFail ? { message: 'Test SMS outage' } : { success: true }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => smsServer.once('listening', resolve));
  env.SMS_API_URL = `http://127.0.0.1:${smsServer.address().port}`;
  async function start() {
    server = createMultiTownApp({ env, authInstaller: (app, options) => installAdminAuth(app, { ...options, sendMail: async (mail) => { recoveryMail = mail; } }), createTownApp: (...args) => {
      const instance = factory(...args);
      instance.disconnectSharedVoucher = async () => {}; // no live router calls
      return instance;
    } }).app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
  }
  async function request(route, token, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  }
  const login = async (email, password = 'OriginalPassword123!') => (await request('/api/admin/session', null, { email, password })).data;
  try {
    await start();
    const owner = await login(env.ADMIN_EMAIL);
    assert.equal(owner.role, 'manager');
    assert.equal((await request('/api/admin/staff')).status, 401);
    for (const [name, role] of [['alice', 'agent'], ['bob', 'agent'], ['manager', 'manager']]) {
      const registered = await request('/api/admin/staff', owner.token, { name, email: `${name}@example.test`, password: 'OriginalPassword123!', role });
      assert.equal(registered.status, 201);
      assert.equal(registered.data.user.passwordHash, undefined);
    }
    assert.equal((await request('/api/admin/staff', owner.token, { name: 'duplicate', email: env.ADMIN_EMAIL, password: 'OriginalPassword123!', role: 'agent' })).status, 409);
    const alice = await login('alice@example.test');
    const bob = await login('bob@example.test');
    const manager = await login('manager@example.test');
    assert.equal(alice.role, 'agent');
    assert.equal((await request('/api/admin/staff', manager.token)).status, 200);
    for (const [route, method, body] of [
      ['/api/admin/staff', 'GET'], ['/api/admin/staff', 'POST', {}], ['/api/admin/towns/settings', 'GET'],
      ['/api/admin/towns/overview', 'GET'], ['/api/towns/default/admin/state', 'GET'],
      ['/api/towns/second/admin/agents', 'GET'], ['/api/admin/terminal', 'POST', {}],
      ['/api/admin/plans', 'PUT', { plans: [] }], ['/api/admin/vouchers', 'POST', {}],
      ['/api/admin/vouchers/fake', 'DELETE'], ['/api/admin/agent-payments', 'POST', {}]
    ]) assert.equal((await request(route, alice.token, body, method)).status, 403, route);
    assert.equal((await request('/api/agent/towns', alice.token)).data.towns.length, 2);
    const payload = { planId: 'daily', phone: '0241234567', requestId: crypto.randomUUID(), username: 'hacked', password: 'hacked', amount: 0, agentId: bob.id };
    const [first, retry] = await Promise.all([request('/api/agent/vouchers', alice.token, payload), request('/api/agent/vouchers', alice.token, payload)]);
    assert.equal(first.status, 201);
    const voucher = first.data.user;
    assert.equal(voucher.id, retry.data.user.id);
    assert.match(voucher.username, /^\d{3}$/);
    assert.match(voucher.password, /^\d{3}$/);
    assert.equal(voucher.amount, 5);
    assert.equal(voucher.agentId, alice.id);
    assert.equal(voucher.smsStatus, 'failed'); // provider failure; sale still succeeds
    assert.equal(messages.length, 1);
    assert.equal(voucher.expiresAt, null);
    if (mode === 'local') {
      const provisioned = routerCalls.filter((call) => call.command === '/ip/hotspot/user/add');
      assert.equal(provisioned.length, 1);
      assert.ok(provisioned[0].args.includes(`=name=${voucher.username}`));
      assert.ok(provisioned[0].args.includes(`=password=${voucher.password}`));
      assert.ok(provisioned[0].args.includes(`=limit-bytes-total=${11 * 1024 ** 3}`));
    }
    const state = (await request('/api/agent/state', alice.token)).data;
    assert.equal(state.sales.length, 1);
    assert.equal(state.amountDue, 5);
    assert.equal((await request('/api/agent/state', bob.token)).data.sales.length, 0);
    assert.equal((await request('/api/towns/second/agent/state', alice.token)).data.amountDue, 0);
    assert.equal((await request('/api/agent/vouchers', alice.token, { ...payload, phone: 'bad' })).status, 400);
    assert.equal((await request('/api/agent/vouchers', alice.token, { ...payload, requestId: crypto.randomUUID(), planId: 'missing' })).status, 400);
    const payment = { agentId: alice.id, amount: 2, requestId: crypto.randomUUID() };
    assert.equal((await request('/api/admin/agent-payments', owner.token, { ...payment, amount: 6 })).status, 400);
    assert.equal((await request('/api/admin/agent-payments', owner.token, payment)).status, 201);
    assert.equal((await request('/api/admin/agent-payments', owner.token, payment)).status, 200);
    assert.equal((await request('/api/agent/state', alice.token)).data.amountDue, 3);
    assert.equal((await request(`/api/admin/vouchers/${voucher.id}`, owner.token, undefined, 'DELETE')).status, 200);
    const afterDelete = (await request('/api/agent/state', alice.token)).data;
    assert.equal(afterDelete.users.length, 0);
    assert.equal(afterDelete.sales.length, 1);
    assert.equal(afterDelete.amountDue, 3);
    assert.equal((await request('/api/agent/vouchers', alice.token, payload)).status, 400);
    smsFail = false;
    const customPlan = { id: 'custom', name: 'Customer custom', price: 12.50, duration: 2, period: 'days', dataLimit: 8 };
    assert.equal((await request('/api/towns/second/admin/plans', owner.token, { plans: [customPlan] }, 'PUT')).status, 200);
    const custom = await request('/api/towns/second/agent/vouchers', alice.token, { ...payload, requestId: crypto.randomUUID(), planId: 'custom' });
    assert.equal(custom.status, 201);
    assert.equal(custom.data.user.amount, 12.5);
    assert.equal(custom.data.user.smsStatus, 'submitted');
    assert.match(messages.at(-1).message, new RegExp(custom.data.user.username));
    assert.equal(messages.at(-1).to, '+233241234567');
    assert.equal((await request('/api/agent/state', alice.token)).data.amountDue, 3);
    const secondVoucherPath = `/api/towns/second/admin/vouchers/${custom.data.user.id}`;
    assert.equal((await request(secondVoucherPath, owner.token, { amount: 7.5, phone: payload.phone }, 'PUT')).status, 200);
    const receipt = { agentId: alice.id, amount: 3, requestId: crypto.randomUUID() };
    assert.equal((await request('/api/towns/second/admin/agent-payments', owner.token, receipt)).status, 201);
    let balance = (await request('/api/towns/second/agent/state', alice.token)).data;
    assert.equal(balance.totalSales, 7.5);
    assert.equal(balance.totalReceived, 3);
    assert.equal(balance.amountDue, 4.5);
    assert.equal(balance.creditBalance, 0);
    assert.equal((await request('/api/towns/second/admin/agent-payments', owner.token, { ...receipt, amount: 4 })).status, 409);
    assert.equal((await request('/api/towns/second/admin/agent-payments', owner.token, { ...receipt, requestId: crypto.randomUUID(), amount: 0.001 })).status, 400);
    const reversalPath = `/api/towns/second/admin/agent-payments/${receipt.requestId}/void`;
    assert.equal((await request(reversalPath, alice.token, { reason: 'Mistake' })).status, 403);
    assert.equal((await request(reversalPath, owner.token, { reason: '' })).status, 400);
    assert.equal((await request(`/api/admin/agent-payments/${receipt.requestId}/void`, owner.token, { reason: 'Wrong town' })).status, 404);
    const reversed = await request(reversalPath, owner.token, { reason: 'Money was not actually received' });
    assert.equal(reversed.status, 200);
    assert.equal(reversed.data.payment.voidedBy, owner.id);
    assert.equal((await request(reversalPath, owner.token, { reason: 'Retry' })).data.payment.voidedAt, reversed.data.payment.voidedAt);
    balance = (await request('/api/towns/second/agent/state', alice.token)).data;
    assert.equal(balance.totalSales, 7.5);
    assert.equal(balance.totalReceived, 0);
    assert.equal(balance.amountDue, 7.5);
    assert.equal(balance.payments.length, 1); // correction keeps the original record
    const fullReceipt = { agentId: alice.id, amount: 7.5, requestId: crypto.randomUUID() };
    assert.equal((await request('/api/towns/second/admin/agent-payments', owner.token, fullReceipt)).status, 201);
    assert.equal((await request('/api/towns/second/agent/state', alice.token)).data.amountDue, 0);
    assert.equal((await request(secondVoucherPath, owner.token, { amount: 5, phone: payload.phone }, 'PUT')).status, 200);
    balance = (await request('/api/towns/second/agent/state', alice.token)).data;
    assert.equal(balance.amountDue, 0);
    assert.equal(balance.creditBalance, 2.5);
    await new Promise((resolve) => server.close(resolve));
    await start();
    const resumed = await login('alice@example.test');
    const persisted = (await request('/api/agent/state', resumed.token)).data;
    assert.equal(persisted.amountDue, 3);
    assert.equal(persisted.payments.length, 1);
    const secondPersisted = (await request('/api/towns/second/agent/state', resumed.token)).data;
    assert.equal(secondPersisted.creditBalance, 2.5);
    assert.equal(secondPersisted.totalReceived, 7.5);
    assert.equal(secondPersisted.payments[0].voidReason, 'Money was not actually received');
    assert.doesNotMatch(fs.readFileSync(env.ADMIN_ACCOUNT_FILE + '.staff.json', 'utf8'), /OriginalPassword123/);
    assert.equal((await request('/api/admin/session', resumed.token, undefined, 'DELETE')).status, 200);
    assert.equal((await request('/api/agent/state', resumed.token)).status, 401);
    assert.equal((await request('/api/admin/forgot-password', null, { email: 'alice@example.test' })).status, 200);
    assert.equal(recoveryMail.to, 'alice@example.test');
    const code = recoveryMail.text.match(/code is: ([A-F0-9]+)/)[1];
    assert.equal((await request('/api/admin/reset-password', null, { email: 'alice@example.test', code, password: 'NewAgentPassword123!' })).status, 200);
    assert.equal((await login('alice@example.test', 'NewAgentPassword123!')).role, 'agent');
    const currentManager = await login('manager@example.test');
    const currentBob = await login('bob@example.test');
    const rolePath = `/api/admin/staff/${bob.id}/role`;
    assert.equal((await request(rolePath, currentBob.token, { role: 'manager' }, 'PUT')).status, 403);
    assert.equal((await request(`/api/admin/staff/${alice.id}`, currentBob.token, undefined, 'DELETE')).status, 403);
    assert.equal((await request(rolePath, currentManager.token, { role: 'owner' }, 'PUT')).status, 400);
    assert.equal((await request('/api/admin/staff/owner/role', currentManager.token, { role: 'agent' }, 'PUT')).status, 400);
    assert.equal((await request(`/api/admin/staff/${currentManager.id}/role`, currentManager.token, { role: 'agent' }, 'PUT')).status, 400);
    assert.equal((await request(`/api/admin/staff/${currentManager.id}`, currentManager.token, undefined, 'DELETE')).status, 400);
    assert.equal((await request('/api/admin/staff/owner', currentManager.token, undefined, 'DELETE')).status, 400);
    assert.equal((await request(rolePath, currentManager.token, { role: 'manager' }, 'PUT')).data.user.role, 'manager');
    assert.equal((await request('/api/agent/state', currentBob.token)).status, 401);
    const promoted = await login('bob@example.test');
    assert.equal(promoted.role, 'manager');
    assert.equal((await request('/api/admin/staff', promoted.token)).status, 200);
    assert.equal((await request(rolePath, currentManager.token, { role: 'agent' }, 'PUT')).status, 200);
    assert.equal((await request('/api/admin/staff', promoted.token)).status, 401);
    const demoted = await login('bob@example.test');
    assert.equal(demoted.role, 'agent');
    assert.equal((await request('/api/admin/staff', demoted.token)).status, 403);
    const deletedLogin = await login('alice@example.test', 'NewAgentPassword123!');
    const historyBefore = fs.readFileSync(env.DATA_FILE, 'utf8');
    assert.equal((await request(`/api/admin/staff/${alice.id}`, currentManager.token, undefined, 'DELETE')).status, 200);
    assert.equal((await request('/api/agent/state', deletedLogin.token)).status, 401);
    assert.equal(fs.readFileSync(env.DATA_FILE, 'utf8'), historyBefore);
    assert.equal((await request('/api/admin/staff', currentManager.token)).data.staff.some((user) => user.id === alice.id), false);
    assert.equal((await request('/api/admin/agents', currentManager.token)).data.sales[0].agentId, alice.id);
    await new Promise((resolve) => server.close(resolve));
    await start();
    assert.equal((await login('bob@example.test')).role, 'agent');
    assert.equal((await request('/api/admin/session', null, { email: 'alice@example.test', password: 'NewAgentPassword123!' })).status, 401);
    console.log(`Agent portal integration (${mode}) passed: roles, isolation, automatic pricing, SMS, retries, payments, deletion, restart, recovery.`);
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => smsServer.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main('radius').then(() => main('local')).catch((error) => { console.error(error); process.exitCode = 1; });
