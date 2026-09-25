const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('hotspot/server.js', 'utf8');
const start = source.indexOf('// An incomplete optional Terminal deployment');
const end = source.indexOf('\nfunction required(', start);
assert.ok(start > 0 && end > start);
const block = source.slice(start, end);
for (const missing of ['./terminal', 'ssh2']) {
  let route;
  let logged = false;
  const guard = () => {};
  vm.runInNewContext(block, {
    require: () => { throw new Error(`Cannot find module '${missing}'`); },
    console: { error: () => { logged = true; } },
    requireAdminToken: guard,
    app: { post: (...args) => { route = args; } }
  });
  assert.ok(logged);
  assert.equal(route[0], '/api/admin/terminal');
  assert.equal(route[1], guard);
  const response = { set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  route[2]({}, response);
  assert.equal(response.code, 503);
  assert.match(response.body.message, /npm ci/);
}
let installed = false;
vm.runInNewContext(block, {
  require: () => ({ installTerminal: () => { installed = true; } }),
  app: {}, requireAdminToken() {}, console
});
assert.ok(installed);
console.log('Terminal startup isolation tests passed for missing file, missing dependency, and successful installation.');
