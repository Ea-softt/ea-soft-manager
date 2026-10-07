const fs = require('node:fs');
const path = require('node:path');

const groups = ['Main', 'Substation 1', 'Substation 2', 'Substation 3', 'Other'];
const validIp = ip => typeof ip === 'string' && /^192\.168\.10\.(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(ip);
const replies = rows => rows.some(row => (row.time && !row.status) || Number(row.received) > 0);
const permissionError = error => /not enough permissions|permission denied|not permitted|not allowed/i.test(error?.message || '');
function routeInterface(row) {
    if (row.active !== true && row.active !== 'true') return null;
    const gateway = String(row['immediate-gw'] || row.gateway || '');
    if (gateway.includes('%')) return gateway.split('%').at(-1);
    const reachable = String(row['gateway-status'] || '').match(/reachable via (.+)$/);
    if (reachable) return reachable[1];
    return gateway && !/[,:]/.test(gateway) && !/^\d+\./.test(gateway) ? gateway : null;
}

function installNetworkMonitor(app, requireAdmin, { router, env = {}, now = Date.now }) {
    const file = env.NETWORK_INVENTORY_FILE || path.join(path.dirname(env.DATA_FILE || path.join(__dirname, 'data', 'manager.json')), path.basename(env.DATA_FILE || 'manager.json', '.json') + '-network.json');
    let devices = [];
    if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(saved) || saved.some(d => !validIp(d.ip))) throw new Error('Invalid network inventory file.');
        devices = saved.map(d => ({ ...d, status: 'unknown' }));
    }
    let scanning = false, startedAt = null, checkedAt = null, error = '', progress = 0;
    let health = { router: 'unknown', internet: 'unknown', activeUsers: null, downloadMbps: null, uploadMbps: null, wan: null };
    function reason(failure) {
        let message = String(failure?.message || 'Router command failed.').replace(/[\r\n]+/g, ' ');
        for (const [key, value] of Object.entries(env)) {
            if (/PASSWORD|SECRET|TOKEN|KEY/.test(key) && typeof value === 'string' && value) message = message.split(value).join('[redacted]');
        }
        return message.slice(0, 300) + (permissionError(failure) ? ' The router API user group needs the test policy for ping.' : '');
    }
    let internetPending = null;
    function checkInternet() {
        if (internetPending) return internetPending;
        health.internetChecking = true;
        internetPending = (async () => {
            const probes = await Promise.all(['1.1.1.1', '8.8.8.8'].map(async target => {
                try {
                    const rows = await router('/ping', [`=address=${target}`, '=count=2']);
                    if (!Array.isArray(rows)) throw new Error('Router returned an invalid ping response.');
                    return { target, status: replies(rows) ? 'online' : 'no-reply', error: '' };
                } catch (failure) {
                    return { target, status: 'unknown', error: reason(failure), permissionDenied: permissionError(failure) };
                }
            }));
            const reachable = probes.find(probe => probe.status === 'online');
            if (probes.some(probe => probe.status !== 'unknown')) health.router = 'online';
            health.internet = reachable ? 'online' : probes.every(probe => probe.status === 'no-reply') ? 'no-reply' : 'unknown';
            health.internetProbes = probes;
            health.internetCheckedAt = now();
            health.internetMessage = reachable ? `Internet reachable from MikroTik via ${reachable.target}.`
                : health.internet === 'no-reply' ? 'Neither 1.1.1.1 nor 8.8.8.8 replied to the MikroTik ping checks.'
                : probes.filter(probe => probe.error).map(probe => `${probe.target}: ${probe.error}`).join(' ');
        })().finally(() => { health.internetChecking = false; internetPending = null; });
        return internetPending;
    }
    function save() {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(devices, null, 2), { mode: 0o600 });
        fs.renameSync(file + '.tmp', file);
    }
    function snapshot() {
        return { subnet: '192.168.10.0/24', scanning, startedAt, checkedAt, progress, error, health,
            devices: [...devices].sort((a, b) => Number(a.ip.split('.').at(-1)) - Number(b.ip.split('.').at(-1))) };
    }
    async function scan() {
        scanning = true; startedAt = now(); progress = 0; error = '';
        const warnings = new Set();
        const warn = message => { warnings.add(message); error = [...warnings].join(' '); };
        let pingDenied = false;
        let internetCheckedThisScan = false;
        const read = async (command, args = []) => {
            try { return await router(command, args); }
            catch (failure) {
                warn(`${command}: ${reason(failure)}`);
                if (command === '/ping' && permissionError(failure)) pingDenied = true;
                return null;
            }
        };
        try {
            await router('/system/resource/print');
            health.router = 'online';
            const [arp, leases, neighbors, active] = await Promise.all([
                read('/ip/arp/print'), read('/ip/dhcp-server/lease/print'), read('/ip/neighbor/print'),
                read('/ip/hotspot/active/print'), checkInternet().then(() => { internetCheckedThisScan = true; })
            ]);
            health.activeUsers = active ? active.length : null;
            pingDenied = health.internetProbes.some(probe => probe.permissionDenied);
            if (health.internet !== 'online') warn(health.internetMessage);
            const records = new Map();
            for (const row of [...(arp || []), ...(leases || []), ...(neighbors || [])]) {
                for (const ip of String(row.address || '').split(',')) {
                    if (validIp(ip.trim())) records.set(ip.trim(), { ...records.get(ip.trim()), ...row });
                }
            }
            let wan = env.NETWORK_WAN_INTERFACE;
            if (!wan) {
                const members = await read('/interface/list/member/print', ['?list=WAN']);
                if (members?.length === 1) wan = members[0].interface;
                if (!wan) {
                    const routes = await read('/ip/route/print', ['?dst-address=0.0.0.0/0']);
                    const interfaces = [...new Set((routes || []).map(routeInterface).filter(Boolean))];
                    if (interfaces.length === 1) wan = interfaces[0];
                }
            }
            health.wan = wan || null; health.downloadMbps = null; health.uploadMbps = null;
            if (wan) {
                health.wan = wan;
                const traffic = await read('/interface/monitor-traffic', [`=interface=${wan}`, '=once=']);
                const rate = traffic?.[0];
                const mbps = key => rate && rate[key] !== undefined && Number.isFinite(Number(rate[key])) ? Number(rate[key]) / 1e6 : null;
                health.downloadMbps = mbps('rx-bits-per-second'); health.uploadMbps = mbps('tx-bits-per-second');
                if (health.downloadMbps === null || health.uploadMbps === null) warn(`No valid traffic sample from ${wan}. Check NETWORK_WAN_INTERFACE.`);
            } else warn('Set NETWORK_WAN_INTERFACE to your Internet interface to read download/upload rates.');
            health.checkedAt = now();
            if (pingDenied) {
                for (const [ip, record] of records) {
                    if (!devices.some(d => d.ip === ip)) devices.push({ ip, name: '', group: 'Other', firstSeenAt: now(), lastSeenAt: null,
                        mac: record['mac-address'] || '', detectedName: record.identity || record['host-name'] || '' });
                }
                devices.forEach(d => { d.status = 'unknown'; d.checkError = 'Ping permission denied. Enable the test policy for the router API user group.'; d.checkedAt = now(); });
                checkedAt = now(); save(); return;
            }
            let next = 1;
            async function worker() {
                while (next <= 254) {
                    if (now() - startedAt >= 120000) { warn('Scan stopped after two minutes. Unchecked devices retain their previous result and check time.'); break; }
                    const ip = `192.168.10.${next++}`;
                    let status, checkError = '';
                    try { status = replies(await router('/ping', [`=address=${ip}`, '=count=1'])) ? 'online' : 'no-reply'; }
                    catch (failure) { status = 'unknown'; checkError = reason(failure); warn(`Device ping: ${checkError}`); }
                    const record = records.get(ip);
                    let device = devices.find(d => d.ip === ip);
                    if (!device && (status === 'online' || record)) {
                        device = { ip, name: '', group: 'Other', firstSeenAt: now(), lastSeenAt: null };
                        devices.push(device);
                    }
                    if (device) {
                        device.status = status; device.checkedAt = now(); device.checkError = checkError;
                        if (status === 'online') device.lastSeenAt = now();
                        if (record) {
                            device.mac = record['mac-address'] || device.mac || '';
                            device.detectedName = record.identity || record['host-name'] || device.detectedName || '';
                        }
                    }
                    progress++;
                }
            }
            await Promise.all(Array.from({ length: 6 }, worker));
            checkedAt = now(); error = [...warnings].join(' '); save();
        } catch (failure) {
            const internet = internetCheckedThisScan ? {
                internet: health.internet, internetProbes: health.internetProbes, internetCheckedAt: health.internetCheckedAt,
                internetMessage: health.internetMessage, internetChecking: health.internetChecking
            } : { internet: 'unknown', internetMessage: `Could not check Internet through MikroTik: ${reason(failure)}` };
            health = { router: 'unknown', activeUsers: null, downloadMbps: null, uploadMbps: null, wan: null, ...internet };
            devices.forEach(d => { d.status = 'unknown'; d.checkError = 'Router check failed.'; });
            error = `Network check failed: ${reason(failure)} Previous devices are retained.`;
        } finally { scanning = false; }
    }
    const respond = res => { res.set('Cache-Control', 'no-store'); res.json({ success: true, ...snapshot() }); };
    app.get('/api/admin/network', requireAdmin, (_req, res) => respond(res));
    app.post('/api/admin/network/internet', requireAdmin, async (_req, res) => {
        await checkInternet();
        respond(res);
    });
    app.post('/api/admin/network/scan', requireAdmin, (_req, res) => {
        if (!scanning && (!startedAt || now() - Math.max(startedAt, checkedAt || 0) >= 60000)) void scan();
        respond(res);
    });
    app.put('/api/admin/network/device', requireAdmin, (req, res) => {
        const { ip, name, group } = req.body || {};
        if (!validIp(ip) || typeof name !== 'string' || !name.trim() || name.length > 80 || !groups.includes(group)) {
            return res.status(400).json({ message: 'Enter an IP from 192.168.10.1–254, a device name (up to 80 characters), and a station.' });
        }
        const before = JSON.stringify(devices);
        let device = devices.find(d => d.ip === ip);
        if (!device) { device = { ip, status: 'unknown', firstSeenAt: now(), lastSeenAt: null }; devices.push(device); }
        Object.assign(device, { name: name.trim(), group });
        try { save(); respond(res); }
        catch { devices = JSON.parse(before); res.status(500).json({ message: 'Could not save the device inventory.' }); }
    });
    return { scan, snapshot, checkInternet };
}

module.exports = { installNetworkMonitor, validIp, replies, routeInterface };
