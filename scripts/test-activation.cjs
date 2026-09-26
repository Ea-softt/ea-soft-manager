const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync('hotspot/server.js', 'utf8');
const now = Date.now();
let data = { plans: [], vouchers: [
  { id: 'paid', username: 'online', planId: 'daily', activatedAt: null, expiresAt: null, status: 'active' },
  { id: 'unknown', username: 'custom', planId: 'missing', activatedAt: null, expiresAt: null }
] };
let fails = true;
let calls = 0;
let sessions = [{ user: 'online', uptime: '2h' }, { user: 'custom', uptime: '1h' }];
const context = vm.createContext({
  crypto,
  console: { error() {} },
  defaultPlans: [{ id: 'daily', duration: 1, period: 'days' }],
  profileNameForPlan: () => 'DAILY',
  readManagerData: () => structuredClone(data),
  writeManagerData: (next) => { data = structuredClone(next); },
  readMikroTikHotspotActiveUsers: async () => sessions,
  scheduleCalendarExpiration: async () => { calls++; if (fails) throw Error('Router schedule failed'); },
  disableMikroTikUser: async () => {}
});
const run = (code) => vm.runInContext(code, context);
run(source.match(/function planDurationMs[\s\S]*?\n\}/)[0]);
run(source.slice(source.indexOf('function parseRouterOsDuration('), source.indexOf('function planDurationMs(')));
run(source.slice(source.indexOf('let calendarSyncRunning'), source.indexOf('function mergeMikroTikUsers(')));
(async () => {
  await run('syncCalendarActivations()');
  const paid = data.vouchers[0];
  assert.ok(Math.abs(paid.activatedAt - (now - 2 * 3600000)) < 5000);
  assert.equal(paid.expiresAt - paid.activatedAt, 86400000);
  assert.equal(paid.expirySchedulePending, true);
  assert.ok(data.vouchers[1].activatedAt > 0);
  assert.equal(data.vouchers[1].expiresAt, null);
  const firstLogin = paid.activatedAt;
  const firstExpiry = paid.expiresAt;
  fails = false;
  sessions = [{ user: 'online', uptime: '1m' }];
  await run('syncCalendarActivations()');
  assert.equal(data.vouchers[0].activatedAt, firstLogin);
  assert.equal(data.vouchers[0].expiresAt, firstExpiry);
  assert.equal(data.vouchers[0].expirySchedulePending, false);
  assert.equal(calls, 2);

  // The first state request must import router users before checking their sessions.
  let stateHandler;
  context.app = { get: (_path, _auth, handler) => { stateHandler = handler; } };
  context.requireAdminToken = () => {};
  context.readMikroTikHotspotUsers = async () => [{ name: 'new-online', profile: 'DAILY' }];
  run(source.slice(source.indexOf('function mergeMikroTikUsers('), source.indexOf('function chooseQuotaBytes(')));
  const routeStart = source.indexOf("\napp.get('/api/admin/state', requireAdminToken, async");
  run(source.slice(routeStart, source.indexOf("app.get('/api/public/plans'", routeStart)));
  sessions = [{ user: 'new-online', uptime: '30m' }];
  let response;
  await stateHandler({}, { json: (body) => { response = body; } });
  const imported = response.users.find((user) => user.username === 'new-online');
  assert.ok(imported.activatedAt > 0);
  assert.equal(imported.expiresAt - imported.activatedAt, 86400000);
  assert.equal(response.warning, '');

  // A state refresh arriving during a background sync waits, then checks new users.
  let release;
  context.readMikroTikHotspotActiveUsers = () => new Promise((resolve) => { release = resolve; });
  const background = run('syncCalendarActivations()');
  let refreshed = false;
  const refresh = run('syncCalendarActivations()').then(() => { refreshed = true; });
  await Promise.resolve();
  assert.equal(refreshed, false);
  context.readMikroTikHotspotActiveUsers = async () => [{ user: 'late-user', uptime: '1m' }];
  data.vouchers.push({ id: 'late', username: 'late-user', planId: 'daily' });
  release([]);
  await Promise.all([background, refresh]);
  assert.ok(data.vouchers.find((user) => user.id === 'late').expiresAt > 0);

  context.readMikroTikHotspotActiveUsers = async () => { throw Error('Router offline'); };
  await stateHandler({}, { json: (body) => { response = body; } });
  assert.match(response.warning, /Router sync is unavailable/);
  context.readMikroTikHotspotActiveUsers = async () => [];
  await run('syncCalendarActivations()');
  console.log('Activation checks passed: expiry preservation, scheduling retries, first-refresh imports, concurrent sync, and router failure warnings.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
