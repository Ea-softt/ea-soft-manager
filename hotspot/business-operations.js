const crypto = require('node:crypto');
const { firstLoginEvidence } = require('./router-time');

function installBusinessOperations(app, deps) {
    const { requireAdmin, read, save, router, shared, duration, schedule, fulfill, sms } = deps;
    let running = false, checkedAt = null, lastSuccessAt = null, error = '', sessions = [], logs = [], clock = {}, resources = {};
    const loginLimits = new Map();
    const recoveryLimits = new Map();
    const book = data => data.operations ||= { expenses: [], audit: [], requests: [] };
    function audit(action, actor = 'system', detail = {}) {
        const data = read();
        book(data).audit.push({ id: crypto.randomUUID(), at: Date.now(), actor, action, ...detail });
        save(data);
    }
    // Capture successful existing administrative writes without recording bodies/secrets.
    app.use((req, res, next) => {
        if (/^\/api\/admin\//.test(req.path) && ['POST','PUT','DELETE'].includes(req.method)) {
            res.once('finish', () => {
                if (res.statusCode < 400 && req.staff && !/terminal|backup|operations/.test(req.path)) {
                    try { audit(`${req.method} ${req.path}`, req.staff.id); } catch (e) { console.error('Audit write failed:', e.message); }
                }
            });
        }
        next();
    });
    const safe = handler => async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { await handler(req, res); } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); else console.error('Customer request:', e.message); }
    };
    function status(v) {
        if (v.suspended) return 'suspended';
        if (v.status === 'expired' || (v.expiresAt && v.expiresAt <= Date.now())) return 'expired';
        if (v.provisioning === 'pending') return 'pending';
        return v.activatedAt ? 'active' : 'awaiting';
    }
    function summary(v) {
        return { id: v.id, username: v.username, phone: v.phone, planId: v.planId, status: status(v),
            createdAt: v.createdAt, activatedAt: v.activatedAt, expiresAt: v.expiresAt,
            activationSource: v.activationSource, expirySchedulePending: v.expirySchedulePending,
            dataConsumedBytes: v.dataConsumedBytes || 0, dataUsageUpdatedAt: v.dataUsageUpdatedAt || null,
            dataLimit: v.dataLimit, remainingBytes: Math.max(0, Number(v.dataLimit) * 1024 ** 3 - (v.dataConsumedBytes || 0)),
            paymentReference: v.paymentReference || null,
            connected: error || !checkedAt ? null : sessions.some(s => s.user === v.username) };
    }
    async function applyJob(job) {
        const data = read(), v = data.vouchers.find(v => v.id === job.voucherId);
        if (!v) throw new Error('Voucher no longer exists.');
        const found = await router('/ip/hotspot/user/print', [`?name=${v.username}`, '=.proplist=.id,name']);
        if (found.length !== 1) throw new Error('Router voucher missing or duplicated.');
        const args = [`=.id=${found[0]['.id']}`, `=disabled=${v.suspended || v.status === 'expired' || (v.expiresAt && v.expiresAt <= Date.now()) ? 'yes' : 'no'}`,
            `=limit-bytes-total=${Math.floor(v.dataLimit * 1024 ** 3)}`];
        if (job.action === 'replace-credentials') args.push(`=password=${v.password}`);
        await router('/ip/hotspot/user/set', args);
        if (v.suspended || job.action === 'replace-credentials') for (const session of await router('/ip/hotspot/active/print')) {
            if (session.user === v.username) await router('/ip/hotspot/active/remove', [`=.id=${session['.id']}`]);
        }
        if (job.action === 'replace-credentials') for (const cookie of await router('/ip/hotspot/cookie/print')) {
            if (cookie.user === v.username) await router('/ip/hotspot/cookie/remove', [`=.id=${cookie['.id']}`]);
        }
        if (v.expiresAt && v.expiresAt > Date.now()) await schedule(v.username, v.expiresAt);
        const latest = read(), stored = book(latest).requests.find(r => r.id === job.id);
        if (stored) {
            stored.state = 'done'; stored.completedAt = Date.now(); delete stored.error;
            const current = latest.vouchers.find(item => item.id === v.id);
            if (current && current.expiresAt === v.expiresAt && v.expiresAt > Date.now()) {
                current.expirySchedulePending = false; current.timezoneScheduleVersion = 1;
            }
            save(latest);
        }
    }
    async function refresh() {
        if (running) return;
        running = true;
        try {
            sessions = await router('/ip/hotspot/active/print', ['=.proplist=user,address,uptime,bytes-in,bytes-out']);
            [clock] = await router('/system/clock/print');
            [resources] = await router('/system/resource/print', ['=.proplist=uptime,cpu-load,free-memory,total-memory,version']);
            logs = (await router('/log/print', ['=.proplist=time,topics,message'])).filter(l => /hotspot/.test(l.topics || '') || /^hotspot user /.test(l.message || '')).slice(-2000);
            if (!shared) {
                const data = read(); let changed = false;
                for (const v of data.vouchers) {
                    if (v.activatedAt || v.status === 'expired') continue;
                    const first = firstLoginEvidence(v, logs, clock['time-zone-name']);
                    const validity = duration(v, data.plans);
                    if (!first || !validity) continue;
                    Object.assign(v, { activatedAt: first, expiresAt: first + validity, activationSource: 'router-login-log',
                        expirySchedulePending: true, operationsRevision: (v.operationsRevision || 0) + 1 });
                    book(data).audit.push({ id: crypto.randomUUID(), at: Date.now(), actor: 'system', action: 'Recovered first login from router log', voucherId: v.id });
                    changed = true;
                }
                if (changed) save(data);
            }
            lastSuccessAt = Date.now(); error = '';
        } catch (e) { error = e.message; }
        finally { checkedAt = Date.now(); running = false; }
        // Absolute router updates are safe to retry after interrupted requests.
        for (const job of book(read()).requests.filter(r => r.state === 'pending' && r.voucherId).slice(0, 10)) {
            try { await applyJob(job); }
            catch (e) { const data = read(); const current = book(data).requests.find(r => r.id === job.id); if (current) { current.error = e.message; save(data); } }
        }
    }
    app.get('/api/admin/operations', requireAdmin, safe(async (req, res) => {
        if (!checkedAt || Date.now() - checkedAt > 30000) await refresh();
        const data = read(), records = book(data), query = String(req.query.q || '').trim().toLowerCase();
        const alerts = [];
        if (error) alerts.push({ kind: 'router', message: 'Router checks failed: ' + error });
        for (const v of data.vouchers) {
            if (!v.activatedAt && Number(v.dataConsumedBytes) > 0) alerts.push({ kind: 'activation', username: v.username, message: 'Usage recorded without first-login time. Retained logs did not provide sufficient evidence.' });
            if (v.expirySchedulePending) alerts.push({ kind: 'expiry', username: v.username, message: 'Router expiry update is pending.' });
            if (v.provisioning === 'pending') alerts.push({ kind: 'payment', username: v.username, message: 'Paid voucher is awaiting provisioning.' });
        }
        const sales = data.sales.filter(s => !s.reportDeletedAt);
        const expenses = records.expenses.filter(e => !e.voidedAt);
        const revenue = sales.reduce((sum,s) => sum + Math.round(Number(s.amount || 0) * 100), 0) / 100;
        const costs = expenses.reduce((sum,e) => sum + e.cents, 0) / 100;
        res.json({ success: true, router: { checkedAt, lastSuccessAt, error, sessions: error ? null : sessions.length, resources, clock },
            alerts, customers: data.vouchers.filter(v => !query || `${v.username} ${v.phone || ''}`.toLowerCase().includes(query)).slice(0,100).map(v => ({ ...summary(v),
                sales: data.sales.filter(s => (s.voucherId || s.id) === v.id).map(s => ({ amount: s.amount, createdAt: s.createdAt, cleared: !!s.reportDeletedAt })),
                events: logs.filter(l => String(l.message).startsWith(v.username + ' (') || String(l.message).startsWith(`hotspot user ${v.username} added `)).slice(-10) })),
            payments: data.paymentAttempts.map(p => ({ reference: p.reference, username: p.username, amount: p.amount, nextCheckAt: p.nextCheckAt })),
            requests: records.requests.slice(-50).reverse(), audit: records.audit.slice(-100).reverse(),
            expenses: records.expenses.slice(-100).reverse(), profit: { revenue, expenses: costs, net: revenue - costs }, localActions: !shared });
    }));
    let mutating = false;
    app.post('/api/admin/operations', requireAdmin, safe(async (req,res) => {
        if (mutating) throw new Error('An operation is running. Wait and retry.');
        const { action, requestId, reason } = req.body || {};
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '') || typeof reason !== 'string' || !reason.trim() || reason.length > 300) throw new Error('Supply a request ID and a reason (up to 300 characters).');
        const digest = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
        const old = book(read()).requests.find(r => r.id === requestId);
        if (old) { if (old.digest !== digest) throw new Error('Request ID already used.'); return res.json({ success: true, operation: old }); }
        mutating = true;
        try {
            let data = read(), records = book(data);
            const job = { id: requestId, digest, action, reason: reason.trim(), actor: req.staff.id, createdAt: Date.now(), state: 'done' };
            if (action === 'expense') {
                const cents = Math.round(Number(req.body.amount) * 100);
                if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1000000000) throw new Error('Enter an expense between 0.01 and 10,000,000.');
                const category = String(req.body.category || 'Other').slice(0,80);
                records.expenses.push({ id: requestId, cents, category, note: job.reason, createdAt: job.createdAt, actor: job.actor });
            } else if (action === 'void-expense') {
                const expense = records.expenses.find(e => e.id === req.body.expenseId);
                if (!expense || expense.voidedAt) throw new Error('Expense is missing or already voided.');
                expense.voidedAt = Date.now(); expense.voidReason = job.reason;
            } else if (['suspend','resume','extend','add-data','replace-credentials'].includes(action)) {
                if (shared) throw new Error('These router lifecycle actions require local voucher mode. Shared RADIUS actions are not enabled.');
                const v = data.vouchers.find(v => v.id === req.body.voucherId);
                if (!v || v.provisioning === 'pending') throw new Error('Choose a provisioned voucher.');
                if (records.requests.some(r => r.voucherId === v.id && r.state === 'pending')) throw new Error('This voucher already has a pending router update.');
                if (action === 'suspend') v.suspended = true;
                if (action === 'replace-credentials') v.password = crypto.randomBytes(6).toString('hex');
                if (action === 'resume') { if (v.expiresAt && v.expiresAt <= Date.now()) throw new Error('Extend expired validity before resuming.'); v.suspended = false; }
                if (action === 'extend') {
                    const hours = Number(req.body.value);
                    if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) throw new Error('Enter additional hours between 0 and 8760.');
                    const extra = Math.round(hours * 3600000);
                    v.durationMs = duration(v, data.plans) + extra;
                    if (v.expiresAt) v.expiresAt = Math.max(v.expiresAt, Date.now()) + extra;
                    v.status = 'active'; v.expirySchedulePending = !!v.expiresAt;
                }
                if (action === 'add-data') {
                    const gb = Number(req.body.value);
                    if (!Number.isFinite(gb) || gb <= 0 || gb > 10000) throw new Error('Enter additional GB between 0 and 10000.');
                    v.dataLimit = Number(v.dataLimit) + gb;
                }
                v.operationsRevision = (v.operationsRevision || 0) + 1;
                job.voucherId = v.id; job.state = 'pending';
            } else if (action === 'reconcile') {
                if (!/^[a-zA-Z0-9._-]{1,200}$/.test(req.body.reference || '')) throw new Error('Enter a valid payment reference.');
                // Verification remains exclusively on the existing Paystack fulfillment path.
                await fulfill(req.body.reference);
                data = read(); records = book(data);
            } else if (action === 'resend') {
                const v = data.vouchers.find(v => v.id === req.body.voucherId);
                if (!v || !v.phone || v.provisioning === 'pending') throw new Error('A provisioned voucher with a saved phone number is required.');
                // Persist intent before external delivery; never automatically resend on timeout.
                job.state = 'delivery-unconfirmed'; records.requests.push(job); save(data);
                const result = await sms(v.phone, v.username, v.password, v.planId);
                if (result?.success === false) throw new Error(result.message || 'SMS delivery failed. Check provider before retrying.');
                data = read(); records = book(data); records.requests = records.requests.filter(r => r.id !== requestId); job.state = 'done';
            } else throw new Error('Unknown operation.');
            records.requests.push(job);
            records.audit.push({ id: crypto.randomUUID(), at: Date.now(), actor: req.staff.id, action, reason: job.reason, voucherId: job.voucherId });
            save(data);
            res.json({ success: true, operation: job });
        } finally { mutating = false; }
    }));
    app.post('/api/public/recover-customer', safe(async (req,res) => {
        const now = Date.now();
        for (const [key, value] of recoveryLimits) if (value < now) recoveryLimits.delete(key);
        const username = String(req.body?.username || '').slice(0,200);
        const phone = String(req.body?.phone || '').replace(/\D/g,'').replace(/^0/, '233');
        const keys = ['ip:' + req.ip, 'user:' + username];
        if (keys.some(k => recoveryLimits.has(k)) || recoveryLimits.size > 10000) return res.status(429).json({ message: 'Please wait an hour before requesting another recovery message.' });
        for (const key of keys) recoveryLimits.set(key, now + 3600000);
        const v = read().vouchers.find(v => v.username === username && v.provisioning !== 'pending' && v.phone && String(v.phone).replace(/\D/g,'').replace(/^0/, '233') === phone);
        res.json({ success: true, message: 'If those details match, credentials will be sent to the phone saved on your voucher.' });
        if (v) {
            try { const result = await sms(v.phone,v.username,v.password,v.planId); audit(result?.success === false ? 'Customer recovery SMS failed' : 'Customer recovery SMS requested', 'customer', { voucherId:v.id }); }
            catch { audit('Customer recovery SMS failed', 'customer', { voucherId:v.id }); }
        }
    }));
    app.post('/api/public/customer', safe(async (req,res) => {
        const now = Date.now();
        for (const [key, entry] of loginLimits) if (entry.until < now) loginLimits.delete(key);
        const key = req.ip;
        const limit = loginLimits.get(key) || { count: 0, until: now + 15 * 60000 };
        if (limit.count >= 10 || loginLimits.size > 10000) return res.status(429).json({ message: 'Too many attempts. Try again later.' });
        limit.count++; loginLimits.set(key, limit);
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string' || username.length > 200 || password.length > 200) throw new Error('Enter your voucher credentials.');
        const v = read().vouchers.find(v => v.username === username);
        const hash = value => crypto.createHash('sha256').update(value).digest();
        if (!v || !crypto.timingSafeEqual(hash(v.password || ''), hash(password))) return res.status(401).json({ message: 'Voucher credentials were not accepted.' });
        const { phone, paymentReference, id, ...customer } = summary(v);
        res.json({ success: true, customer });
    }));
    return { refresh };
}
module.exports = { installBusinessOperations };
