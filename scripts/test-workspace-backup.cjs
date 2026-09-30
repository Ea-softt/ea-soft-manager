const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMultiTownApp } = require('../hotspot/towns');
const { createTownApp } = require('../hotspot/server');
const { hashPassword } = require('../hotspot/admin-auth');
const { decrypt, encrypt } = require('../hotspot/workspace-backup');

async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-backup-'));
    const env = { DATA_FILE: path.join(directory, 'manager.json'), ADMIN_ACCOUNT_FILE: path.join(directory, 'account.json'),
        TOWNS_FILE: path.join(directory, 'towns.json'), ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD_HASH: hashPassword('OwnerPassword123!') };
    fs.writeFileSync(env.TOWNS_FILE, JSON.stringify([{ id: 'default', name: 'Main' }, { id: 'second', name: 'Second', router: {
        MIKROTIK_HOST: '10.0.0.2', MIKROTIK_USERNAME: 'router', MIKROTIK_PASSWORD: 'router-private' } }]));
    const seed = { plans: [{ id: 'daily', name: 'Daily', price: 5 }], vouchers: [{ id: 'voucher', username: '123', password: '456', amount: 5, createdAt: Date.now(), dataConsumedBytes: 12345, radiusRevoked: true }],
        sales: [{ id: 'voucher', voucherId: 'voucher', amount: 5, createdAt: Date.now(), reportDeletedAt: Date.now() }],
        paymentAttempts: [{ reference: 'payment-123' }], deletedVoucherIds: ['old-voucher'], agentPayments: [{ id: 'receipt', amount: 2, createdAt: Date.now(), voidedAt: Date.now() }],
        reportActions: [{ id: 'report-action', kind: 'finance' }], dataUsage: { startedAt: Date.now(), days: [{ date: '2026-09-28', bytes: 100, reportDeletedBytes: 50 }] } };
    fs.writeFileSync(env.DATA_FILE, JSON.stringify(seed));
    let server;
    async function start() {
        server = createMultiTownApp({ env, createTownApp }).app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
    }
    async function request(route, token, body, method = body ? 'POST' : 'GET') {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/${route}`, { method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, data: await response.json() };
    }
    const login = async () => (await request('session', null, { email: env.ADMIN_EMAIL, password: 'OwnerPassword123!' })).data.token;
    const password = 'BackupPassword123!';
    try {
        await start();
        const token = await login();
        await request('staff', token, { name: 'Agent', email: 'agent@example.test', password: 'AgentPassword123!', role: 'agent' });
        const agent = (await request('session', null, { email: 'agent@example.test', password: 'AgentPassword123!' })).data.token;
        for (const route of ['backup/export', 'backup/preview', 'backup/restore']) assert.equal((await request(route, agent, {})).status, 403);
        assert.equal((await request('backup/safety', agent)).status, 403);
        assert.equal((await request('backup/export', null, { password })).status, 401);
        const exported = await request('backup/export', token, { password });
        assert.equal(exported.status, 200);
        const backup = exported.data.backup;
        assert.doesNotMatch(JSON.stringify(backup), /owner@example|passwordHash|router-private/);
        const original = await decrypt(backup, password);
        assert.equal(original.towns.length, 2);
        assert.equal(original.staff.length, 1);
        assert.equal(original.towns[0].data.vouchers[0].password, '456');
        assert.equal((await request('backup/preview', token, { backup, password: 'WrongPassword123!' })).status, 400);
        assert.equal((await request('backup/preview', token, { backup: { ...backup, tag: '0'.repeat(32) }, password })).status, 400);
        const mismatched = await encrypt({ ...original, towns: [] }, password);
        assert.equal((await request('backup/preview', token, { backup: mismatched, password })).status, 400);
        const preview = await request('backup/preview', token, { backup, password });
        assert.equal(preview.status, 200);
        assert.equal(preview.data.towns[0].sales, 1);
        assert.doesNotMatch(JSON.stringify(preview.data), /passwordHash|456|BackupPassword/);
        const changed = JSON.parse(fs.readFileSync(env.DATA_FILE, 'utf8'));
        changed.sales[0].amount = 99;
        fs.writeFileSync(env.DATA_FILE, JSON.stringify(changed));
        const confirm = { previewId: preview.data.previewId, confirmation: 'RESTORE', currentPassword: 'WrongPassword123!' };
        assert.equal((await request('backup/restore', token, confirm)).status, 400);
        assert.equal(JSON.parse(fs.readFileSync(env.DATA_FILE)).sales[0].amount, 99);
        const restored = await request('backup/restore', token, { ...confirm, currentPassword: 'OwnerPassword123!' });
        assert.equal(restored.status, 200);
        assert.equal(restored.data.restarting, false);
        const safetyPath = path.join(directory, 'backups', restored.data.safetyBackup);
        const safety = await decrypt(JSON.parse(fs.readFileSync(safetyPath)), password);
        assert.equal(safety.towns[0].data.sales[0].amount, 99);
        assert.equal(JSON.parse(fs.readFileSync(env.DATA_FILE)).sales[0].amount, 99); // only applied on startup
        assert.equal((await request('staff', token)).status, 503);
        await new Promise((resolve) => server.close(resolve));
        await start();
        assert.deepEqual(JSON.parse(fs.readFileSync(env.DATA_FILE)), original.towns[0].data);
        assert.equal(fs.existsSync(path.join(directory, 'backups', 'pending-restore.json')), false);
        assert.equal((await request('staff', token)).status, 401);
        const freshToken = await login();
        assert.equal((await request('staff', freshToken)).data.staff.length, 1);
        assert.equal((await request('backup/safety', freshToken)).data.backups.length, 1);
        assert.equal((await request('backup/safety/' + restored.data.safetyBackup, freshToken)).data.backup.format, 'ea-soft-backup');
        assert.equal((await request('backup/safety/not-a-backup.json', freshToken)).status, 400);
        const reexport = await request('backup/export', freshToken, { password });
        assert.equal(reexport.status, 200);
        console.log('Workspace backup checks passed: encryption, all towns/staff, permissions, validation, preview, safety copy, maintenance, restore/restart and session revocation.');
    } finally {
        if (server?.listening) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
