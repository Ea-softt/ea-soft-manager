const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

async function main() {
  const app = { innerHTML: '' };
  const controls = new Map();
  const control = (name) => {
    if (!controls.has(name)) controls.set(name, { disabled: false, handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } });
    return controls.get(name);
  };
  const login = control('#admin-login-form');
  login.elements = { email: { value: '' }, password: { value: '' } };
  login.querySelector = control;
  const voucherForm = control('#agent-voucher-form');
  voucherForm.elements = { phone: { value: '0241234567' }, planId: { value: 'daily' } };
  voucherForm.querySelector = control;
  const requests = [];
  let failed = true;
  const context = vm.createContext({
    crypto, URL, console, setInterval() {}, setTimeout() {},
    window: { location: { protocol: 'https:', host: 'example.test', hostname: 'example.test' } },
    document: { hidden: false, querySelector: (s) => s === '#app' ? app : control(s), querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}), createIcons() {},
    fetch: async (url, options) => {
      requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
      let data;
      if (url.endsWith('/session')) data = { token: 'token', role: 'agent', email: 'alice@example.test' };
      else if (url.endsWith('/towns')) data = { towns: [{ id: 'default', name: 'Main' }] };
      else if (url.endsWith('/state')) data = { plans: [{ id: 'daily', name: 'Daily', price: 5 }], users: [], sales: [{ id: 'sale', amount: 5, createdAt: Date.now(), planId: 'daily' }], payments: [], amountDue: 5 };
      else if (url.endsWith('/vouchers')) {
        if (failed) throw new Error('Lost connection');
        data = { user: { username: '123', password: '456', amount: 5, smsStatus: 'failed' } };
      } else throw new Error(`Unexpected route ${url}`);
      return { status: 200, ok: true, json: async () => ({ success: true, ...data }) };
    }
  });
  const source = fs.readFileSync('src/main.js', 'utf8');
  for (const name of source.match(/import \{ (.*?) \} from 'lucide'/)[1].split(', ')) if (name !== 'createIcons') context[name] = {};
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  await login.handlers.submit({ preventDefault() {} });
  assert.equal(vm.runInContext('accountRole', context), 'agent');
  assert.match(app.innerHTML, /Create customer voucher/);
  assert.match(app.innerHTML, /GH₵5.00/);
  assert.doesNotMatch(app.innerHTML, /data-view=|name="username"|name="password"|name="amount"|Terminal/);
  await voucherForm.handlers.submit({ preventDefault() {}, target: voucherForm });
  const first = requests.at(-1).body;
  assert.match(control('#agent-error').textContent, /Cannot reach/);
  assert.equal(control('fieldset').disabled, false);
  failed = false;
  await voucherForm.handlers.submit({ preventDefault() {}, target: voucherForm });
  const retry = requests.filter((r) => r.url.endsWith('/vouchers')).at(-1).body;
  assert.equal(first.requestId, retry.requestId);
  assert.deepEqual(Object.keys(retry).sort(), ['phone', 'planId', 'requestId']);
  assert.match(app.innerHTML, /Username: <strong>123/);
  assert.match(app.innerHTML, /SMS was not confirmed/);
  assert.equal(requests.some((r) => /\/admin\/(state|towns|staff)/.test(r.url)), false);
  vm.runInContext("agentLedger = { sales: [{amount: 7.5}], payments: [{id: 'receipt', amount: 3, createdAt: Date.now()}] }; render();", context);
  assert.match(app.innerHTML, /Total sales payable to manager: <strong>GH₵7.50/);
  assert.match(app.innerHTML, /Already received by manager: <strong>GH₵3.00/);
  assert.match(app.innerHTML, /Remaining balance to pay: <strong>GH₵4.50/);
  assert.doesNotMatch(app.innerHTML, /Reverse this payment record/);
  vm.runInContext("agentLedger.payments[0].voidedAt = Date.now(); agentLedger.payments[0].voidReason = '<mistake>'; render();", context);
  assert.match(app.innerHTML, /Already received by manager: <strong>GH₵0.00/);
  assert.match(app.innerHTML, /Remaining balance to pay: <strong>GH₵7.50/);
  assert.match(app.innerHTML, /&lt;mistake&gt;/);
  assert.equal(vm.runInContext('agentBalance([{amount: 0.1}, {amount: 0.2}], [{amount: 0.3}]).amountDue', context), 0);
  vm.runInContext('signOut()', context);
  assert.equal(vm.runInContext('agentResult', context), null);
  assert.equal(vm.runInContext('agentLedger.sales.length', context), 0);
  console.log('Agent UI passed: role routing, restricted form, town API routes, retry IDs, SMS warning, sign-out cleanup.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
