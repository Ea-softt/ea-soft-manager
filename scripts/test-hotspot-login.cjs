const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('hotspot/login.html', 'utf8');
assert.match(html, /<form name="login" action="\$\(link-login-only\)"/);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

async function checkPaymentLogin(chap) {
  const fields = Object.fromEntries(['username', 'password', 'payment-status', 'momo_phone'].map((id) => [id, { value: '' }]));
  fields.momo_phone.value = '0241234567';
  let submitted = '';
  let callbacks;
  const document = {
    getElementById: (id) => fields[id] || null,
    querySelector: () => chap ? document.sendin : null,
    login: { username: fields.username, password: fields.password, submit() { submitted = 'pap'; } },
    sendin: { username: {}, password: {}, submit() { submitted = 'chap'; } }
  };
  const context = vm.createContext({ document, console,
    alert(message) { throw new Error('Unexpected blocking dialog: ' + message); },
    hexMD5: (value) => 'hashed:' + value,
    PaystackPop: function () { this.resumeTransaction = (_code, options) => { callbacks = options; }; },
    fetch: async (url) => ({ ok: true, json: async () => url.endsWith('/public/plans') ? { success: true, plans: [] }
      : url.endsWith('/initiate-payment') ? { success: true, access_code: 'checkout', reference: 'verified-reference' }
      : { success: true, username: 'purchased-user', password: 'purchased-password' } })
  });
  if (chap) vm.runInContext(scripts[0], context);
  vm.runInContext(scripts[scripts.length - 1], context);
  await vm.runInContext("payWithPaystack('Daily', 5, null)", context);
  await callbacks.onSuccess({ reference: 'verified-reference' });
  assert.equal(submitted, chap ? 'chap' : 'pap');
  assert.equal(fields.username.value, 'purchased-user');
  assert.equal(fields.password.value, 'purchased-password');
  if (chap) {
    assert.equal(document.sendin.username.value, 'purchased-user');
    assert.equal(document.sendin.password.value, 'hashed:$(chap-id)purchased-password$(chap-challenge)');
  }
  assert.match(fields['payment-status'].textContent, /Connecting to Wi-Fi/);
}

async function checkBackgroundActivation() {
  const source = fs.readFileSync('hotspot/server.js', 'utf8');
  const jobs = [];
  let checkedSessions = false;
  const context = vm.createContext({ sharedVouchers: null, env: {}, console: { error() {} },
    setTimeout: (fn) => jobs.push(fn), setInterval: (fn) => jobs.push(fn),
    recoverPendingPayments() {},
    readManagerData: () => ({}),
    readMikroTikHotspotUsers: async () => { throw new Error('User list unavailable'); },
    mergeMikroTikUsers() { throw new Error('Must not merge a failed user read'); },
    syncCalendarActivations: async () => { checkedSessions = true; }
  });
  vm.runInContext(source.slice(source.indexOf('    const timers = [];'), source.indexOf('    return { app, readManagerData, startJobs,')) + '\nstartJobs();', context);
  await jobs[2]();
  assert.equal(checkedSessions, true, 'A failed user refresh must not skip session detection');
}

(async () => {
  await checkPaymentLogin(false);
  await checkPaymentLogin(true);
  await checkBackgroundActivation();
  console.log('Hotspot login checks passed: payment auto-login with PAP and CHAP, no blocking dialogs, and independent background activation.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
