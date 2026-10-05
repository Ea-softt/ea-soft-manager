const crypto = require('node:crypto');

// FreeRADIUS verifies PAP/CHAP. Only its successful post-auth hook starts time.
// Run one backend process: synchronous ledger updates serialize grants/accounting.
function createSharedVouchers({ instances, now = Date.now }) {
    const reservations = new Set();
    function records() {
        return [...instances].map(([townId, instance]) => ({ townId, instance, data: instance.readManagerData() }));
    }
    function find(username) {
        const found = records().flatMap(({ townId, instance, data }) => data.vouchers
            .filter((voucher) => voucher.username === username).map((voucher) => ({ townId, instance, data, voucher })));
        if (found.length !== 1) throw new Error('Voucher unavailable or username is duplicated across towns.');
        return found[0];
    }
    function allUsernames() {
        return records().flatMap(({ data }) => [...data.vouchers.map((v) => v.username), ...data.paymentAttempts.map((p) => p.username)]).filter(Boolean);
    }
    function assertUnique() {
        const seen = new Set();
        for (const { data } of records()) for (const voucher of data.vouchers) {
            if (seen.has(voucher.username)) throw new Error(`Resolve duplicate voucher username ${voucher.username} before enabling shared RADIUS.`);
            seen.add(voucher.username);
        }
    }
    function assertAvailable(username, reference) {
        for (const { data } of records()) {
            if (data.vouchers.some((v) => v.username === username && (!reference || v.paymentReference !== reference)) ||
                data.paymentAttempts.some((p) => p.username === username && (!reference || p.reference !== reference))) {
                throw new Error('That voucher username is already used in another purchase.');
            }
        }
    }
    function valid(found) {
        const { voucher } = found;
        if (voucher.suspended || voucher.radiusRevoked || voucher.status === 'expired' || voucher.provisioning === 'pending' ||
            (voucher.expiresAt != null && (!Number.isFinite(voucher.expiresAt) || voucher.expiresAt <= now()))) throw new Error('Voucher expired or unavailable.');
        const duration = Number(voucher.durationMs);
        if (!Number.isSafeInteger(duration) || duration <= 0) throw new Error('Voucher duration is unavailable; correct it before enabling roaming.');
        const quota = Math.floor(Number(voucher.dataLimit) * 1024 ** 3);
        if (!Number.isSafeInteger(quota) || quota <= 0) throw new Error('Voucher data allowance is unavailable.');
        return quota;
    }
    function attr(value) { return { value: [value], op: ':=', do_xlat: false }; }
    function authorize(username) {
        const found = find(username);
        const quota = valid(found);
        if ((found.voucher.dataConsumedBytes || 0) >= quota) throw new Error('Voucher data allowance has been used.');
        return { 'control:Cleartext-Password': attr(found.voucher.password) };
    }
    function grant({ username, townId, sessionId }) {
        if (!instances.has(townId) || typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('Unknown town or missing session ID.');
        const found = find(username);
        const quota = valid(found);
        const voucher = found.voucher;
        const sessions = { ...(voucher.radiusSessions || {}) };
        const key = crypto.createHash('sha256').update(JSON.stringify([townId, sessionId])).digest('hex');
        let session = sessions[key];
        const sharedUsers = Math.max(1, Math.floor(Number(voucher.sharedUsers || found.data.plans.find((p) => p.id === voucher.planId)?.sharedUsers) || 1));
        if (session?.stopped) throw new Error('Session has ended. Start a new login.');
        if (session?.started || session?.bytes > 0) throw new Error('This session is already in use.');
        if (!session) {
            const active = Object.values(sessions).filter((s) => !s.stopped);
            if (active.length >= sharedUsers) throw new Error('This voucher is already connected. Log out in the other town first.');
            // Reserve bytes before returning Access-Accept. Concurrent routers
            // cannot each receive the entire remaining allowance.
            const held = active.reduce((sum, s) => sum + Math.max(0, s.limit - s.bytes), 0);
            const available = quota - (Number(voucher.dataConsumedBytes) || 0) - held;
            const limit = Math.floor(available / Math.max(1, sharedUsers - active.length));
            if (limit <= 0) throw new Error('Data allowance is exhausted or awaiting final accounting from another session.');
            session = sessions[key] = { townId, sessionId, token: 'ea-' + crypto.randomBytes(24).toString('hex'), bytes: 0, limit, stopped: false };
        }
        const activatedAt = voucher.activatedAt || now();
        const expiresAt = voucher.expiresAt || activatedAt + voucher.durationMs;
        const seconds = Math.floor((expiresAt - now()) / 1000);
        if (seconds <= 0) throw new Error('Voucher expired.');
        found.instance.updateSharedVoucher(voucher.id, {
            activatedAt, expiresAt, activationSource: 'shared-radius', status: 'active', radiusSessions: sessions,
            lastTownId: townId, expirySchedulePending: false
        });
        const response = {
            'reply:Session-Timeout': attr(Math.min(seconds, 4294967295)),
            'reply:WISPr-Session-Terminate-Time': attr(new Date(expiresAt).toISOString().replace('.000Z', '+00:00').replace(/\.\d{3}Z$/, '+00:00')),
            'reply:Acct-Interim-Interval': attr(30), 'reply:Port-Limit': attr(sharedUsers),
            'reply:Class': attr(session.token),
            'reply:Mikrotik-Total-Limit': attr(session.limit % 4294967296),
            'reply:Mikrotik-Total-Limit-Gigawords': attr(Math.floor(session.limit / 4294967296))
        };
        const rate = voucher.rateLimit ?? found.data.plans.find((p) => p.id === voucher.planId)?.rateLimit;
        if (rate) response['reply:Mikrotik-Rate-Limit'] = attr(rate);
        return response;
    }
    function account({ username, townId, sessionId, token, status, bytes }) {
        if (!['Start', 'Interim-Update', 'Stop'].includes(status)) throw new Error('Unsupported accounting event.');
        const found = find(username);
        const voucher = found.voucher;
        const key = crypto.createHash('sha256').update(JSON.stringify([townId, sessionId])).digest('hex');
        const session = voucher.radiusSessions?.[key];
        if (!session || session.token !== token) throw new Error('Unknown accounting session.');
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid accounting counters.');
        const nextBytes = Math.max(session.bytes, bytes);
        const sessions = { ...voucher.radiusSessions, [key]: { ...session, bytes: nextBytes, started: true, stopped: session.stopped || status === 'Stop' } };
        found.instance.updateSharedVoucher(voucher.id, { radiusSessions: sessions,
            dataConsumedBytes: (Number(voucher.dataConsumedBytes) || 0) + nextBytes - session.bytes,
            dataUsageUpdatedAt: now(), lastTownId: townId });
    }
    function expireTown(townId) {
        const instance = instances.get(townId);
        for (const v of instance.readManagerData().vouchers) if (v.expiresAt && v.expiresAt <= now() && v.status !== 'expired') instance.updateSharedVoucher(v.id, { status: 'expired' });
    }
    async function revoke(username) {
        const found = find(username);
        found.instance.updateSharedVoucher(found.voucher.id, { radiusRevoked: true, status: 'expired' });
        const results = await Promise.allSettled([...instances.values()].map((instance) => instance.disconnectSharedVoucher(username)));
        if (results.some((result) => result.status === 'rejected')) throw new Error('Voucher is blocked for new logins, but some routers could not be reached to disconnect existing sessions. Retry deletion when connected.');
    }
    assertUnique();
    return { reservations, allUsernames, assertAvailable, authorize, grant, account, expireTown, revoke };
}

function installRadiusRest(app, shared, { secret, townIds }) {
    if (typeof secret !== 'string' || secret.length < 32) throw new Error('Set RADIUS_REST_SECRET to at least 32 random characters before enabling shared RADIUS.');
    const expected = crypto.createHash('sha256').update(`Bearer ${secret}`).digest();
    function guard(req, res, next) {
        res.set('Cache-Control', 'no-store');
        const actual = crypto.createHash('sha256').update(req.headers.authorization || '').digest();
        if (!crypto.timingSafeEqual(expected, actual)) return res.status(401).end();
        next();
    }
    function value(body, name) { return body?.[name]?.value?.[0]; }
    function context(req) {
        const username = value(req.body, 'User-Name');
        const townId = value(req.body, 'Tmp-String-0');
        if (typeof username !== 'string' || !username || username.length > 200 || !townIds.includes(townId)) throw new Error('Invalid RADIUS context.');
        return { username, townId, sessionId: value(req.body, 'Acct-Session-Id') };
    }
    function octets(body, name) {
        const raw = value(body, name);
        const number = raw === undefined ? 0 : Number(raw);
        if (!Number.isInteger(number) || number < 0 || number > 4294967295) throw new Error('Invalid byte counter.');
        return number;
    }
    app.post('/api/internal/radius/authorize', guard, (req, res) => {
        try { res.json(shared.authorize(context(req).username)); }
        catch { res.status(403).end(); }
    });
    app.post('/api/internal/radius/post-auth', guard, (req, res) => {
        try { res.json(shared.grant(context(req))); }
        catch { res.status(403).end(); }
    });
    app.post('/api/internal/radius/accounting', guard, (req, res) => {
        try {
            let token = value(req.body, 'Class');
            if (typeof token === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(token)) token = Buffer.from(token.slice(2), 'hex').toString('utf8');
            const bytes = octets(req.body, 'Acct-Input-Octets') + octets(req.body, 'Acct-Output-Octets') +
                (octets(req.body, 'Acct-Input-Gigawords') + octets(req.body, 'Acct-Output-Gigawords')) * 4294967296;
            shared.account({ ...context(req), token, bytes, status: value(req.body, 'Acct-Status-Type') });
            res.status(204).end();
        } catch { res.status(400).end(); }
    });
}
module.exports = { createSharedVouchers, installRadiusRest };
