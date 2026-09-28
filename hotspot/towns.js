const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const net = require('node:net');
const { installAdminAuth } = require('./admin-auth');

function readTownConfig(env) {
    const configFile = env.TOWNS_FILE || path.join(__dirname, 'data', 'towns.json');
    let config;
    try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
    catch (error) {
        if (error.code !== 'ENOENT' || env.TOWNS_FILE) throw error;
        config = [{ id: 'default', name: env.DEFAULT_TOWN_NAME || 'Main town' }];
    }
    return config;
}
function loadTowns(env, config = readTownConfig(env)) {
    const defaultFile = env.DATA_FILE || path.join(__dirname, 'data', 'manager.json');
    if (!Array.isArray(config) || !config.length || config.length > 100) throw new Error('Town configuration must contain 1–100 towns.');
    const ids = new Set();
    const hosts = new Set();
    const towns = config.map((town) => {
        if (!town || typeof town.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(town.id) || town.id === 'all' || ids.has(town.id)) throw new Error('Town IDs must be unique lowercase letters, numbers, and hyphens; all is reserved.');
        if (typeof town.name !== 'string' || !town.name.trim() || town.name.length > 80) throw new Error('Each town needs a name of 1–80 characters.');
        ids.add(town.id);
        const townEnv = { ...env };
        if (town.id !== 'default') {
            // Never inherit the first router's credentials for another town.
            for (const key of Object.keys(townEnv)) if (key.startsWith('MIKROTIK_')) delete townEnv[key];
            if (!town.router || !town.router.MIKROTIK_HOST || !town.router.MIKROTIK_USERNAME || !town.router.MIKROTIK_PASSWORD) throw new Error(`Configure router host, username, and password for town ${town.id}.`);
            for (const [key, value] of Object.entries(town.router)) {
                if (!/^MIKROTIK_(HOST|PORT|USERNAME|PASSWORD|REQUEST_TIMEOUT_MS|SSH_PORT|SSH_USERNAME|SSH_PASSWORD|SSH_HOST_SHA256)$/.test(key) || typeof value !== 'string') throw new Error(`Invalid router setting for town ${town.id}. Use string values.`);
                townEnv[key] = value;
            }
        } else if (town.router) throw new Error('The default town uses the existing .env router settings.');
        const host = `${(townEnv.MIKROTIK_HOST || '192.168.10.1').toLowerCase()}:${townEnv.MIKROTIK_PORT || '8728'}`;
        if (hosts.has(host)) throw new Error('Each town must use a different router address.');
        hosts.add(host);
        townEnv.DATA_FILE = town.id === 'default' ? defaultFile : path.join(path.dirname(defaultFile), 'towns', `${town.id}.json`);
        townEnv.TOWN_ID = town.id;
        return { id: town.id, name: town.name.trim(), env: townEnv };
    });
    if (!ids.has('default')) throw new Error('Keep the default town to preserve existing records and payments.');
    return towns;
}

