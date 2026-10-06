const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { createMultiTownApp, loadTowns } = require('../hotspot/towns');
const { hashPassword } = require('../hotspot/admin-auth');

async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-towns-'));
    const env = { DATA_FILE: path.join(directory, 'manager.json'), TOWNS_FILE: path.join(directory, 'towns.json'),
        ADMIN_ACCOUNT_FILE: path.join(directory, 'account.json'), ADMIN_EMAIL: 'admin@example.test',
        ADMIN_PASSWORD_HASH: hashPassword('test-password-123'), MIKROTIK_HOST: 'router-one',
        MIKROTIK_USERNAME: 'one', MIKROTIK_PASSWORD: 'secret-one',
        MIKROTIK_SSH_HOST_SHA256: 'a'.repeat(64), PAYSTACK_SECRET_KEY: 'test-paystack' };
    const config = [{ id: 'default', name: 'Town one' }, { id: 'town-two', name: 'Town two', router: {
        MIKROTIK_HOST: 'router-two', MIKROTIK_USERNAME: 'two', MIKROTIK_PASSWORD: 'secret-two', MIKROTIK_SSH_HOST_SHA256: 'b'.repeat(64) } }];
    fs.writeFileSync(env.TOWNS_FILE, JSON.stringify(config));
    const plan = { id: 'daily', name: 'Daily', price: 5, dataLimit: 11, duration: 1, period: 'days' };
    fs.writeFileSync(env.DATA_FILE, JSON.stringify({ plans: [plan], vouchers: [], sales: [{ id: 'old', amount: 12, createdAt: Date.now() }] }));
    const calls = [];
    const transactions = new Map();
    const timers = [];
    class Router {
        constructor(options) { this.options = options; }
        on() {}
        async connect() { await new Promise((resolve) => setTimeout(resolve, this.options.host === 'router-one' ? 15 : 1)); }
        async close() {}
        async write(command, args) { calls.push({ host: this.options.host, command, args }); return []; }
    }
    const sourceFile = path.resolve('hotspot/server.js');
    const realRequire = createRequire(sourceFile);
    const moduleObject = { exports: {} };
    function mockRequire(name) {
        if (name === 'routeros-client') return { RouterOSAPI: Router };
        if (name === './terminal') return { installTerminal(app, guard, options) {
            realRequire(name).installTerminal(app, guard, { ...options, execute: async (_cmd, ssh) => {
                calls.push({ host: ssh.host, command: 'ssh' }); return { output: ssh.host, exitCode: 0 };
            } });
        } };
        return realRequire(name);
    }
    vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), {
        require: mockRequire, module: moduleObject, __dirname: path.dirname(sourceFile), process, Buffer, console, URL,
        setTimeout: (fn, ms) => { if (ms === 2000) return setTimeout(fn, ms); timers.push(fn); return fn; },
        clearTimeout, setInterval: (fn) => { timers.push(fn); return fn; }, clearInterval() {},
        fetch: async (url, options) => {
            if (url.endsWith('/initialize')) {
                const payment = JSON.parse(options.body);
                transactions.set(payment.reference, { ...payment, status: 'success', paid_at: new Date().toISOString() });
                return { ok: true, json: async () => ({ status: true, data: { reference: payment.reference, access_code: 'test' } }) };
            }
            const reference = decodeURIComponent(url.split('/').pop());
            return { ok: true, json: async () => ({ status: true, data: transactions.get(reference) }) };
        }
    });
    let server;
    try {
        const manager = createMultiTownApp({ env, createTownApp: moduleObject.exports.createTownApp });
        server = manager.app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        let base = `http://127.0.0.1:${server.address().port}`;
        let token;
        async function request(url, method = 'GET', body, headers = {}) {
            const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, data: await response.json().catch(() => ({})) };
        }
        assert.equal((await request('/api/admin/towns')).status, 401);
        const login = await request('/api/admin/session', 'POST', { email: env.ADMIN_EMAIL, password: 'test-password-123' });
        assert.equal(login.status, 200); token = login.data.token;
        const list = await request('/api/admin/towns');
        assert.equal(list.data.towns.length, 2);
        assert.doesNotMatch(JSON.stringify(list), /secret-one|secret-two|router-one|router-two/);
        assert.equal((await request('/api/towns/missing/admin/state')).status, 404);
        assert.equal((await request('/api/towns/all/admin/vouchers', 'POST', {})).status, 404);
        const created = await Promise.all(['default', 'town-two'].map((town) => request(`/api/towns/${town}/admin/vouchers`, 'POST', { username: '123', password: '456', planId: 'daily', amount: 5 })));
        assert.deepEqual(created.map((result) => result.status), [201, 201]);
        assert.deepEqual(new Set(calls.filter((call) => call.command.endsWith('/add')).map((call) => call.host)), new Set(['router-one', 'router-two']));
        const wrongTown = await request(`/api/towns/town-two/admin/vouchers/${created[0].data.user.id}`, 'PUT', { amount: 99 });
        assert.equal(wrongTown.status, 404);
        assert.equal((await request('/api/towns/town-two/admin/terminal', 'POST', { command: '/system resource print' })).data.output, 'router-two');
        const overview = await request('/api/admin/towns/overview');
        assert.equal(overview.data.complete, true);
        assert.equal(overview.data.sales.reduce((sum, sale) => sum + sale.amount, 0), 22);
        assert.equal((await request('/api/admin/state')).data.sales.reduce((sum, sale) => sum + sale.amount, 0), 17);
        const payment = await request('/api/towns/town-two/initiate-payment', 'POST', { planName: 'Daily', amount: 5, phone: '0241234567' });
        assert.equal(payment.status, 200);
        const reference = payment.data.reference;
        assert.equal(transactions.get(reference).metadata.town_id, 'town-two');
        const before = calls.length;
        const wrongRecovery = await request('/api/towns/default/admin/reconcile-payment', 'POST', { reference });
        assert.equal(wrongRecovery.status, 502);
        assert.match(wrongRecovery.data.message, /different town/);
        assert.equal(calls.length, before);
        const event = { event: 'charge.success', data: transactions.get(reference) };
        const signature = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(JSON.stringify(event)).digest('hex');
        assert.equal((await request('/api/paystack/webhook', 'POST', event, { 'x-paystack-signature': 'invalid' })).status, 401);
        assert.equal((await request('/api/paystack/webhook', 'POST', event, { 'x-paystack-signature': signature })).status, 200);
        assert.ok(calls.slice(before).every((call) => call.host === 'router-two'));
        assert.equal((await request('/api/towns/town-two/payment-complete', 'POST', { reference })).status, 200);
        const secondFile = path.join(directory, 'towns', 'town-two.json');
        assert.equal(JSON.parse(fs.readFileSync(secondFile)).sales.length, 2);
        assert.equal(JSON.parse(fs.readFileSync(env.DATA_FILE)).sales.length, 2);
        manager.startJobs(); assert.equal(timers.length, 12);
        const beforeJobs = calls.length;
        await Promise.all(timers.map((fn) => fn()));
        assert.deepEqual(new Set(calls.slice(beforeJobs).map((call) => call.host)), new Set(['router-one', 'router-two']));
        manager.stopJobs();
        fs.writeFileSync(secondFile, 'invalid');
        const partial = await request('/api/admin/towns/overview');
        assert.equal(partial.data.complete, false);
        assert.equal(partial.data.towns[1].available, false);
        fs.writeFileSync(env.TOWNS_FILE, JSON.stringify([...config, config[1]]));
        assert.throws(() => loadTowns(env), /unique/);
        // Shared RADIUS mode issues credentials centrally, never router-local copies.
        fs.writeFileSync(env.TOWNS_FILE, JSON.stringify(config));
        const radiusEnv = { ...env, DATA_FILE: path.join(directory, 'shared', 'manager.json'), VOUCHER_AUTH_MODE: 'radius', RADIUS_REST_SECRET: 'radius-test-secret-at-least-32-characters' };
        const radiusManager = createMultiTownApp({ env: radiusEnv, createTownApp: moduleObject.exports.createTownApp });
        server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
        server = radiusManager.app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
        token = (await request('/api/admin/session', 'POST', { email: env.ADMIN_EMAIL, password: 'test-password-123' })).data.token;
        assert.equal((await request('/api/admin/towns')).data.sharedVouchers, true);
        const beforeShared = calls.length;
        const sharedCreation = await request('/api/towns/default/admin/vouchers', 'POST', { username: '777', password: '888', planId: 'daily' });
        assert.equal(sharedCreation.status, 201);
        const duplicated = await request('/api/towns/town-two/admin/vouchers', 'POST', { username: '777', password: '999', planId: 'daily' });
        assert.equal(duplicated.status, 500);
        assert.match(duplicated.data.message, /already used/);
        const sharedPayment = await request('/api/towns/town-two/initiate-payment', 'POST', { planName: 'Daily', amount: 5, phone: '0241234567' });
        assert.equal((await request('/api/towns/town-two/payment-complete', 'POST', { reference: sharedPayment.data.reference })).status, 200);
        const sharedState = await request('/api/towns/default/admin/state');
        assert.equal(sharedState.data.users.length, 1);
        assert.equal(calls.length, beforeShared);
        const attrs = { 'User-Name': { value: ['777'] }, 'Tmp-String-0': { value: ['town-two'] }, 'Acct-Session-Id': { value: ['roam-session'] } };
        const grant = await request('/api/internal/radius/post-auth', 'POST', attrs, { Authorization: `Bearer ${radiusEnv.RADIUS_REST_SECRET}` });
        assert.equal(grant.status, 200);
        assert.ok(grant.data['reply:Session-Timeout'].value[0] >= 86398 && grant.data['reply:Session-Timeout'].value[0] <= 86400);
        const activated = (await request('/api/towns/default/admin/state')).data.users[0];
        assert.equal(activated.lastTownId, 'town-two');
        assert.ok(activated.expiresAt > activated.activatedAt);
        assert.equal((await request('/api/admin/towns/overview')).data.sales.length, 2);
        assert.equal((await request(`/api/towns/default/admin/vouchers/${sharedCreation.data.user.id}`, 'DELETE')).status, 200);
        assert.equal((await request('/api/internal/radius/authorize', 'POST', attrs, { Authorization: `Bearer ${radiusEnv.RADIUS_REST_SECRET}` })).status, 403);
        const townFields = { name: 'Third town', host: '10.200.0.3', port: 8728, username: 'third-admin', password: 'private-third-password', sshPort: 22, sshFingerprint: 'c'.repeat(64) };
        const adminToken = token; token = undefined;
        assert.equal((await request('/api/admin/towns', 'POST', townFields)).status, 401);
        assert.equal((await request('/api/admin/towns/settings')).status, 401);
        token = adminToken;
        assert.equal((await request('/api/admin/towns', 'POST', { ...townFields, host: 'http://bad-host' })).status, 400);
        assert.equal((await request('/api/admin/towns', 'POST', { ...townFields, port: 0 })).status, 400);
        assert.equal((await request('/api/admin/towns', 'POST', { ...townFields, sshFingerprint: 'invalid' })).status, 400);
        assert.equal((await request('/api/admin/towns', 'POST', { ...townFields, host: 'router-one' })).status, 400);
        radiusManager.startJobs();
        const beforeAddTimers = timers.length;
        const added = await request('/api/admin/towns', 'POST', townFields);
        assert.equal(added.status, 201);
        assert.equal(timers.length, beforeAddTimers + 6);
        assert.equal(radiusManager.townCount, 3);
        assert.doesNotMatch(JSON.stringify(added.data), /private-third-password|MIKROTIK_PASSWORD/);
        assert.equal((await request(`/api/towns/${added.data.town.id}/admin/state`)).status, 200);
        const settings = await request('/api/admin/towns/settings');
        assert.equal(settings.data.towns.length, 3);
        assert.doesNotMatch(JSON.stringify(settings.data), /secret-one|secret-two|private-third-password/);
        assert.equal(loadTowns(radiusEnv).at(-1).env.MIKROTIK_PASSWORD, townFields.password);
        const paidUsername = sharedPayment.data.username;
        const newTownLogin = { 'User-Name': { value: [paidUsername] }, 'Tmp-String-0': { value: [added.data.town.id] }, 'Acct-Session-Id': { value: ['new-town-session'] } };
        assert.equal((await request('/api/internal/radius/post-auth', 'POST', newTownLogin, { Authorization: `Bearer ${radiusEnv.RADIUS_REST_SECRET}` })).status, 200);
        const priorConfig = fs.readFileSync(env.TOWNS_FILE, 'utf8');
        const originalRename = fs.renameSync;
        fs.renameSync = (from, to) => { if (to === env.TOWNS_FILE) throw new Error('Simulated disk failure'); return originalRename(from, to); };
        try {
            assert.equal((await request('/api/admin/towns', 'POST', { ...townFields, name: 'Fourth', host: '10.200.0.4' })).status, 500);
        } finally { fs.renameSync = originalRename; }
        assert.equal(fs.readFileSync(env.TOWNS_FILE, 'utf8'), priorConfig);
        assert.equal(radiusManager.townCount, 3);
        radiusManager.stopJobs();
        console.log('Town settings checks passed: authenticated creation, validation, secret redaction, live routing/jobs/RADIUS registration, persistence, and failed-write rollback.');
        console.log('Multi-town checks passed: shared authentication, concurrent router isolation, records, totals, legacy routes, terminal, payment metadata, signed webhook routing, cross-town payment rejection, retries, and unavailable records.');
    } finally {
        if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
