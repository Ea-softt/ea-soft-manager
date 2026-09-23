const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-payments-'));
  const file = path.join(directory, 'manager.json');
  const source = fs.readFileSync('hotspot/server.js', 'utf8');
  let offline = true;
  let additions = 0;
  let sms = 0;
  const routerUsers = [];
  let status = 'success';
  const context = vm.createContext({ fs, path, crypto, DATA_FILE: file,
    defaultPlans: [{ id: 'daily', name: 'Daily', price: 5, dataLimit: 11 }],
    console: { error() {} },
    chooseProfile: (name) => name === 'Daily' ? 'DAILY' : null,
    chooseQuotaBytes: (name) => name === 'Daily' ? 11811160064 : null,
    paystackVerify: async (reference) => ({ status, reference, currency: 'GHS', amount: 500,
      paid_at: '2026-09-20T12:00:00Z', metadata: { package_name: 'Daily', voucher_username: 'EA-' + reference,
        voucher_password: 'abcdef', phone: '+233241234567', package_amount: 500 } }),
    readMikroTikHotspotUsers: async () => { if (offline) throw new Error('Router offline'); return routerUsers; },
    createMikroTikUser: async (name, password, profile) => { additions++; routerUsers.push({ name, password, profile }); },
    sendVoucherSms: async () => { sms++; }
  });
  const run = (code) => vm.runInContext(code, context);
  run(source.match(/function planDurationMs[\s\S]*?\n\}/)[0]);
  run(source.slice(source.indexOf('function preserveSales('), source.indexOf('const { installAdminAuth }')));
  run(source.slice(source.indexOf('\nfunction recordPaidVoucher({'), source.indexOf("app.get('/api/health'")));
  run(source.slice(source.indexOf('const paymentJobs ='), source.indexOf("app.post('/api/initiate-payment'")));
  try {
    status = 'pending';
    await assert.rejects(run("fulfillPayment('first')"), /not completed/);
    assert.equal(run('readManagerData().vouchers.length'), 0);
    status = 'success';
    await assert.rejects(run("fulfillPayment('first')"), /Payment is recorded/);
    assert.equal(run('readManagerData().vouchers.length'), 1);
    assert.equal(run('readManagerData().vouchers[0].status'), 'pending');
    assert.equal(run('readManagerData().sales[0].amount'), 5);
    assert.equal(run('readManagerData().sales[0].createdAt'), Date.parse('2026-09-20T12:00:00Z'));
    assert.equal(run('readManagerData().paymentAttempts.length'), 1);
    run('var pendingSnapshot = readManagerData();');
    offline = false;
    await Promise.all([run("fulfillPayment('first')"), run("fulfillPayment('first')")]);
    assert.equal(additions, 1);
    assert.equal(sms, 1);
    assert.equal(run('readManagerData().vouchers[0].status'), 'active');
    assert.equal(run('readManagerData().sales.length'), 1);
    assert.equal(run('readManagerData().paymentAttempts.length'), 0);
    run('writeManagerData(pendingSnapshot);');
    assert.equal(run('readManagerData().vouchers[0].provisioning'), 'ready');

    run('var oldPlans = readManagerData(); var changedPlans = readManagerData(); changedPlans.plans = [...changedPlans.plans, {id: "extra", name: "Extra", price: 10}]; writeManagerData(changedPlans, null, [], true); writeManagerData(oldPlans);');
    assert.equal(run('readManagerData().plans.length'), 2);

    // A router sync holding an old snapshot cannot erase a new purchase.
    run('var stale = readManagerData();');
    await run("fulfillPayment('second')");
    run('writeManagerData(stale);');
    assert.equal(run('readManagerData().vouchers.length'), 2);
    run('var beforeDelete = readManagerData(); var deleted = beforeDelete.vouchers.find((item) => item.paymentReference === "second").id; writeManagerData(readManagerData(), null, [deleted]); writeManagerData(beforeDelete);');
    assert.equal(run('readManagerData().vouchers.length'), 1);
    assert.equal(run('readManagerData().sales.length'), 2);
    await assert.rejects(run("fulfillPayment('second')"), /already recorded/);

    // Missing customer callbacks are recovered using the persisted reference queue.
    run("rememberPaymentAttempt('hosted', false, 0);");
    await run('recoverPendingPayments()');
    assert.equal(run("readManagerData().vouchers.filter((item) => item.paymentReference === 'hosted').length"), 1);

    // Recover an existing imported router account, without duplicate users or zero-income rows.
    routerUsers.push({ name: 'EA-imported', password: 'abcdef', profile: 'DAILY' });
    run('var importedData = readManagerData(); importedData.vouchers.push({id: "router-import", username: "EA-imported", amount: 0, source: "mikrotik", createdAt: Date.now(), activatedAt: 1000, expiresAt: 2000}); writeManagerData(importedData);');
    await run("fulfillPayment('imported')");
    assert.equal(run("readManagerData().vouchers.filter((item) => item.username === 'EA-imported').length"), 1);
    assert.equal(run("readManagerData().sales.find((item) => item.voucherId === 'router-import').amount"), 5);
    assert.equal(run("readManagerData().sales.find((item) => item.voucherId === 'router-import').paymentReference"), 'imported');
    assert.equal(run("readManagerData().vouchers.find((item) => item.id === 'router-import').activatedAt"), 1000);
    assert.equal(run("readManagerData().vouchers.find((item) => item.id === 'router-import').expiresAt"), 2000);
    assert.equal(additions, 3);
    console.log('Hotspot payment checks passed: verified recording, router outage, retries, duplicate callbacks, deletion replay, stale sync, hosted recovery, imported accounts.');
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
