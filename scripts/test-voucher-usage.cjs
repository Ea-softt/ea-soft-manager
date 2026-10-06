const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const backend = fs.readFileSync('hotspot/server.js', 'utf8');
const frontend = fs.readFileSync('src/main.js', 'utf8');
async function main() {
  let fields;
  class Router {
    async connect() {}
    async close() {}
    async write(command, args) {
      assert.equal(command, '/ip/hotspot/user/print');
      fields = args[0].replace('=.proplist=', '').split(',');
      assert.ok(fields.includes('bytes-in') && fields.includes('bytes-out'));
      assert.ok(fields.includes('password') && fields.includes('profile'));
      return [{ name: '199', 'bytes-in': '1024', 'bytes-out': '2048' },
        { name: 'unused', 'bytes-in': '0', 'bytes-out': '0' }, { name: 'missing' }];
    }
  }
  const data = { plans: [], vouchers: [
    { id: '1', username: '199' }, { id: '2', username: 'unused' },
    { id: '3', username: 'missing', dataConsumedBytes: 4096, dataUsageUpdatedAt: 100 }
  ] };
  const context = vm.createContext({ RouterOSAPI: Router, getMikroTikApiOptions: () => ({}), crypto,
    profileNameForPlan: () => '', writeManagerData() {}, data, escapeText: value => String(value) });
  vm.runInContext(backend.slice(backend.indexOf('async function readMikroTikHotspotUsers('), backend.indexOf('function parseRouterOsDuration(')), context);
  vm.runInContext(backend.slice(backend.indexOf('function parseRouterOsDuration('), backend.indexOf('function planDurationMs(')), context);
  vm.runInContext(backend.slice(backend.indexOf('function mergeMikroTikUsers('), backend.indexOf('function chooseQuotaBytes(')), context);
  await vm.runInContext('readMikroTikHotspotUsers().then(users => mergeMikroTikUsers(data, users))', context);
  assert.equal(data.vouchers[0].dataConsumedBytes, 3072);
  assert.equal(data.vouchers[0].hasLoggedIn, true);
  assert.ok(data.vouchers[0].dataUsageUpdatedAt > 0);
  assert.equal(data.vouchers[1].dataConsumedBytes, 0);
  assert.equal(data.vouchers[2].dataConsumedBytes, 4096);
  assert.equal(data.vouchers[2].dataUsageUpdatedAt, 100);
  assert.equal(vm.runInContext("parseRouterOsDuration('00:47:30')", context), 2850);
  assert.equal(vm.runInContext("parseRouterOsDuration('1d02:03:04')", context), 93784);
  assert.equal(vm.runInContext("parseRouterOsDuration('2h3m4s')", context), 7384);
  vm.runInContext("mergeMikroTikUsers(data, [{name:'unused', uptime:'00:01:00'}])", context);
  assert.equal(data.vouchers[1].hasLoggedIn, true, 'Nonzero uptime proves login even with zero or missing byte counters');
  assert.equal(data.vouchers[1].activatedAt, undefined, 'Accumulated uptime cannot determine the first-login timestamp');
  vm.runInContext(frontend.slice(frontend.indexOf('function voucherDisplayStatus('), frontend.indexOf('function overviewRevenueByStatus(')), context);
  assert.equal(vm.runInContext('voucherDisplayStatus({dataConsumedBytes: "1024"})', context), 'used');
  assert.equal(vm.runInContext('voucherDisplayStatus({hasLoggedIn:true,dataConsumedBytes:0})', context), 'used');
  assert.equal(vm.runInContext('voucherDisplayStatus({dataConsumedBytes:0})', context), 'awaiting');
  assert.equal(vm.runInContext('voucherDisplayStatus({activatedAt:1,expiresAt:Date.now()+60000})', context), 'active');
  assert.equal(vm.runInContext('voucherDisplayStatus({hasLoggedIn:true,status:"expired"})', context), 'expired');
  assert.equal(vm.runInContext('voucherDisplayStatus({hasLoggedIn:true,suspended:true})', context), 'suspended');
  vm.runInContext(frontend.slice(frontend.indexOf('function formatDataUsage('), frontend.indexOf('function getPlan(')), context);
  assert.match(vm.runInContext('dataUsageCell(data.vouchers[0])', context), /3 KB/);
  assert.match(vm.runInContext('dataUsageCell(data.vouchers[1])', context), /0 B/);
  assert.match(vm.runInContext('dataUsageCell({ dataConsumedBytes: "1048576", dataUsageUpdatedAt: 100 })', context), /1 MB/);
  for (const value of [undefined, null, '', 'not-a-number', -1, Number.MAX_SAFE_INTEGER + 1]) {
    context.value = value;
    assert.match(vm.runInContext('dataUsageCell({dataConsumedBytes:value})', context), /Awaiting usage reading/);
    assert.doesNotMatch(vm.runInContext('dataUsageCell({dataConsumedBytes:value})', context), />0 B/);
  }
  console.log('Voucher usage checks passed: explicit router counters, upload/download totals, zero usage, preserved readings, numeric strings, and honest missing-data display.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