function createMultiTownApp({ env = process.env, createTownApp, authInstaller = installAdminAuth } = {}) {
    let savedConfig = readTownConfig(env);
    const towns = loadTowns(env, savedConfig);
    const radiusTownIds = towns.map((town) => town.id);
    let jobsStarted = false;
    const app = express();
    app.use(cors({ origin: env.FRONTEND_ORIGIN || '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'x-paystack-signature', 'Authorization'] }));
    app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
    const requireAdmin = authInstaller(app, { env });
    if (env.VOUCHER_AUTH_MODE && !['local', 'radius'].includes(env.VOUCHER_AUTH_MODE)) throw new Error('VOUCHER_AUTH_MODE must be local or radius.');
    const shared = env.VOUCHER_AUTH_MODE === 'radius' ? { reservations: new Set() } : null;
    const instances = new Map(towns.map((town) => [town.id, createTownApp(town.env, requireAdmin, shared)]));
    if (shared) {
        const { createSharedVouchers, installRadiusRest } = require('./shared-vouchers');
        const service = createSharedVouchers({ instances });
        // Keep the reservation set captured by each town factory.
        const reservations = shared.reservations;
        Object.assign(shared, service, { reservations });
        installRadiusRest(app, shared, { secret: env.RADIUS_REST_SECRET, townIds: radiusTownIds });
    }
    function publicSettings(town) {
        return { id: town.id, name: town.name, host: town.env.MIKROTIK_HOST || '192.168.10.1',
            port: Number(town.env.MIKROTIK_PORT || 8728), username: town.env.MIKROTIK_USERNAME || '',
            sshConfigured: Boolean(town.env.MIKROTIK_SSH_HOST_SHA256) };
    }
    app.get('/api/admin/towns/settings', requireAdmin, (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, towns: towns.map(publicSettings) });
    });
    app.post('/api/admin/towns', requireAdmin, (req, res) => {
        res.set('Cache-Control', 'no-store');
        let newConfig, town, instance;
        try {
            const body = req.body || {};
            const name = typeof body.name === 'string' ? body.name.trim() : '';
            const host = typeof body.host === 'string' ? body.host.trim() : '';
            const username = typeof body.username === 'string' ? body.username.trim() : '';
            const password = body.password;
            if (!name || name.length > 80) throw new Error('Enter a town name of 1–80 characters.');
            if (!host || host.length > 253 || (!net.isIP(host) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host))) throw new Error('Enter the router IP address or hostname, without a URL or port.');
            if (!username || username.length > 128 || typeof password !== 'string' || !password || password.length > 256) throw new Error('Enter the router username and password.');
            const port = Number(body.port ?? 8728);
            const sshPort = Number(body.sshPort === '' ? 22 : (body.sshPort ?? 22));
            if (![port, sshPort].every((v) => Number.isInteger(v) && v > 0 && v <= 65535)) throw new Error('Ports must be whole numbers between 1 and 65535.');
            const fingerprint = typeof body.sshFingerprint === 'string' ? body.sshFingerprint.trim().toLowerCase() : '';
            if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('The SSH fingerprint must contain 64 hexadecimal characters.');
            const id = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'town') + '-' + crypto.randomBytes(4).toString('hex');
            const router = { MIKROTIK_HOST: host, MIKROTIK_PORT: String(port), MIKROTIK_USERNAME: username, MIKROTIK_PASSWORD: password,
                MIKROTIK_SSH_PORT: String(sshPort), ...(fingerprint ? { MIKROTIK_SSH_HOST_SHA256: fingerprint } : {}) };
            newConfig = [...savedConfig, { id, name, router }];
            town = loadTowns(env, newConfig).at(-1);
            if (fs.existsSync(town.env.DATA_FILE)) throw new Error('A record file already exists for this town ID. Please try again.');
        } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
        const configFile = env.TOWNS_FILE || path.join(__dirname, 'data', 'towns.json');
        const temporary = configFile + '.' + crypto.randomUUID() + '.tmp';
        try {
            if (JSON.stringify(readTownConfig(env)) !== JSON.stringify(savedConfig)) return res.status(409).json({ success: false, message: 'Town configuration changed on the server. Restart the backend before adding another town.' });
            instance = createTownApp(town.env, requireAdmin, shared);
            fs.mkdirSync(path.dirname(configFile), { recursive: true });
            fs.writeFileSync(temporary, JSON.stringify(newConfig, null, 2), { mode: 0o600, flag: 'wx' });
            fs.renameSync(temporary, configFile);
        } catch {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
            return res.status(500).json({ success: false, message: 'Could not save the town on the server. Check configuration directory permissions.' });
        }
        savedConfig = newConfig;
        towns.push(town);
        instances.set(town.id, instance);
        radiusTownIds.push(town.id);
        if (jobsStarted) instance.startJobs();
        res.status(201).json({ success: true, town: publicSettings(town) });
    });
    app.get('/api/agent/towns', requireAdmin.requireSession || requireAdmin, (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, towns: towns.map(({ id, name }) => ({ id, name })) });
    });
    app.get('/api/admin/towns', requireAdmin, (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, sharedVouchers: Boolean(shared), towns: towns.map(({ id, name }) => ({ id, name })) });
    });
    app.get('/api/admin/towns/overview', requireAdmin, (_req, res) => {
        const sales = [];
        const usageHistories = [];
        const summaries = towns.map(({ id, name }) => {
            try {
                const data = instances.get(id).readManagerData();
                usageHistories.push(data.dataUsage);
                sales.push(...data.sales.map((sale) => ({ ...sale, id: `${id}:${sale.id}`, townId: id })));
                return { id, name, available: true, vouchers: data.vouchers.length,
                    active: data.vouchers.filter((v) => v.status === 'active' && (v.expiresAt == null || v.expiresAt > Date.now())).length,
                    revenue: data.sales.reduce((sum, sale) => sum + (Number(sale.amount) || 0), 0) };
            } catch { return { id, name, available: false }; }
        });
        res.set('Cache-Control', 'no-store');
        const dataUsage = usageHistories.length === towns.length && usageHistories.every((history) => history && Array.isArray(history.days))
            ? { startedAt: Math.min(...usageHistories.map((history) => history.startedAt)), coverageStartedAt: Math.max(...usageHistories.map((history) => history.startedAt)), days: usageHistories.flatMap((history) => history.days) } : null;
        res.json({ success: true, towns: summaries, sales, dataUsage, complete: summaries.every((town) => town.available) });
    });
    app.use('/api/towns/:townId', (req, res, next) => {
        const instance = instances.get(req.params.townId);
        if (!instance) return res.status(404).json({ success: false, message: 'Unknown town.' });
        req.url = '/api' + req.url;
        instance.app(req, res, next);
    });
    // Select the destination from the webhook payload; the destination handler
    // verifies the original raw signature and independently verifies the payment.
    app.post('/api/paystack/webhook', (req, res, next) => {
        let metadata = req.body?.data?.metadata || {};
        try { if (typeof metadata === 'string') metadata = JSON.parse(metadata); }
        catch { return res.status(400).json({ success: false, message: 'Invalid payment metadata.' }); }
        const instance = instances.get(metadata.town_id || 'default');
        if (!instance) return res.status(400).json({ success: false, message: 'Unknown payment town.' });
        instance.app(req, res, next);
    });
    // Existing portals continue to operate on the original router.
    app.use(instances.get('default').app);
    return { app, get townCount() { return towns.length; },
        startJobs() { jobsStarted = true; for (const instance of instances.values()) instance.startJobs(); },
        stopJobs() { jobsStarted = false; for (const instance of instances.values()) instance.stopJobs(); } };
}

module.exports = { loadTowns, createMultiTownApp };
