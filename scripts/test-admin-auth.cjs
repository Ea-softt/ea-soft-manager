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

  context.fetch = async () => ({ status: 200, ok: true, json: async () => ({ success: true, token: 'session-secret', email: 'admin@example.test', plans: [], users: [] }) });
  form.elements.password.value = 'valid-secret';
  await submit({ preventDefault() {} });
  assert.equal(vm.runInContext('authenticated', context), true);
  assert.match(app.innerHTML, /Sign out/);
  assert.doesNotMatch(saved, /valid-secret/);

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

  console.log('Frontend auth checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
