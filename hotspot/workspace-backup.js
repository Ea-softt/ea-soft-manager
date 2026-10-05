const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const validPassword = (value) => typeof value === 'string' && value.length >= 12 && value.length <= 256;
const locations = (env) => {
    const data = env.DATA_FILE || path.join(__dirname, 'data', 'manager.json');
    return { data, account: env.ADMIN_ACCOUNT_FILE || path.join(__dirname, 'data', 'admin-account.json'),
        directory: path.join(path.dirname(data), 'backups'), pending: path.join(path.dirname(data), 'backups', 'pending-restore.json') };
};
function privateWrite(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
}
async function encrypt(snapshot, password) {
    if (!validPassword(password)) throw new Error('Use a backup password of 12–256 characters.');
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const key = await scrypt(password, salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.from(JSON.stringify(snapshot));
    if (data.length > 20 * 1024 * 1024) throw new Error('This workspace exceeds the 20 MB backup limit. Contact the administrator for a server backup.');
    const payload = Buffer.concat([cipher.update(data), cipher.final()]);
    return { format: 'ea-soft-backup', version: 1, salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), payload: payload.toString('base64') };
}
async function decrypt(envelope, password) {
    if (!validPassword(password) || envelope?.format !== 'ea-soft-backup' || envelope.version !== 1 ||
        !/^[a-f0-9]{32}$/.test(envelope.salt || '') || !/^[a-f0-9]{24}$/.test(envelope.iv || '') || !/^[a-f0-9]{32}$/.test(envelope.tag || '') ||
        typeof envelope.payload !== 'string' || envelope.payload.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload)) throw new Error('Choose a valid encrypted EA-Soft backup and enter its password.');
    try {
        const key = await scrypt(password, Buffer.from(envelope.salt, 'hex'), 32);
        const cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
        cipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
        return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.payload, 'base64')), cipher.final()]).toString('utf8'));
    } catch { throw new Error('The backup password is incorrect or the file is damaged.'); }
}
function validate(snapshot, towns, env) {
    const fail = () => { throw new Error('Invalid or incompatible workspace backup.'); };
    const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const id = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256;
    const list = (v) => Array.isArray(v) && v.length <= 100000;
    const unique = (items, field) => items.every((item) => obj(item) && id(item[field])) && new Set(items.map((item) => item[field])).size === items.length;
    const account = (v) => obj(v) && typeof v.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(v.passwordHash || '');
    if (!obj(snapshot) || snapshot.schema !== 1 || !Number.isFinite(snapshot.createdAt) || !account(snapshot.owner) || !list(snapshot.staff) || !unique(snapshot.staff, 'id') ||
        !snapshot.staff.every((user) => user.id !== 'owner' && account(user) && ['agent', 'manager'].includes(user.role) && typeof user.name === 'string') ||
        new Set([snapshot.owner.email.toLowerCase(), ...snapshot.staff.map((s) => s.email.toLowerCase())]).size !== snapshot.staff.length + 1 ||
        !list(snapshot.towns) || !unique(snapshot.towns, 'id')) fail();
    if (snapshot.towns.length !== towns.length || !snapshot.towns.every((town) => towns.some((current) => current.id === town.id))) throw new Error('The backup must contain the same town IDs as this server. Configure the matching towns before restoring.');
    const usernames = new Set();
    for (const town of snapshot.towns) {
        const data = town.data;
        if (data?.operations !== undefined && (!obj(data.operations) ||
            !['expenses', 'audit', 'requests'].every(k => list(data.operations[k]) && unique(data.operations[k], 'id')))) fail();
        for (const expense of data?.operations?.expenses || []) if (!Number.isSafeInteger(expense.cents) || expense.cents <= 0 || !Number.isFinite(expense.createdAt)) fail();
        if (!obj(data) || !['plans', 'vouchers', 'sales', 'paymentAttempts', 'deletedVoucherIds', 'agentPayments', 'reportActions'].every((key) => list(data[key])) ||
            !['plans', 'vouchers', 'sales', 'agentPayments', 'reportActions'].every((key) => unique(data[key], 'id')) ||
            !data.deletedVoucherIds.every(id) || !obj(data.dataUsage) || !Number.isFinite(data.dataUsage.startedAt) || !list(data.dataUsage.days)) fail();
        for (const plan of data.plans) if (typeof plan.name !== 'string' || !Number.isFinite(Number(plan.price)) || Number(plan.price) < 0) fail();
        for (const voucher of data.vouchers) {
            if (!id(voucher.username) || typeof voucher.password !== 'string' || !Number.isFinite(Number(voucher.amount))) fail();
            if (env.VOUCHER_AUTH_MODE === 'radius' && usernames.has(voucher.username)) throw new Error('Backup contains duplicate shared voucher usernames.');
            usernames.add(voucher.username);
        }
        for (const sale of [...data.sales, ...data.agentPayments]) if (!Number.isFinite(Number(sale.amount)) || Number(sale.amount) < 0 || !Number.isFinite(sale.createdAt)) fail();
        for (const attempt of data.paymentAttempts) if (!obj(attempt) || !id(attempt.reference)) fail();
        for (const day of data.dataUsage.days) if (!obj(day) || !/^\d{4}-\d{2}-\d{2}$/.test(day.date || '') || !Number.isSafeInteger(day.bytes) || day.bytes < 0 || (day.reportDeletedBytes !== undefined && (!Number.isSafeInteger(day.reportDeletedBytes) || day.reportDeletedBytes < 0 || day.reportDeletedBytes > day.bytes))) fail();
    }
}
// Applied before accounts, town instances or background jobs are loaded. If interrupted,
// the pending file remains and the next startup reapplies the entire snapshot.
function applyPendingRestore(env, towns) {
    const files = locations(env);
    if (!fs.existsSync(files.pending)) return;
    const pending = JSON.parse(fs.readFileSync(files.pending, 'utf8'));
    validate(pending.snapshot, towns, env);
    const writes = [[files.account, pending.snapshot.owner], [files.account + '.staff.json', pending.snapshot.staff],
        ...pending.snapshot.towns.map((town) => [towns.find((current) => current.id === town.id).env.DATA_FILE, town.data])];
    for (const [file, data] of writes) privateWrite(file, data);
    fs.unlinkSync(files.pending);
}
function installWorkspaceBackup(app, { env, towns, instances, requireAdmin, requestRestart, stopJobs }) {
    const files = locations(env);
    const previews = new Map();
    let busy = false, restoring = false;
    let scheduleTimer;
    const scheduleFile = path.join(files.directory, 'schedule-settings.json');
    const readSchedule = () => fs.existsSync(scheduleFile) ? JSON.parse(fs.readFileSync(scheduleFile, 'utf8')) : { enabled: false, hours: 24, retention: 7 };
    const publicSchedule = config => ({ enabled: !!config.enabled, hours: config.hours, retention: config.retention,
        lastSuccessAt: config.lastSuccessAt || null, nextAt: config.nextAt || null, error: config.error || '' });
    async function scheduledBackup() {
        const config = readSchedule();
        if (!config.enabled || busy || restoring || (config.nextAt || 0) > Date.now()) return;
        busy = true;
        try {
            const current = snapshot(); validate(current, towns, env);
            const encrypted = await encrypt(current, config.password);
            const name = `scheduled-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
            privateWrite(path.join(files.directory, name), encrypted);
            const old = fs.readdirSync(files.directory).filter(n => /^scheduled-\d+-[a-f0-9]{8}\.json$/.test(n)).sort().reverse().slice(config.retention);
            for (const name of old) fs.unlinkSync(path.join(files.directory, name));
            config.lastSuccessAt = Date.now(); config.nextAt = Date.now() + config.hours * 3600000; config.error = '';
        } catch (e) { config.error = 'Scheduled backup failed: ' + (e.code || e.message); config.nextAt = Date.now() + 3600000; }
        finally { try { privateWrite(scheduleFile, config); } finally { busy = false; } }
    }
    function snapshot() {
        return { schema: 1, createdAt: Date.now(), owner: JSON.parse(fs.readFileSync(files.account, 'utf8')),
            staff: fs.existsSync(files.account + '.staff.json') ? JSON.parse(fs.readFileSync(files.account + '.staff.json', 'utf8')) : [],
            towns: towns.map((town) => {
                const data = instances.get(town.id).readManagerData();
                return { id: town.id, name: town.name, data: { ...data, agentPayments: data.agentPayments || [], reportActions: data.reportActions || [] } };
            }) };
    }
    app.use((req, res, next) => {
        if (restoring) return res.status(503).json({ message: 'Backup restoration is waiting for the backend to restart. Please try again shortly.' });
        next();
    });
    function exclusive(handler) {
        return async (req, res) => {
            if (busy) return res.status(409).json({ message: 'Another backup operation is running. Please wait.' });
            busy = true;
            res.set('Cache-Control', 'no-store');
            try { await handler(req, res); }
            catch (error) { res.status(400).json({ message: error.code ? 'Could not read or write backup files. Check server storage and permissions.' : error.message }); }
            finally { busy = false; }
        };
    }
    app.get('/api/admin/backup/schedule', requireAdmin, (_req,res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json({ success: true, schedule: publicSchedule(readSchedule()) }); }
        catch { res.status(500).json({ message: 'Could not read backup schedule.' }); }
    });
    app.post('/api/admin/backup/schedule', requireAdmin, exclusive(async (req,res) => {
        const { enabled, hours, retention, password } = req.body || {};
        if (typeof enabled !== 'boolean' || !Number.isInteger(hours) || hours < 1 || hours > 168 || !Number.isInteger(retention) || retention < 1 || retention > 90) throw new Error('Choose 1–168 hours and 1–90 retained backups.');
        const config = readSchedule();
        if (enabled && !validPassword(password || config.password)) throw new Error('Supply a backup password of 12–256 characters.');
        Object.assign(config, { enabled, hours, retention, nextAt: Date.now(), error: '' });
        if (password) config.password = password;
        privateWrite(scheduleFile, config);
        res.json({ success: true, schedule: publicSchedule(config) });
    }));
    app.post('/api/admin/backup/export', requireAdmin, exclusive(async (req, res) => {
        const current = snapshot();
        validate(current, towns, env);
        res.json({ success: true, backup: await encrypt(current, req.body?.password) });
    }));
    app.get('/api/admin/backup/safety', requireAdmin, (_req, res) => {
        res.set('Cache-Control', 'no-store');
        const backups = fs.existsSync(files.directory) ? fs.readdirSync(files.directory)
            .filter((name) => /^(?:before-restore|scheduled)-\d+-[a-f0-9]{8}\.json$/.test(name)).sort().reverse()
            .map((name) => ({ name, createdAt: Number(name.match(/-(\d+)-/)[1]) })) : [];
        res.json({ success: true, backups });
    });
    app.get('/api/admin/backup/safety/:name', requireAdmin, (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!/^(?:before-restore|scheduled)-\d+-[a-f0-9]{8}\.json$/.test(req.params.name)) return res.status(400).json({ message: 'Invalid safety backup name.' });
        const file = path.join(files.directory, req.params.name);
        if (!fs.existsSync(file)) return res.status(404).json({ message: 'Safety backup not found.' });
        res.json({ success: true, backup: JSON.parse(fs.readFileSync(file, 'utf8')) });
    });
    app.post('/api/admin/backup/preview', requireAdmin, exclusive(async (req, res) => {
        for (const [key, preview] of previews) if (preview.expires <= Date.now() || preview.session === req.sessionKey) previews.delete(key);
        if (previews.size >= 3) throw new Error('Too many pending restore previews. Try again in ten minutes.');
        const data = await decrypt(req.body?.backup, req.body?.password);
        validate(data, towns, env);
        const previewId = crypto.randomBytes(32).toString('hex');
        previews.set(previewId, { snapshot: data, password: req.body.password, session: req.sessionKey, expires: Date.now() + 10 * 60000 });
        setTimeout(() => previews.delete(previewId), 10 * 60000).unref();
        res.json({ success: true, previewId, createdAt: data.createdAt, ownerEmail: data.owner.email, staff: data.staff.length,
            towns: data.towns.map((town) => ({ id: town.id, name: town.name, plans: town.data.plans.length, vouchers: town.data.vouchers.length,
                sales: town.data.sales.length, payments: town.data.agentPayments.length, usageDays: town.data.dataUsage.days.length })) });
    }));
    app.post('/api/admin/backup/restore', requireAdmin, exclusive(async (req, res) => {
        const preview = previews.get(req.body?.previewId);
        if (!preview || preview.expires <= Date.now() || preview.session !== req.sessionKey) throw new Error('Restore preview expired. Select and preview the file again.');
        if (req.body?.confirmation !== 'RESTORE' || !requireAdmin.verifyPassword?.(req.staff.id, req.body?.currentPassword)) throw new Error('Enter RESTORE and your current manager password to replace the records.');
        validate(preview.snapshot, towns, env);
        const safety = await encrypt(snapshot(), preview.password);
        const safetyName = `before-restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
        privateWrite(path.join(files.directory, safetyName), safety);
        privateWrite(files.pending, { snapshot: preview.snapshot });
        restoring = true;
        stopJobs();
        previews.clear();
        if (requestRestart) res.once('finish', requestRestart);
        res.json({ success: true, restarting: Boolean(requestRestart), safetyBackup: safetyName, message: requestRestart ? 'Restore scheduled. The backend will restart; sign in using an account from the backup.' : 'Restore staged. Restart the backend to apply it, then sign in using an account from the backup.' });
    }));
    return { get restoring() { return restoring; }, scheduledBackup,
        startJobs() { if (!scheduleTimer) { scheduleTimer = setInterval(() => scheduledBackup().catch(e => console.error('Scheduled backup:', e.message)), 60000); scheduleTimer.unref(); } },
        stopJobs() { clearInterval(scheduleTimer); scheduleTimer = null; } };
}
module.exports = { installWorkspaceBackup, applyPendingRestore, encrypt, decrypt, validate };
