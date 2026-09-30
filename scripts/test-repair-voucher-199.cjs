const assert = require('node:assert/strict');
const { repairRecord, ACTIVATED, EXPIRES } = require('../hotspot/repair-voucher-199.cjs');
const fixture = () => ({ vouchers: [{ username: '199', source: 'online-payment',
  paymentReference: 'EA-13ee81fb-6d5b-43e6-8b66-c61ecbc9c114', durationMs: 259200000,
  provisioning: 'ready', status: 'active', activatedAt: null, expiresAt: null,
  password: 'unchanged', dataConsumedBytes: 440770661 }, { username: '200' }], sales: [{ amount: 10 }] });
const data = fixture();
const voucher = repairRecord(data);
assert.equal(new Date(ACTIVATED).toISOString(), '2026-09-29T15:11:57.000Z');
assert.equal(new Date(EXPIRES).toISOString(), '2026-10-02T15:11:57.000Z');
assert.equal(voucher.expiresAt - voucher.activatedAt, 259200000);
assert.equal(voucher.password, 'unchanged');
assert.equal(voucher.dataConsumedBytes, 440770661);
assert.deepEqual(data.vouchers[1], { username: '200' });
assert.deepEqual(data.sales, [{ amount: 10 }]);
assert.deepEqual(repairRecord(data), voucher);
for (const changes of [{ paymentReference: 'other' }, { durationMs: 100 }, { expiresAt: 123 },
  { activatedAt: 456 }, { status: 'expired' }, { radiusRevoked: true }]) {
  const invalid = fixture();
  Object.assign(invalid.vouchers[0], changes);
  assert.throws(() => repairRecord(invalid));
}
assert.throws(() => repairRecord({ vouchers: [] }));
const duplicate = fixture(); duplicate.vouchers.push({ ...duplicate.vouchers[0] });
assert.throws(() => repairRecord(duplicate));
console.log('Voucher 199 repair checks passed: UTC conversion, validity, preserved records, idempotency and mismatch guards.');
