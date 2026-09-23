const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

async function main() {
  let saved;
  let click;
  let failUnlock = false;
  let rejectPassword = false;
  let requests = 0;
  let cleared = 0;
  let host = 'http://104.248.239.23';
  const button = { addEventListener: (_, callback) => { click = callback; } };
  const submit = {};
  const message = {};
  const app = {};
  const controls = {};
  const form = { elements: { email: {}, password: {} }, addEventListener() {}, querySelector: (selector) => selector === '#login-error' ? message : submit };
  const plugin = {
    status: async () => ({ available: true, enabled: true }),
    unlock: async () => { if (failUnlock) throw Error('Cancelled'); return { email: 'admin@example.test', password: 'private-password', apiUrl: host }; },
    clear: async () => { cleared++; }
  };
  const source = fs.readFileSync('src/main.js', 'utf8');
  const context = vm.createContext({ crypto, URL, console, setTimeout() {}, setInterval() {},
    window: { location: { protocol: 'https:' } },
    document: { hidden: false, addEventListener() {}, querySelectorAll: () => [], querySelector: (selector) => ({
      '#app': app, '#admin-login-form': form, '#biometric-controls': controls,
      '#fingerprint-login': button, '#login-mode': {}, '#login-error': message
    }[selector] || null) },
    localStorage: { getItem: () => null, setItem: (_, value) => { saved = value; } },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    registerPlugin: (name) => name === 'BiometricLogin' ? plugin : {}, createIcons() {},
    CapacitorHttp: { request: async (request) => {
      requests++;
      if (request.url.endsWith('/session') && request.method === 'POST') {
        assert.equal(request.data.password, 'private-password');
        return rejectPassword ? { status: 401, data: { message: 'Password changed. Use your new password.' } } :
          { status: 200, data: { success: true, token: 'session-token', email: 'admin@example.test' } };
      }
      return { status: 200, data: { success: true, plans: [], users: [], sales: [] } };
    } }
  });
  for (const name of source.match(/import \{ (.*?) \} from 'lucide'/)[1].split(', ')) if (name !== 'createIcons') context[name] = {};
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  await new Promise(setImmediate);
  assert.match(controls.innerHTML, /Sign in with fingerprint/);

  failUnlock = true;
  await click({ currentTarget: button });
  assert.equal(requests, 0);
  assert.equal(vm.runInContext('authenticated', context), false);
  failUnlock = false;
  host = 'https://another-server.test';
  await click({ currentTarget: button });
  assert.equal(requests, 0);
  assert.match(message.textContent, /connection changed/);

  host = 'http://104.248.239.23';
  rejectPassword = true;
  await click({ currentTarget: button });
  assert.equal(cleared, 1);
  assert.equal(vm.runInContext('authenticated', context), false);

  rejectPassword = false;
  await click({ currentTarget: button });
  assert.equal(vm.runInContext('authenticated', context), true);
  assert.doesNotMatch(saved, /private-password|session-token/);
  console.log('Fingerprint UI checks passed: cancellation, server binding, backend verification, rejected credentials, storage exclusion.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
