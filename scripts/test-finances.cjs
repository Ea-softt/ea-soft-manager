const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-finances-'));
const file = path.join(directory, 'manager.json');
const source = fs.readFileSync('hotspot/server.js', 'utf8');
const context = vm.createContext({ fs, path, DATA_FILE: file, defaultPlans: [] });
vm.runInContext(source.slice(source.indexOf('function preserveSales('), source.indexOf('const { installAdminAuth }')), context);
const run = (code) => vm.runInContext(code, context);
try {
  const createdAt = new Date(2026, 8, 21, 12).getTime();
  fs.writeFileSync(file, JSON.stringify({ plans: [], vouchers: [
    { id: 'paid', amount: 25, createdAt, paymentReference: 'payment-1', password: 'private', status: 'active' },
    { id: 'manual', amount: 10, createdAt, status: 'active' }
  ] }));
  run('var data = readManagerData();');
  assert.equal(run('data.sales.length'), 2);
  assert.equal(run('data.sales.reduce((sum, sale) => sum + sale.amount, 0)'), 35);
  assert.doesNotMatch(JSON.stringify(JSON.parse(fs.readFileSync(file)).sales), /private|password/);

  // First login and expiry must neither move sale dates nor change income.
  run('data.vouchers[0].activatedAt = Date.now(); data.vouchers[0].expiresAt = Date.now(); data.vouchers[0].status = "expired"; writeManagerData(data);');
  assert.equal(run('data.sales[0].createdAt'), createdAt);
  run('data.vouchers = []; writeManagerData(data); data = readManagerData();');
  assert.equal(run('data.sales.length'), 2);
  assert.equal(run('data.sales.reduce((sum, sale) => sum + sale.amount, 0)'), 35);

  // Replayed payment references must not count a second sale after deletion.
  run('data.vouchers = [{ id: "replay", paymentReference: "payment-1", amount: 25, createdAt: Date.now() }]; writeManagerData(data);');
  assert.equal(run('data.sales.length'), 2);

  // Stale router snapshots must retain new sales and explicit amount corrections.
  run('var stale = readManagerData(); data.vouchers.push({ id: "new", amount: 0, createdAt: Date.now() }); writeManagerData(data); data.vouchers[1].amount = 5; writeManagerData(data, data.vouchers[1]); writeManagerData(stale);');
  assert.equal(run('readManagerData().sales.reduce((sum, sale) => sum + sale.amount, 0)'), 40);
  assert.equal(run('readManagerData().sales.length'), 3);

  const frontend = fs.readFileSync('src/main.js', 'utf8');
  context.state = { users: [], sales: JSON.parse(fs.readFileSync(file)).sales };
  vm.runInContext(frontend.slice(frontend.indexOf('function usersInRange('), frontend.indexOf('function financeBuckets(')), context);
  assert.equal(run(`rangeStats(${createdAt - 1}, ${createdAt + 1}).revenue`), 35);
  assert.equal(run(`rangeStats(${createdAt - 1}, ${createdAt + 1}).count`), 2);

  // A damaged datastore must not silently replace historical income with zero.
  fs.writeFileSync(file, '{broken');
  assert.throws(() => run('readManagerData()'));
  console.log('Finance checks passed: migration, activation, expiry, deletion, restart, payment deduplication, amount correction, stale writes, period totals.');
} finally {
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
}
