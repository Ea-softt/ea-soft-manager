const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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
  console.log('Activation checks passed: missing plan fallback, observed login, scheduling failure/retry, reconnect preserves expiry, unknown duration.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
