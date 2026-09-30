// One-off repair based on the customer's retained RouterOS login log.
// Run from the deployed backend directory. Preview is read-only.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ACTIVATED = Date.parse('2026-09-29T11:11:57-04:00');
const EXPIRES = ACTIVATED + 3 * 86400000;
const REFERENCE = 'EA-13ee81fb-6d5b-43e6-8b66-c61ecbc9c114';

function repairRecord(data) {
    const matches = (data.vouchers || []).filter(v => String(v.username) === '199');
    if (matches.length !== 1) throw new Error('Expected exactly one voucher 199.');
    const voucher = matches[0];
    if (voucher.paymentReference !== REFERENCE || voucher.durationMs !== 259200000 ||
        voucher.source !== 'online-payment' || voucher.provisioning !== 'ready') {
        throw new Error('Voucher does not match the verified purchase.');
    }
    if ((voucher.activatedAt != null && voucher.activatedAt !== ACTIVATED) ||
        (voucher.expiresAt != null && voucher.expiresAt !== EXPIRES) || voucher.status === 'expired' || voucher.radiusRevoked) {
        throw new Error('Voucher has changed; inspect it before repairing.');
    }
    Object.assign(voucher, { activatedAt: ACTIVATED, expiresAt: EXPIRES,
        activationSource: 'router-login-log', status: 'active', expirySchedulePending: false });
    return voucher;
}

async function main() {
    require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
    const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
    const matches = processes.filter(p => p.name === 'ea-soft-api');
    if (matches.length !== 1) throw new Error('Expected one PM2 ea-soft-api process.');
    const pm = matches[0].pm2_env;
    if (path.resolve(pm.pm_cwd) !== path.resolve(__dirname)) throw new Error('Run this beside the deployed backend in its PM2 working directory.');
    const env = { ...pm, ...process.env };
    if (env.VOUCHER_AUTH_MODE === 'radius') throw new Error('This repair is for local router vouchers, not RADIUS.');
    const file = path.resolve(__dirname, env.DATA_FILE || 'data/manager.json');
    const original = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(original);
    repairRecord(data);
    console.log(JSON.stringify({ username: '199', firstLoginUTC: new Date(ACTIVATED).toISOString(),
        expiryUTC: new Date(EXPIRES).toISOString(), routerExpiry: '2026-10-02 11:11:57 America/New_York' }, null, 2));
    if (!process.argv.includes('--apply')) {
        console.log('Preview only. Stop ea-soft-api before running with --apply.');
        return;
    }
    if (pm.status !== 'stopped') throw new Error('Stop ea-soft-api before applying to prevent concurrent record writes.');
    if (EXPIRES <= Date.now()) throw new Error('The voucher expiry has already passed. A different repair is needed.');
    const { RouterOSAPI } = require('routeros-client');
    const api = new RouterOSAPI({ host: env.MIKROTIK_HOST || '192.168.10.1',
        port: Number(env.MIKROTIK_PORT || 8728), user: env.MIKROTIK_USERNAME,
        password: env.MIKROTIK_PASSWORD, timeout: 10 });
    api.on('error', () => {});
    // Match the backend's compatibility handling for newer RouterOS empty replies.
    const openChannel = api.openChannel.bind(api);
    api.openChannel = () => {
        const channel = openChannel();
        const processPacket = channel.processPacket.bind(channel);
        channel.processPacket = packet => packet[0] === '!empty' ? undefined : processPacket(packet);
        return channel;
    };
    try {
        await api.connect();
        const [clock] = await api.write('/system/clock/print');
        if (clock['time-zone-name'] !== 'America/New_York') throw new Error('Router timezone changed. Repair stopped.');
        const users = await api.write('/ip/hotspot/user/print', ['?name=199', '=.proplist=name,disabled']);
        if (users.length !== 1 || users[0].disabled === 'true' || users[0].disabled === true) throw new Error('Router voucher is missing or disabled.');
        // Copy before any mutation. This backup contains private records: owner access only.
        const backup = file + '.before-199-' + Date.now() + '.json';
        fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
        console.log('Safety backup:', backup);
        // Print all schedulers to avoid old API-library handling of empty query replies.
        const schedules = await api.write('/system/scheduler/print');
        const existing = schedules.filter(s => s.name === 'EA-EXP-199');
        if (existing.length > 1) throw new Error('Multiple expiry schedules found.');
        const fields = ['=name=EA-EXP-199', '=interval=0s', '=start-date=oct/02/2026',
            '=start-time=11:11:57', '=disabled=no', '=policy=read,write,test',
            '=on-event=/ip hotspot active remove [find user="199"]; /ip hotspot user set [find name="199"] disabled=yes; /system scheduler remove [find name="EA-EXP-199"];'];
        if (existing.length) await api.write('/system/scheduler/set', [`=.id=${existing[0]['.id']}`, ...fields]);
        else await api.write('/system/scheduler/add', fields);
        const updated = (await api.write('/system/scheduler/print')).find(s => s.name === 'EA-EXP-199');
        if (!updated || updated['start-time'] !== '11:11:57' ||
            !['oct/02/2026', '2026-10-02'].includes(updated['start-date']) || String(updated.disabled) === 'true') {
            throw new Error('Could not verify the router expiry schedule.');
        }
        if (fs.readFileSync(file, 'utf8') !== original) throw new Error('Records changed during repair. No records overwritten.');
        const temp = file + '.repair-199-' + process.pid;
        fs.writeFileSync(temp, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
        const owner = fs.statSync(file);
        fs.chownSync(temp, owner.uid, owner.gid);
        fs.renameSync(temp, file);
        console.log('Voucher 199 repaired and router expiry verified. Restart ea-soft-api and refresh Manager.');
    } finally { await api.close().catch(() => {}); }
}

module.exports = { repairRecord, ACTIVATED, EXPIRES };
if (require.main === module) main().catch(error => { console.error('Repair stopped:', error.message); process.exitCode = 1; });
