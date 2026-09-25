const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { generateKeyPairSync, createHash } = require('node:crypto');
const { Server, utils } = require('../hotspot/node_modules/ssh2');
const express = require('../hotspot/node_modules/express');
const { runCommand, installTerminal, sshOptions } = require('../hotspot/terminal');

async function main() {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const fingerprint = createHash('sha256').update(utils.parseKey(key).getPublicSSH()).digest('hex');
  const ssh = new Server({ hostKeys: [key] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (ctx) => ctx.username === 'test' && ctx.password === 'secret' ? ctx.accept() : ctx.reject());
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept();
      session.on('exec', (accept, reject, info) => {
        const stream = accept();
        if (info.command === 'wait') return;
        if (info.command === 'large') stream.write('x'.repeat(100));
        else { stream.write('router output: ' + info.command); stream.stderr.write('\nrouter stderr'); }
        stream.exit(0);
        stream.end();
      });
    }));
  });
  ssh.listen(0, '127.0.0.1');
  await new Promise((resolve) => ssh.once('listening', resolve));
  const env = { MIKROTIK_HOST: '127.0.0.1', MIKROTIK_SSH_PORT: ssh.address().port,
    MIKROTIK_USERNAME: 'test', MIKROTIK_PASSWORD: 'secret', MIKROTIK_SSH_HOST_SHA256: fingerprint };
  try {
    assert.throws(() => sshOptions({}), /HOST_SHA256/);
    const options = sshOptions(env);
    const result = await runCommand('/system resource print', options);
    assert.match(result.output, /router output: \/system resource print/);
    assert.match(result.output, /router stderr/);
    assert.equal(result.exitCode, 0);
    assert.match((await runCommand('wait', options, { timeout: 500 })).message, /timed out/);
    const large = await runCommand('large', options, { maxBytes: 32 });
    assert.equal(large.output.length, 32);
    assert.match(large.message, /truncated/);
    assert.match((await runCommand('test', { ...options, hostVerifier: () => false })).message, /SSH error/);
    assert.match((await runCommand('test', { ...options, password: 'wrong' })).message, /SSH error/);

    // Verify authorization, input validation, and single-flight admission at the route.
    const app = express();
    app.use(express.json());
    let release;
    let executions = 0;
    installTerminal(app, (req, res, next) => req.headers.authorization === 'Bearer test' ? next() : res.sendStatus(401), {
      env, execute: () => { executions++; return new Promise((resolve) => { release = resolve; }); }
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const request = (command, authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}/api/admin/terminal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify({ command })
    });
    try {
      assert.equal((await request('test', false)).status, 401);
      for (const invalid of ['', null, {}, 'a\nb', 'x'.repeat(4097)]) assert.equal((await request(invalid)).status, 400);
      assert.equal(executions, 0);
      const pending = request('/system resource print');
      while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal((await request('second')).status, 409);
      release({ output: 'done' });
      const response = await pending;
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.json()).output, 'done');
      assert.equal(executions, 1);
    } finally { server.close(); }
  } finally { ssh.close(); }
  // Exercise UI escaping, duplicate submits, and a reply arriving after sign-out.
  const source = fs.readFileSync('src/main.js', 'utf8');
  const context = vm.createContext({
    crypto: require('node:crypto').webcrypto, URL, console, setInterval() {}, setTimeout() {},
    window: { location: { protocol: 'https:', host: 'example.test', hostname: 'example.test' } },
    document: { hidden: false, querySelector: (selector) => selector === '#app' ? {} : selector === '#admin-login-form' ? { elements: { email: {} }, addEventListener() {} } : selector === '#login-mode' ? {} : null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}), createIcons() {}
  });
  for (const name of source.match(/import \{ (.*?) \} from 'lucide'/)[1].split(', ')) if (name !== 'createIcons') context[name] = {};
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  vm.runInContext(`render = () => {}; authenticated = true; activeView = 'terminal'; terminalOutput = '<script>unsafe</script>'; terminalDraft = '" autofocus';`, context);
  const html = vm.runInContext('renderTerminal()', context);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&quot; autofocus'));
  let complete;
  let requests = 0;
  context.fetch = () => { requests++; return new Promise((resolve) => { complete = resolve; }); };
  const pending = vm.runInContext('runTerminalCommand({ preventDefault() {} })', context);
  await vm.runInContext('runTerminalCommand({ preventDefault() {} })', context);
  assert.equal(requests, 1);
  vm.runInContext('authenticated = false; signOut()', context);
  complete({ status: 200, ok: true, json: async () => ({ success: true, output: 'private late output' }) });
  await pending;
  assert.equal(vm.runInContext('terminalOutput', context), '');
  assert.equal(vm.runInContext('terminalBusy', context), false);
  console.log('Terminal tests passed: SSH execution, host verification, authentication, limits, validation, concurrency, UI escaping, sign-out cleanup.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
