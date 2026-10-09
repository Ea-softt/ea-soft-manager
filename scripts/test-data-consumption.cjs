const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-usage-'));
const file = path.join(directory, 'manager.json');
const source = fs.readFileSync('hotspot/server.js', 'utf8');
const context = vm.createContext({ fs, path, DATA_FILE: file, defaultPlans: [] });
const run = (code) => vm.runInContext(code, context);
run(source.slice(source.indexOf('function preserveSales('), source.indexOf('const { installAdminAuth }')));
try {
  fs.writeFileSync(file, JSON.stringify({ plans: [], vouchers: [{ id: 'router', dataConsumedBytes: 9000, dataUsageUpdatedAt: 1 }] }));
  run('var data = readManagerData(); var start = data.dataUsage.startedAt;');
  assert.equal(run('readManagerData().dataUsage.startedAt'), run('start'));
  // Existing lifetime counters must never become today's usage.
  run('data.vouchers[0].dataConsumedBytes = 10000; data.vouchers[0].dataUsageUpdatedAt = start + 1; writeManagerData(data);');
  assert.equal(run('readManagerData().dataUsage.days.length'), 0);
  run('data.vouchers[0].dataConsumedBytes = 10500; data.vouchers[0].dataUsageUpdatedAt = start + 2; writeManagerData(data);');
  assert.equal(run('readManagerData().dataUsage.days[0].bytes'), 500);
  // Duplicate and stale writes cannot double count or roll counters back.
  run('writeManagerData(data); var stale = readManagerData(); data.vouchers[0].dataConsumedBytes = 10700; data.vouchers[0].dataUsageUpdatedAt = start + 3; writeManagerData(data); writeManagerData(stale);');
  assert.equal(run('readManagerData().dataUsage.days[0].bytes'), 700);
  assert.equal(run('readManagerData().vouchers[0].dataConsumedBytes'), 10700);
  // A router snapshot taken before a manager edit cannot remove saved device details.
  run('var deviceEdit = readManagerData(); deviceEdit.vouchers[0].connectionDevices = [{macAddress:"AABBCCDDEE01",deviceType:"Android phone",deviceModel:"Galaxy A15",accessPoint:"Market AP"}]; saveManagerData(deviceEdit); writeManagerData(stale);');
  assert.equal(run('readManagerData().vouchers[0].connectionDevices[0].deviceType'), 'Android phone');
  // A reset counts only newly observed bytes, preserving historical totals.
  run('data = readManagerData(); data.vouchers[0].dataConsumedBytes = 50; data.vouchers[0].dataUsageUpdatedAt = start + 4; writeManagerData(data);');
  assert.equal(run('readManagerData().dataUsage.days[0].bytes'), 750);
  run('data.vouchers = []; writeManagerData(data, null, ["router"]);');
  assert.equal(run('readManagerData().dataUsage.days[0].bytes'), 750);
  // Exercise the production RADIUS update path, including repeat counters.
  run('data = readManagerData(); data.vouchers.push({ id: "radius", dataConsumedBytes: 100 }); saveManagerData(data);');
  const method = source.slice(source.indexOf('        updateSharedVoucher(id, changes) {'), source.indexOf('        async disconnectSharedVoucher('));
  run(`var instance = { ${method} }; instance.updateSharedVoucher('radius', { dataConsumedBytes: 300, dataUsageUpdatedAt: start + 5 }); instance.updateSharedVoucher('radius', { dataConsumedBytes: 300, dataUsageUpdatedAt: start + 6 });`);
  assert.equal(run('readManagerData().dataUsage.days[0].bytes'), 950);

  const frontend = fs.readFileSync('src/main.js', 'utf8');
  run(frontend.slice(frontend.indexOf('function usagePeriodStart('), frontend.indexOf('function renderDataConsumption(')));
  run('var dataUsage = { days: [{ date: "2025-12-31", bytes: 50 }, { date: "2026-01-01", bytes: 100 }, { date: "2026-01-05", bytes: 200 }] };');
  assert.equal(run('usageTotal(usagePeriodStart("yearly", "2026-06-01"), new Date("2027-01-01"))'), 300);
  assert.equal(run('usageTotal(usagePeriodStart("weekly", "2026-01-04"), new Date("2026-01-05"))'), 150);
  assert.equal(run('usagePeriodStart("weekly", "2026-01-04").toISOString()'), '2025-12-29T00:00:00.000Z');
  assert.equal(run('moveUsagePeriod(usagePeriodStart("monthly", "2024-02-29"), "monthly", 1).toISOString()'), '2024-03-01T00:00:00.000Z');
  assert.equal(run('usageTotal(new Date("2026-01-01"), new Date("2026-01-02"))'), 100);
  run('dataUsage.days[1].reportDeletedBytes = 100;');
  assert.equal(run('usageTotal(new Date("2026-01-01"), new Date("2026-01-02"))'), 0);
  run('dataUsage.days[1].bytes += 20;');
  assert.equal(run('usageTotal(new Date("2026-01-01"), new Date("2026-01-02"))'), 20);
  run('dataUsage.days[1].reportDeletedBytes = 0;');
  assert.equal(run('usageTotal(new Date("2026-01-01"), new Date("2026-01-02"))'), 120);
  console.log('Data consumption checks passed: migration, baselines, deltas, duplicate/stale writes, resets, deletion, RADIUS updates, UTC period boundaries and leap years.');
} finally {
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
}
