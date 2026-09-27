const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createSharedVouchers, installRadiusRest } = require('../hotspot/shared-vouchers');
const express = createRequire(path.resolve('hotspot/server.js'))('express');

async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-roaming-'));
    let clock = Date.now();
    const start = clock;
    const disconnected = [];
    const instances = new Map(['default', 'second-town'].map((townId) => {
        const file = path.join(directory, `${townId}.json`);
        fs.writeFileSync(file, JSON.stringify({ vouchers: [], sales: [], plans: [], paymentAttempts: [] }));
        return [townId, {
            readManagerData: () => JSON.parse(fs.readFileSync(file)),
            updateSharedVoucher(id, updates) {
                const data = this.readManagerData();
                Object.assign(data.vouchers.find((v) => v.id === id), updates);
                fs.writeFileSync(file, JSON.stringify(data));
            },
            disconnectSharedVoucher: async (username) => { disconnected.push([townId, username]); }
        }];
    }));
    function add(username, sharedUsers = 1, townId = 'default') {
        const file = path.join(directory, `${townId}.json`);
        const data = JSON.parse(fs.readFileSync(file));
        data.vouchers.push({ id: username, username, password: '%{literal-password}', durationMs: 3600000, dataLimit: 5,
            sharedUsers, rateLimit: '2M/2M', status: 'active', activatedAt: null, expiresAt: null });
        data.sales.push({ id: username, amount: 5 });
        fs.writeFileSync(file, JSON.stringify(data));
    }
    let server;
    try {
        add('roamer'); add('family', 2); add('unused');
        const service = createSharedVouchers({ instances, now: () => clock });
        assert.equal(service.authorize('unused')['control:Cleartext-Password'].do_xlat, false);
        assert.equal(instances.get('default').readManagerData().vouchers.find((v) => v.id === 'unused').activatedAt, null);
        assert.throws(() => service.assertAvailable('roamer'), /already used/);
        const first = service.grant({ username: 'roamer', townId: 'default', sessionId: 'a' });
        const expiry = instances.get('default').readManagerData().vouchers[0].expiresAt;
        assert.equal(expiry, start + 3600000);
        assert.equal(first['reply:Session-Timeout'].value[0], 3600);
        assert.equal(first['reply:Mikrotik-Total-Limit-Gigawords'].value[0], 1);
        const firstToken = first['reply:Class'].value[0];
        const retry = service.grant({ username: 'roamer', townId: 'default', sessionId: 'a' });
        assert.equal(retry['reply:Class'].value[0], firstToken);
        assert.throws(() => service.grant({ username: 'roamer', townId: 'second-town', sessionId: 'b' }), /already connected/);
        const oneGB = 1024 ** 3;
        const record = (status, bytes) => service.account({ username: 'roamer', townId: 'default', sessionId: 'a', token: firstToken, status, bytes });
        record('Start', 0); record('Interim-Update', oneGB); record('Interim-Update', oneGB); record('Interim-Update', 100);
        record('Stop', 2 * oneGB);
        clock += 600000;
        const second = service.grant({ username: 'roamer', townId: 'second-town', sessionId: 'b' });
        assert.equal(second['reply:Session-Timeout'].value[0], 3000);
        assert.equal(second['reply:Mikrotik-Total-Limit'].value[0], 3 * oneGB);
        assert.equal(second['reply:WISPr-Session-Terminate-Time'].value[0], first['reply:WISPr-Session-Terminate-Time'].value[0]);
        assert.equal(instances.get('default').readManagerData().vouchers[0].expiresAt, expiry);
        assert.equal(instances.get('second-town').readManagerData().sales.length, 0);
        const familyA = service.grant({ username: 'family', townId: 'default', sessionId: 'fa' });
        const familyB = service.grant({ username: 'family', townId: 'second-town', sessionId: 'fb' });
        assert.equal(familyA['reply:Mikrotik-Total-Limit'].value[0] + familyB['reply:Mikrotik-Total-Limit'].value[0], 5 * oneGB);
        assert.throws(() => service.grant({ username: 'family', townId: 'default', sessionId: 'fc' }), /already connected/);
        const restarted = createSharedVouchers({ instances, now: () => clock });
        assert.throws(() => restarted.grant({ username: 'family', townId: 'default', sessionId: 'fc' }), /already connected/);
        const secondToken = second['reply:Class'].value[0];
        restarted.account({ username: 'roamer', townId: 'second-town', sessionId: 'b', token: secondToken, status: 'Stop', bytes: 3 * oneGB });
        assert.equal(instances.get('default').readManagerData().vouchers[0].dataConsumedBytes, 5 * oneGB);
        assert.throws(() => restarted.authorize('roamer'), /allowance/);
        clock = start + 3600000;
        assert.throws(() => restarted.authorize('roamer'), /expired/);
        assert.throws(() => restarted.grant({ username: 'roamer', townId: 'second-town', sessionId: 'c' }), /expired/);
        restarted.expireTown('default');
        assert.equal(instances.get('default').readManagerData().vouchers[0].status, 'expired');
        await restarted.revoke('unused');
        assert.deepEqual(disconnected.map(([town]) => town), ['default', 'second-town']);
        assert.throws(() => restarted.authorize('unused'), /unavailable/);

        add('http-user');
        const app = express(); app.use(express.json());
        const secret = 'test-secret-that-is-at-least-32-characters';
        installRadiusRest(app, restarted, { secret, townIds: [...instances.keys()] });
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        const attrs = { 'User-Name': { value: ['http-user'] }, 'Tmp-String-0': { value: ['second-town'] }, 'Acct-Session-Id': { value: ['http-session'] } };
        async function request(route, body = attrs, auth = secret) {
            return fetch(`http://127.0.0.1:${server.address().port}/api/internal/radius/${route}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(body)
            });
        }
        assert.equal((await request('authorize', attrs, 'wrong')).status, 401);
        assert.equal((await request('authorize')).status, 200);
        const grantResponse = await request('post-auth'); assert.equal(grantResponse.status, 200);
        const granted = await grantResponse.json();
        const acct = { ...attrs, Class: { value: ['0x' + Buffer.from(granted['reply:Class'].value[0]).toString('hex')] },
            'Acct-Status-Type': { value: ['Stop'] }, 'Acct-Input-Gigawords': { value: [1] }, 'Acct-Output-Octets': { value: [123] } };
        assert.equal((await request('accounting', acct)).status, 204);
        assert.equal((await request('accounting', acct)).status, 204);
        assert.equal(instances.get('default').readManagerData().vouchers.find((v) => v.id === 'http-user').dataConsumedBytes, 4294967296 + 123);
        assert.equal((await request('post-auth', { ...attrs, 'Tmp-String-0': { value: ['unknown'] } })).status, 403);
        assert.equal((await request('accounting', { ...acct, Class: { value: ['wrong'] } })).status, 400);
        add('roamer', 1, 'second-town');
        assert.throws(() => createSharedVouchers({ instances }), /duplicate/);
        console.log('Shared voucher checks passed: one expiry, roaming, shared quota, concurrent byte reservations, retry/late accounting, persistence, revoked/expired rejection in every town, REST authentication, and duplicate-code detection.');
    } finally {
        if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
