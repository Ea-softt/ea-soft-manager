const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

async function main() {
  let saved = JSON.stringify({ settings: { apiUrl: 'https://example.test', adminToken: 'old-secret' }, users: [{ password: 'private' }], plans: [] });
  const app = { innerHTML: '' };
  const button = {};
  const error = {};
  let submit;
  const form = {
    elements: { email: { value: '' }, password: { value: '' }, code: { value: '' }, confirmPassword: { value: '' } },
    querySelector: (selector) => selector === 'button[type="submit"]' ? button : error,
    addEventListener: (_, callback) => { submit = callback; }
  };
  const source = fs.readFileSync('src/main.js', 'utf8');
  const context = vm.createContext({
    crypto, URL, console, setInterval() {}, setTimeout() {},
    window: { location: { protocol: 'https:', host: 'example.test', hostname: 'example.test' } },
    document: { hidden: false, querySelector: (selector) => selector === '#app' ? app : selector === '#admin-login-form' ? form : selector === '#login-error' ? error : selector === '#login-mode' ? {} : null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
    Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}), createIcons() {},
    fetch: async () => ({ status: 401, ok: false, json: async () => ({}) })
  });
  for (const name of source.match(/import \{ (.*?) \} from 'lucide'/)[1].split(', ')) {
    if (name !== 'createIcons') context[name] = {};
  }
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  assert.match(app.innerHTML, /Admin sign in/);
  assert.doesNotMatch(saved, /old-secret|private|adminToken|users/);
  form.elements.password.value = 'wrong';
  await submit({ preventDefault() {} });
  assert.match(error.textContent, /expired/);
  assert.equal(vm.runInContext('authenticated', context), false);

  context.fetch = async () => ({ status: 200, ok: true, json: async () => ({ success: true, towns: [{ id: 'default', name: 'Main town' }], token: 'session-secret', email: 'admin@example.test', plans: [], users: [], sales: [] }) });
  form.elements.password.value = 'valid-secret';
  await submit({ preventDefault() {} });
  assert.equal(vm.runInContext('authenticated', context), true);
  assert.match(app.innerHTML, /Sign out/);
  assert.doesNotMatch(saved, /valid-secret/);

  // Missing finance history must not invent finance totals.
  context.fetch = async () => ({ status: 200, ok: true, json: async () => ({ success: true,
    plans: [{ id: 'daily', name: 'Daily', price: 5 }],
    users: [{ id: 'retained', username: 'EA-123', planId: 'daily', amount: 5, createdAt: Date.now(), status: 'active' }]
  }) });
  await vm.runInContext('syncRemoteState()', context);
  assert.equal(vm.runInContext('state.users.length', context), 1);
  assert.equal(vm.runInContext('state.plans.length', context), 1);
  assert.equal(vm.runInContext('financeAvailable', context), false);
  assert.match(vm.runInContext('renderFinances()', context), /Finance history unavailable/);
  vm.runInContext('render()', context);
  assert.match(app.innerHTML, /EA-123/);
  assert.match(app.innerHTML, /backend needs the finance update/);

  context.fetch = async () => ({ status: 502, ok: false, json: async () => ({ message: 'Backend unavailable' }) });
  await vm.runInContext('refreshVoucherStatus()', context);
  assert.equal(vm.runInContext('state.users.length', context), 1);
  assert.match(app.innerHTML, /Backend unavailable/);

  let complete;
  context.fetch = (_, options) => options.method === 'DELETE' ? Promise.resolve({ status: 200, ok: true, json: async () => ({ success: true }) }) : new Promise((resolve) => { complete = resolve; });
  const pending = vm.runInContext("apiRequest('/api/admin/state')", context);
  vm.runInContext('signOut()', context);
  complete({ status: 200, ok: true, json: async () => ({ success: true }) });
  await assert.rejects(pending, /signed out/);
  assert.match(app.innerHTML, /Admin sign in/);
  assert.equal(vm.runInContext('state.settings.adminToken', context), '');

  context.fetch = async () => ({ status: 200, ok: true, json: async () => ({ success: true, message: 'Reset code sent.' }) });
  vm.runInContext("loginMode = 'forgot'; renderLogin();", context);
  form.elements.email.value = 'admin@example.test';
  await submit({ preventDefault() {} });
  assert.match(app.innerHTML, /Reset password/);
  assert.equal(form.elements.email.value, 'admin@example.test');
  form.elements.password.value = 'UpdatedPassword123!';
  form.elements.confirmPassword.value = 'Mismatch';
  await submit({ preventDefault() {} });
  assert.match(error.textContent, /do not match/);
  form.elements.confirmPassword.value = form.elements.password.value;
  await submit({ preventDefault() {} });
  assert.match(app.innerHTML, /Admin sign in/);
  assert.match(error.textContent, /Password updated/);

  vm.runInContext("authenticated = true; state.settings.adminToken = 'test'; towns = [{id:'default',name:'Main'}, {id:'town-two',name:'Second'}];", context);
  const urls = [];
  context.fetch = async (url) => {
    urls.push(url);
    return { status: 200, ok: true, json: async () => url.endsWith('/overview')
      ? { success: true, towns: [{id:'town-two',name:'<img>',available:true,vouchers:2,active:1,revenue:10}], sales: [{amount:10}], complete:true }
      : { success: true, plans: [], users: [], sales: [] } };
  };
  vm.runInContext("terminalOutput = 'old-router-output'; selectedVoucherIds.add('old-id');", context);
  await vm.runInContext("switchTown('town-two')", context);
  assert.match(urls.at(-1), /\/api\/towns\/town-two\/admin\/state$/);
  assert.equal(vm.runInContext('terminalOutput', context), '');
  assert.equal(vm.runInContext('selectedVoucherIds.size', context), 0);
  await vm.runInContext("switchTown('all')", context);
  assert.match(app.innerHTML, /Combined revenue/);
  assert.match(app.innerHTML, /&lt;img&gt;/);
  vm.runInContext('sharedVoucherMode = true; render();', context);
  assert.match(app.innerHTML, /one expiry and one total data allowance/);
  await assert.rejects(vm.runInContext("apiRequest('/api/admin/terminal', {method:'POST'})", context), /Select a town/);
  vm.runInContext('pendingRequests = 1;', context);
  await vm.runInContext("switchTown('default')", context);
  assert.equal(vm.runInContext('selectedTown', context), 'all');
  vm.runInContext('pendingRequests = 0;', context);
  vm.runInContext("townSettings = [];", context);
  const fieldset = { disabled: false };
  const townMessage = { textContent: '' };
  let reset = false;
  let submitted;
  context.FormData = class { constructor() { return new Map(Object.entries({ name: 'Test town', host: '10.0.0.3', port: '8728', username: 'router-user', password: 'router-private-password' })); } };
  context.townFormEvent = { preventDefault() {}, target: { querySelector: (selector) => selector === 'fieldset' ? fieldset : townMessage, reset() { reset = true; } } };
  context.fetch = async (url, options) => {
    assert.match(url, /\/api\/admin\/towns$/);
    submitted = JSON.parse(options.body);
    return { status: 201, ok: true, json: async () => ({ success: true, town: { id: 'test-town', name: 'Test town', host: '10.0.0.3', port: 8728, username: 'router-user' } }) };
  };
  await vm.runInContext('saveTown(townFormEvent)', context);
  assert.equal(submitted.password, 'router-private-password');
  assert.ok(reset);
  assert.equal(fieldset.disabled, false);
  assert.equal(vm.runInContext('townSettings.length', context), 1);
  assert.doesNotMatch(vm.runInContext('renderTownSettings()', context), /router-private-password/);
  assert.doesNotMatch(saved, /router-private-password|router-user/);
  context.fetch = async () => ({ status: 500, ok: false, json: async () => ({ message: 'Could not save town' }) });
  reset = false;
  await vm.runInContext('saveTown(townFormEvent)', context);
  assert.equal(reset, false);
  assert.equal(fieldset.disabled, false);
  assert.match(townMessage.textContent, /Could not save town/);
  console.log('Frontend auth, town selection, and settings submission checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
