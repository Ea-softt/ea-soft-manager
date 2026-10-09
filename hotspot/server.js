if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { RouterOSAPI: BaseRouterOSAPI } = require('routeros-client');

class RouterOSAPI extends BaseRouterOSAPI {
    constructor(options) {
        super(options);
        this.on('error', (error) => {
            console.error('MikroTik connection error:', error.message || error);
        });
    }

    openChannel() {
        const channel = super.openChannel();
        const processPacket = channel.processPacket.bind(channel);
        channel.processPacket = (packet) => {
            if (packet[0] === '!empty') return;
            return processPacket(packet);
        };
        return channel;
    }
}

function createTownApp(env = process.env, sharedRequireAdmin, sharedVouchers = null) {
const app = express();
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
        if (req.path === '/api/paystack/webhook') {
            req.rawBody = Buffer.from(buf);
        }
    }
}));

app.use(cors({
    origin: env.FRONTEND_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-paystack-signature', 'Authorization']
}));

const BACKEND_VERSION = 'business-operations-2026-09-30';
const DATA_FILE = env.DATA_FILE || path.join(__dirname, 'data', 'manager.json');

const defaultPlans = [
    { id: '3-hours', name: '3 Hours', period: 'hours', duration: 3, dataLimit: 5, price: 3.75, color: 'mint' },
    { id: 'daily', name: 'Daily', period: 'days', duration: 1, dataLimit: 11, price: 5, color: 'sun' },
    { id: '3-days', name: '3 Days', period: 'days', duration: 3, dataLimit: 17, price: 10, color: 'sky' },
    { id: '7-days', name: '7 Days', period: 'days', duration: 7, dataLimit: 33, price: 25, color: 'coral' },
    { id: '30-days', name: '30 Days', period: 'days', duration: 30, dataLimit: 90, price: 70, color: 'violet' }
];

// Sales outlive their vouchers. Only an explicit amount correction edits a sale.
function preserveSales(sales, vouchers) {
    const result = [...sales];
    const key = (item) => item.paymentReference ? `payment:${item.paymentReference}` : `voucher:${item.voucherId || item.id}`;
    const known = new Set(result.map(key));
    const voucherIds = new Set(result.map((item) => item.voucherId || item.id));
    for (const voucher of vouchers) {
        if (!voucher.id || known.has(key(voucher)) || voucherIds.has(voucher.id)) continue;
        result.push({
            id: voucher.id, voucherId: voucher.id, paymentReference: voucher.paymentReference || null,
            amount: Number(voucher.amount) || 0, createdAt: voucher.createdAt,
            planId: voucher.planId, source: voucher.source,
            agentId: voucher.agentId, agentName: voucher.agentName, agentRequestId: voucher.agentRequestId,
            username: voucher.username, phone: voucher.phone, planName: voucher.planName
        });
        known.add(key(voucher));
        voucherIds.add(voucher.id);
    }
    return result;
}
function readManagerData() {
    let data;
    try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return { plans: defaultPlans, vouchers: [], sales: [], paymentAttempts: [], deletedVoucherIds: [], dataUsage: { startedAt: Date.now(), days: [] } };
    }
    const vouchers = Array.isArray(data.vouchers) ? data.vouchers : [];
    const sales = preserveSales(Array.isArray(data.sales) ? data.sales : [], vouchers);
    const result = { plans: Array.isArray(data.plans) ? data.plans : defaultPlans, vouchers, sales, deletedVoucherIds: Array.isArray(data.deletedVoucherIds) ? data.deletedVoucherIds : [], paymentAttempts: Array.isArray(data.paymentAttempts) ? data.paymentAttempts : [] };
    result.dataUsage = data.dataUsage || { startedAt: Date.now(), days: [] };
    result.agentPayments = Array.isArray(data.agentPayments) ? data.agentPayments : [];
    result.reportActions = Array.isArray(data.reportActions) ? data.reportActions : [];
    result.operations = data.operations || { expenses: [], audit: [], requests: [] };
    // Persist migration before a delete or status update can change the voucher list.
    if (!data.dataUsage || !Array.isArray(data.sales) || sales.length !== data.sales.length) saveManagerData(result);
    return result;
}
function saveManagerData(data) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
}
function recordDataUsage(history, bytes, observedAt) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return;
    const date = new Date(observedAt).toISOString().slice(0, 10);
    let day = history.days.find((item) => item.date === date);
    if (!day) { day = { date, bytes: 0 }; history.days.push(day); }
    day.bytes += bytes;
}
function writeManagerData(data, correctedVoucher = null, deletedIds = [], updatePlans = false) {
    // Async router operations may hold old snapshots. Always retain the latest sales.
    const latest = readManagerData();
    data.dataUsage = latest.dataUsage;
    data.agentPayments = latest.agentPayments || [];
    data.reportActions = latest.reportActions || [];
    data.operations = latest.operations;
    if (!updatePlans) data.plans = latest.plans;
    const latestVouchers = new Map(latest.vouchers.map((item) => [item.id, item]));
    data.vouchers = data.vouchers.map((item) => {
        const current = latestVouchers.get(item.id);
        if (!current) return item;
        if (current.hasLoggedIn) item.hasLoggedIn = true;
        if (current.connectionDevices) item.connectionDevices = current.connectionDevices;
        if ((current.operationsRevision || 0) > (item.operationsRevision || 0)) {
            item = { ...item, operationsRevision: current.operationsRevision, suspended: current.suspended,
                activatedAt: current.activatedAt, activationSource: current.activationSource, expiresAt: current.expiresAt,
                durationMs: current.durationMs, dataLimit: current.dataLimit, password: current.password, status: current.status, expirySchedulePending: current.expirySchedulePending };
        }
        if (!current.radiusSessions && item.dataUsageUpdatedAt > (current.dataUsageUpdatedAt || 0)) {
            if (current.dataUsageUpdatedAt >= data.dataUsage.startedAt && Number.isSafeInteger(current.dataConsumedBytes)) {
                const delta = item.dataConsumedBytes >= current.dataConsumedBytes ? item.dataConsumedBytes - current.dataConsumedBytes : item.dataConsumedBytes;
                recordDataUsage(data.dataUsage, delta, item.dataUsageUpdatedAt);
            }
        } else if (!current.radiusSessions && current.dataUsageUpdatedAt) {
            item = { ...item, dataConsumedBytes: current.dataConsumedBytes, dataUsageUpdatedAt: current.dataUsageUpdatedAt };
        }
        if (current.radiusSessions) item = { ...item, radiusSessions: current.radiusSessions, dataConsumedBytes: current.dataConsumedBytes, dataUsageUpdatedAt: current.dataUsageUpdatedAt, lastTownId: current.lastTownId, radiusRevoked: current.radiusRevoked };
        if (current.radiusRevoked) item = { ...item, radiusRevoked: true, status: 'expired' };
        if (current.activatedAt && !item.activatedAt) item = { ...item, activatedAt: current.activatedAt, activationSource: current.activationSource };
        if (current.expiresAt && !item.expiresAt) item = { ...item, expiresAt: current.expiresAt, durationMs: current.durationMs, expirySchedulePending: current.expirySchedulePending };
        // Old router snapshots cannot undo a recovered purchase or completed activation.
        if (current.paymentReference && !item.paymentReference) return current;
        if (current.provisioning === 'ready' && item.provisioning === 'pending') {
            return { ...item, provisioning: 'ready', status: current.status };
        }
        return item;
    });
    data.deletedVoucherIds = [...new Set([...latest.deletedVoucherIds, ...deletedIds])];
    const ids = new Set(data.vouchers.map((item) => item.id));
    data.vouchers = [...data.vouchers, ...latest.vouchers.filter((item) => !ids.has(item.id))]
        .filter((item) => !data.deletedVoucherIds.includes(item.id));
    data.paymentAttempts = latest.paymentAttempts;
    data.sales = preserveSales(latest.sales, data.vouchers);
    if (correctedVoucher) {
        const sale = data.sales.find((item) => item.voucherId === correctedVoucher.id ||
            (correctedVoucher.paymentReference && item.paymentReference === correctedVoucher.paymentReference));
        if (sale) {
            sale.amount = correctedVoucher.amount;
            if (!sale.paymentReference && correctedVoucher.paymentReference) {
                sale.paymentReference = correctedVoucher.paymentReference;
                sale.createdAt = correctedVoucher.createdAt;
                sale.source = correctedVoucher.source;
            }
        }
    }
    saveManagerData(data);
}

const { installAdminAuth } = require('./admin-auth');
const requireAdminToken = sharedRequireAdmin || installAdminAuth(app, { env });
async function operationRouter(command, args = []) {
    const api = new RouterOSAPI(getMikroTikApiOptions());
    try { await api.connect(); return await api.write(command, args); }
    finally { await api.close().catch(() => {}); }
}
try {
    require('./network-monitor').installNetworkMonitor(app, requireAdminToken, { router: operationRouter, env });
} catch (error) {
    console.error('Network monitor unavailable:', error.message);
    app.use('/api/admin/network', requireAdminToken, (_req, res) => res.status(503).json({ message: 'Network monitor unavailable. Deploy network-monitor.js and check the inventory file on the server.' }));
}
const businessOperations = require('./business-operations').installBusinessOperations(app, {
    requireAdmin: requireAdminToken, read: readManagerData, save: saveManagerData,
    router: operationRouter, shared: sharedVouchers, duration: activationDuration,
    schedule: scheduleCalendarExpiration, fulfill: (...args) => fulfillPayment(...args), sms: sendVoucherSms
});
app.get('/api/public/customer-portal', (_req, res) => res.sendFile(path.join(__dirname, 'customer.html')));
try {
    require('./customer-details').installCustomerDetails(app, { requireAdmin: requireAdminToken, read: readManagerData, save: saveManagerData, router: operationRouter });
} catch (error) {
    console.error('Customer details unavailable:', error.message);
    app.get('/api/admin/vouchers/:id/details', requireAdminToken, (_req, res) => res.status(503).json({ message: 'Deploy customer-details.js and restart the backend to view connection details.' }));
}
app.post('/api/admin/report-history', requireAdminToken, (req, res) => {
    const { kind, action, from, to, requestId } = req.body || {};
    if (!['finance', 'usage'].includes(kind) || !['delete', 'restore'].includes(action) ||
        !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > 8640000000000000 ||
        typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId) ||
        (kind === 'usage' && (from % 86400000 || to % 86400000))) {
        return res.status(400).json({ message: 'Choose a valid report period and action. Usage periods must use complete UTC days.' });
    }
    const data = readManagerData();
    data.reportActions ||= [];
    const previous = data.reportActions.find((item) => item.id === requestId);
    if (previous) {
        if (previous.kind !== kind || previous.action !== action || previous.from !== from || previous.to !== to) return res.status(409).json({ message: 'This request ID was already used for a different action.' });
        return res.json({ success: true, affected: previous.affected });
    }
    const observedAt = Date.now();
    let affected = 0;
    if (kind === 'finance') {
        for (const sale of data.sales) {
            if (!(sale.createdAt >= from && sale.createdAt < to)) continue;
            if (action === 'delete' && !sale.reportDeletedAt) {
                sale.reportDeletedAt = observedAt;
                sale.reportDeletedBy = req.staff.id;
                affected++;
            } else if (action === 'restore' && sale.reportDeletedAt) {
                delete sale.reportDeletedAt;
                delete sale.reportDeletedBy;
                affected++;
            }
        }
    } else {
        for (const day of data.dataUsage.days) {
            const timestamp = Date.parse(`${day.date}T00:00:00Z`);
            if (!(timestamp >= from && timestamp < to)) continue;
            const next = action === 'delete' ? day.bytes : 0;
            if ((day.reportDeletedBytes || 0) !== next) { day.reportDeletedBytes = next; affected++; }
        }
    }
    data.reportActions.push({ id: requestId, kind, action, from, to, affected, createdAt: observedAt, managerId: req.staff.id });
    saveManagerData(data);
    res.json({ success: true, affected });
});
require('./agent-portal').installAgentPortal(app, {
    requireAdmin: requireAdminToken, readManagerData, saveManagerData, writeManagerData,
    generateVoucherUsername, generateVoucherPassword, profileNameForPlan, planDurationMs,
    createMikroTikUser, sendVoucherSms, sharedVouchers,
    getReservations: () => initializingVoucherUsernames
});
// An incomplete optional Terminal deployment must not take login or payments down.
try {
    require('./terminal').installTerminal(app, requireAdminToken, { env });
} catch (error) {
    console.error('MikroTik Terminal unavailable:', error.message);
    app.post('/api/admin/terminal', requireAdminToken, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.status(503).json({ success: false, message: 'Terminal is not installed completely. Upload terminal.js, package.json and package-lock.json, run npm ci in the backend folder, then restart the backend.' });
    });
}

function required(name) {
    if (!env[name]) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return env[name];
}

function getMikroTikApiOptions() {
    const host = env.MIKROTIK_HOST || '192.168.10.1';
    const port = Number(env.MIKROTIK_PORT || 8728);

    return {
        host,
        port,
        user: required('MIKROTIK_USERNAME'),
        password: required('MIKROTIK_PASSWORD'),
        timeout: Number(env.MIKROTIK_REQUEST_TIMEOUT_MS || 10000) / 1000
    };
}

const initializingVoucherUsernames = sharedVouchers?.reservations || new Set();

function generateVoucherUsername() {
    const data = readManagerData();
    const used = new Set([
        ...(sharedVouchers ? sharedVouchers.allUsernames() : []),
        ...data.vouchers.map((voucher) => String(voucher.username)),
        ...data.paymentAttempts.map((attempt) => String(attempt.username)),
        ...initializingVoucherUsernames
    ]);
    const available = Array.from({ length: 900 }, (_, index) => String(100 + index))
        .filter((username) => !used.has(username));
    if (!available.length) {
        throw new Error('All three-digit voucher codes (100–999) are in use. Please contact support.');
    }
    return available[crypto.randomInt(available.length)];
}

function generateVoucherPassword() {
    return String(crypto.randomInt(100, 1000));
}

async function paystackVerify(reference) {
    const secretKey = required('PAYSTACK_SECRET_KEY');

    const response = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
        throw new Error(data.message || 'Paystack verification failed.');
    }

    return data.data;
}

async function createMikroTikUser(username, password, profile, quotaBytes, requestId = null) {
    const api = new RouterOSAPI(getMikroTikApiOptions());
    let connected = false;
    const marker = requestId ? `EA-MANAGER-${requestId}` : null;

    const numericQuotaBytes = Number(quotaBytes);

    if (!Number.isFinite(numericQuotaBytes) || numericQuotaBytes <= 0) {
        throw new Error(`Invalid data quota for voucher: ${quotaBytes}`);
    }

    try {
        await api.connect();
        connected = true;

        const result = await api.write('/ip/hotspot/user/add', [
            `=name=${String(username).trim()}`,
            `=password=${String(password).trim()}`,
            `=profile=${String(profile).trim()}`,

            // IMPORTANT:
            // Do NOT use limit-uptime.
            // Calendar validity is controlled by the backend scheduler.

            `=limit-bytes-total=${String(numericQuotaBytes)}`,
            ...(marker ? [`=comment=${marker}`] : [])
        ]);

        console.log(
            `MikroTik voucher created: ${username} | ` +
            `profile=${profile} | ` +
            `limit-bytes-total=${numericQuotaBytes}`
        );

        return result;

    } catch (error) {
        const message = error.message || String(error);
        const timedOut = /time\s*out|timed\s*out|ETIMEDOUT|SOCKTMOUT/i.test(message + ' ' + (error.code || error.errno || ''));
        if (connected && marker && (timedOut || /already|exists/i.test(message))) {
            // The router may have committed the add before its reply was lost.
            // Verify a unique request marker on a fresh connection; never blindly add again.
            await api.close().catch(() => {});
            const check = new RouterOSAPI(getMikroTikApiOptions());
            try {
                await check.connect();
                const users = await check.write('/ip/hotspot/user/print', [`?name=${String(username).trim()}`]);
                const matches = users.filter(user => user.name === String(username).trim() && user.comment === marker &&
                    user.password === String(password).trim() && user.profile === String(profile).trim() &&
                    Number(user['limit-bytes-total']) === numericQuotaBytes);
                if (matches.length === 1) return matches;
            } catch { /* Retain an uncertain outcome rather than issuing another add. */ }
            finally { await check.close().catch(() => {}); }
        }
        if (timedOut) {
            throw new Error(connected
                ? `Router confirmation timed out for voucher ${String(username).trim()}. Creation could not be verified. Do not create a replacement until this username is checked on the router.`
                : 'Could not connect or authenticate to the MikroTik API before the timeout. No voucher-add command was sent. Check the selected town router connection, VPN and API access.');
        }

        if (/username or password is invalid/i.test(message)) {
            throw new Error(
                'MikroTik API login failed: MIKROTIK_USERNAME or MIKROTIK_PASSWORD in .env does not match the RouterOS user on VLAN 10.'
            );
        }

        throw new Error(
            `MikroTik API voucher creation failed: ${message}`
        );

    } finally {
        await api.close().catch(() => {});
    }
}






// async function createMikroTikUser(username, password, profile, quotaBytes) {
//     const api = new RouterOSAPI(getMikroTikApiOptions());

//     try {
//         await api.connect();

//         const result = await api.write('/ip/hotspot/user/add', [
//             `=name=${String(username)}`,
//             `=password=${String(password)}`,
//             `=profile=${String(profile)}`,
//             `=limit-bytes-total=${String(quotaBytes)}`
//         ]);

//         return result;
//     } catch (error) {
//         const message = error.message || String(error);

//         if (/username or password is invalid/i.test(message)) {
//             throw new Error('MikroTik API login failed: MIKROTIK_USERNAME or MIKROTIK_PASSWORD in .env does not match the RouterOS user on VLAN 10.');
//         }

//         throw new Error(`MikroTik API voucher creation failed: ${message}`);
//     } finally {
//         await api.close().catch(() => {});
//     }
// }

async function sendVoucherSms(phone, username, password, profile) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
        return { success: false, message: 'Invalid phone number for SMS.' };
    }

    const provider = (env.SMS_PROVIDER || 'generic').toLowerCase();
    const message = `EA-Soft Wi-Fi voucher: username=${username}, password=${password}, profile=${profile}. Keep this message for login.`;

    try {
        if (provider === 'twilio') {
            const accountSid = required('TWILIO_ACCOUNT_SID');
            const authToken = required('TWILIO_AUTH_TOKEN');
            const from = required('TWILIO_FROM');

            const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
            const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    To: normalizedPhone,
                    From: from,
                    Body: message
                }).toString()
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || 'Twilio SMS failed.');
            }

            return { success: true, provider, messageSid: data.sid || null };
        }

        if (provider === 'africastalking') {
            const apiKey = required('AFRICASTALKING_API_KEY');
            const username = required('AFRICASTALKING_USERNAME');
            const senderId = env.AFRICASTALKING_SENDER_ID || 'EA-Soft';

            const response = await fetch('https://api.africastalking.com/version1/messaging', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    apikey: apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Username': username
                },
                body: new URLSearchParams({
                    username,
                    to: normalizedPhone,
                    message,
                    from: senderId
                }).toString()
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || "Africa's Talking SMS failed.");
            }

            return { success: true, provider, response: data };
        }

        if (provider === 'bulksmsgh') {
            const smsUrl = env.SMS_API_URL || env.SMS_HTTP_URL;
            if (!smsUrl) {
                return { success: false, message: 'BulkSMS Ghana API URL is not configured.' };
            }

            const url = new URL(smsUrl);
            const bulkSmsRecipient = normalizedPhone.startsWith('+233')
                ? `0${normalizedPhone.substring(4)}`
                : normalizedPhone;

            url.searchParams.set('to', bulkSmsRecipient);
            url.searchParams.set('msg', message);
            url.searchParams.set('sender_id', env.SMS_SENDER_ID || 'EA-Soft');

            const response = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json, text/plain, */*' }
            });
            const rawResponse = await response.text();
            let data;

            try {
                data = JSON.parse(rawResponse);
            } catch {
                data = { message: rawResponse };
            }

            if (!response.ok || data.success === false || data.status === 'error') {
                throw new Error(data.message || rawResponse || 'BulkSMS Ghana request failed.');
            }

            return { success: true, provider, response: data };
        }

        const smsUrl = env.SMS_API_URL || env.SMS_HTTP_URL;
        if (!smsUrl) {
            return { success: false, message: 'No SMS provider configured.' };
        }

        const response = await fetch(smsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: normalizedPhone,
                message,
                username,
                password,
                profile,
                phone: normalizedPhone
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || 'Generic SMS gateway failed.');
        }

        return { success: true, provider, response: data };
    } catch (error) {
        console.error('SMS error:', error);
        return { success: false, message: error.message || 'SMS could not be sent.' };
    }
}

function chooseProfile(planName) {
    const profiles = {
        '3 Hours': env.PROFILE_3_HOURS || '3-HOURS',
        'Daily': env.PROFILE_DAILY || 'DAILY',
        '3 Days': env.PROFILE_3_DAYS || '3-DAYS',
        '7 Days': env.PROFILE_7_DAYS || '7-DAYS',
        '30 Days': env.PROFILE_30_DAYS || '30-DAYS'
    };

    if (profiles[planName]) return profiles[planName];
    const plan = readManagerData().plans.find((item) => item.name === planName);
    return plan ? `EA-${String(plan.id || plan.name).toUpperCase().replace(/[^A-Z0-9-]+/g, '-')}` : undefined;
}

function profileNameForPlan(plan) {
    const configuredProfile = chooseProfile(plan.name);
    if (configuredProfile) return configuredProfile;
    return `EA-${String(plan.id || plan.name).toUpperCase().replace(/[^A-Z0-9-]+/g, '-')}`;
}

// function sessionTimeoutForPlan(plan) {
//     const units = { hours: 'h', days: 'd', weeks: 'w', months: 'd' };
//     const unit = units[plan.period];
//     if (!unit || !Number.isFinite(Number(plan.duration))) return null;
//     const duration = Number(plan.duration) * (plan.period === 'months' ? 30 : 1);
//     return `${duration}${unit}`;
// }

function sessionTimeoutForPlan() {
    return '0s';
}


// async function ensureMikroTikProfile(plan) {
//     const profile = profileNameForPlan(plan);
//     const api = new RouterOSAPI(getMikroTikApiOptions());

//     try {
//         await api.connect();
//         const command = [`=name=${profile}`, `=shared-users=${Math.max(1, Number(plan.sharedUsers) || 1)}`];
//         const sessionTimeout = sessionTimeoutForPlan(plan);
//         if (sessionTimeout) command.push(`=session-timeout=${sessionTimeout}`);
//         if (String(plan.rateLimit || '').trim()) command.push(`=rate-limit=${String(plan.rateLimit).trim()}`);

//         try {
//             await api.write('/ip/hotspot/user/profile/add', command);
//         } catch (error) {
//             if (!/already have such entry|already exists|duplicate/i.test(error.message || String(error))) {
//                 throw error;
//             }
//         }
//         const updateCommand = [`=numbers=${profile}`, `=shared-users=${Math.max(1, Number(plan.sharedUsers) || 1)}`];
//         if (sessionTimeout) updateCommand.push(`=session-timeout=${sessionTimeout}`);
//         if (String(plan.rateLimit || '').trim()) updateCommand.push(`=rate-limit=${String(plan.rateLimit).trim()}`);
//         await api.write('/ip/hotspot/user/profile/set', updateCommand);
//         return profile;
//     } finally {
//         await api.close().catch(() => {});
//     }
// }

async function ensureMikroTikProfile(plan) {
    const profile = profileNameForPlan(plan);
    const api = new RouterOSAPI(getMikroTikApiOptions());

    try {
        await api.connect();

        const command = [
            `=name=${profile}`,
            `=shared-users=${Math.max(1, Number(plan.sharedUsers) || 1)}`,
            `=session-timeout=0s`
        ];

        if (String(plan.rateLimit || '').trim()) {
            command.push(`=rate-limit=${String(plan.rateLimit).trim()}`);
        }

        try {
            await api.write('/ip/hotspot/user/profile/add', command);
        } catch (error) {
            if (!/already have such entry|already exists|duplicate/i.test(error.message || String(error))) {
                throw error;
            }
        }

        const updateCommand = [
            `=numbers=${profile}`,
            `=shared-users=${Math.max(1, Number(plan.sharedUsers) || 1)}`,
            `=session-timeout=0s`
        ];

        if (String(plan.rateLimit || '').trim()) {
            updateCommand.push(`=rate-limit=${String(plan.rateLimit).trim()}`);
        }

        await api.write(
            '/ip/hotspot/user/profile/set',
            updateCommand
        );

        return profile;

    } finally {
        await api.close().catch(() => {});
    }
}


async function syncMikroTikProfiles(plans) {
    for (const plan of plans) {
        await ensureMikroTikProfile(plan);
    }
}

async function removeMikroTikProfile(profileName) {
    const api = new RouterOSAPI(getMikroTikApiOptions());

    try {
        await api.connect();
        await api.write('/ip/hotspot/user/profile/remove', [`=numbers=${profileName}`]);
    } catch (error) {
        if (!/no such item|not found/i.test(error.message || String(error))) {
            throw error;
        }
    } finally {
        await api.close().catch(() => {});
    }
}

async function removeMikroTikProfiles(profileNames) {
    for (const profileName of profileNames) {
        await removeMikroTikProfile(profileName);
    }
}

async function readMikroTikHotspotUsers() {
    const api = new RouterOSAPI(getMikroTikApiOptions());

    try {
        await api.connect();
        return await api.write('/ip/hotspot/user/print', [
            '=.proplist=.id,name,password,profile,disabled,comment,limit-bytes-total,uptime,bytes-in,bytes-out'
        ]);
    } catch (error) {
        if (error?.errno === 'UNKNOWNREPLY' && /!empty/.test(error.message || '')) return [];
        throw error;
    } finally {
        await api.close().catch(() => {});
    }
}

function parseRouterOsDuration(value) {
    const text = String(value || '').trim();
    const clock = text.match(/^(?:(\d+)w)?(?:(\d+)d)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (clock) {
        if (Number(clock[4]) >= 60 || Number(clock[5]) >= 60) return 0;
        return Math.floor(Number(clock[1] || 0) * 604800 + Number(clock[2] || 0) * 86400 +
            Number(clock[3]) * 3600 + Number(clock[4]) * 60 + Number(clock[5]));
    }

    if (!text) {
        return 0;
    }

    const units = {
        w: 7 * 24 * 60 * 60,
        d: 24 * 60 * 60,
        h: 60 * 60,
        m: 60,
        s: 1
    };

    let seconds = 0;

    const regex = /(\d+(?:\.\d+)?)(w|d|h|m|s)/g;

    let match;

    while ((match = regex.exec(text))) {
        seconds += Number(match[1]) * units[match[2]];
    }

    return Math.floor(seconds);
}


function planDurationMs(plan) {
    if (!plan || !Number.isFinite(Number(plan.duration))) {
        return 0;
    }

    const multipliers = {
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000,
        weeks: 7 * 24 * 60 * 60 * 1000,
        months: 30 * 24 * 60 * 60 * 1000
    };

    const multiplier = multipliers[plan.period];

    if (!multiplier) {
        return 0;
    }

    return multiplier * Number(plan.duration);
}


function formatRouterOsDate(date) {
    const months = [
        'jan', 'feb', 'mar', 'apr',
        'may', 'jun', 'jul', 'aug',
        'sep', 'oct', 'nov', 'dec'
    ];

    return (
        `${months[date.getUTCMonth()]}/` +
        `${String(date.getUTCDate()).padStart(2, '0')}/` +
        `${date.getUTCFullYear()}`
    );
}


function formatRouterOsTime(date) {
    return (
        `${String(date.getUTCHours()).padStart(2, '0')}:` +
        `${String(date.getUTCMinutes()).padStart(2, '0')}:` +
        `${String(date.getUTCSeconds()).padStart(2, '0')}`
    );
}


function calendarExpirationSchedulerName(username) {
    return `EA-EXP-${String(username).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}


async function readMikroTikHotspotActiveUsers() {
    const api = new RouterOSAPI(getMikroTikApiOptions());

    try {
        await api.connect();

        return await api.write('/ip/hotspot/active/print');

    } catch (error) {
        if (
            error?.errno === 'UNKNOWNREPLY' &&
            /!empty/.test(error.message || '')
        ) {
            return [];
        }

        throw error;

    } finally {
        await api.close().catch(() => {});
    }
}


async function deleteMikroTikUser(username) {
    const api = new RouterOSAPI(getMikroTikApiOptions());
    const name = String(username).trim();
    const schedulerName = calendarExpirationSchedulerName(name);
    const targets = [
        ['/ip/hotspot/active', 'user', name],
        ['/ip/hotspot/cookie', 'user', name],
        ['/system/scheduler', 'name', schedulerName],
        ['/ip/hotspot/user', 'name', name]
    ];

    try {
        await api.connect();
        for (const [menu, field, value] of targets) {
            let entries;
            try {
                entries = await api.write(`${menu}/print`, [`?${field}=${value}`]);
            } catch (error) {
                if (error?.errno === 'UNKNOWNREPLY' && /!empty/.test(error.message || '')) {
                    entries = [];
                } else {
                    throw error;
                }
            }
            for (const entry of entries) {
                if (String(entry[field] || '').trim() === value) {
                    if (!entry['.id']) {
                        throw new Error(`MikroTik did not return an ID for ${menu} entry ${value}.`);
                    }
                    await api.write(`${menu}/remove`, [`=numbers=${entry['.id']}`]);
                }
            }
        }
    } finally {
        await api.close().catch(() => {});
    }
}

async function disableMikroTikUser(username) {
    const api = new RouterOSAPI(getMikroTikApiOptions());

    try {
        await api.connect();

        // Find active sessions for this voucher.
        const activeUsers = await api.write(
            '/ip/hotspot/active/print'
        );

        for (const active of activeUsers) {
            if (
                String(active.user || '').trim() ===
                String(username).trim()
            ) {
                if (active['.id']) {
                    await api.write(
                        '/ip/hotspot/active/remove',
                        [`=.id=${active['.id']}`]
                    );
                }
            }
        }

        // Disable the voucher.
        await api.write(
            '/ip/hotspot/user/set',
            [
                `=numbers=${String(username).trim()}`,
                '=disabled=yes'
            ]
        );

        console.log(
            `Calendar voucher expired and disabled: ${username}`
        );

    } finally {
        await api.close().catch(() => {});
    }
}


async function scheduleCalendarExpiration(username, expiresAt) {
    const api = new RouterOSAPI(getMikroTikApiOptions());

    const schedulerName =
        calendarExpirationSchedulerName(username);

    const user = String(username).trim();

    try {
        await api.connect();

        if (expiresAt <= Date.now()) {
            await api.write(
                '/ip/hotspot/user/set',
                [
                    `=numbers=${user}`,
                    '=disabled=yes'
                ]
            );

            return;
        }

        const expiryDate = new Date(expiresAt);

        const [routerClock] = await api.write('/system/clock/print');
        const localExpiry = require('./router-time').schedulerTime(expiresAt, routerClock);
        const startDate = localExpiry.date;
        const startTime = localExpiry.time;

        const onEvent =
            `:local u "${user.replace(/[\\"$]/g, '\\$&')}"; ` +
            `/ip hotspot active remove [find user=$u]; ` +
            `/ip hotspot user set [find name=$u] disabled=yes; ` +
            `/system scheduler remove [find name="${schedulerName}"];`;

        const existing = (await api.write('/system/scheduler/print')).find(item => item.name === schedulerName);
        const scheduleFields = [
            `=name=${schedulerName}`, '=interval=0s', '=disabled=no',
            `=start-date=${startDate}`, `=start-time=${startTime}`, `=on-event=${onEvent}`,
            '=policy=read,write,test'
        ];
        await api.write(existing ? '/system/scheduler/set' : '/system/scheduler/add',
            existing ? [`=.id=${existing['.id']}`, ...scheduleFields] : scheduleFields);

        console.log(
            `Calendar expiry scheduled: ${user} | ` +
            `expires=${expiryDate.toISOString()}`
        );

    } finally {
        await api.close().catch(() => {});
    }
}


let calendarSyncRunning = false;
let townRefreshRunning = null;

// HTTP requests and the periodic job share one refresh per town. Slow router
// expiry operations can continue after a state response without building a queue.
function refreshTownState() {
    if (townRefreshRunning) return townRefreshRunning;
    townRefreshRunning = (async () => {
        let warning = '';
        try {
            if (!sharedVouchers) {
                const users = await readMikroTikHotspotUsers();
                mergeMikroTikUsers(readManagerData(), users);
            }
        } catch (error) {
            console.error('Town user refresh failed:', error.message);
            warning = 'Router sync is unavailable. Showing saved records.';
        }
        try { await syncCalendarActivations(); }
        catch (error) {
            console.error('Town calendar refresh failed:', error.message);
            warning = 'Router sync is unavailable. Showing saved records.';
        }
        return warning;
    })().finally(() => { townRefreshRunning = null; });
    return townRefreshRunning;
}

async function refreshTownStateForResponse() {
    let deadline;
    try {
        return await Promise.race([
            refreshTownState(),
            new Promise((resolve) => {
                deadline = setTimeout(() => resolve('Router sync is still running. Showing saved records.'), 2000);
            })
        ]);
    } finally { clearTimeout(deadline); }
}


function activationDuration(voucher, plans) {
    if (Number(voucher.durationMs) > 0) return Number(voucher.durationMs);
    const matches = (plan) => (voucher.planId && plan.id === voucher.planId) || (voucher.planName && plan.name === voucher.planName) ||
        (voucher.mikrotikProfile && profileNameForPlan(plan) === voucher.mikrotikProfile);
    const plan = plans.find(matches) || defaultPlans.find(matches);
    return plan ? planDurationMs(plan) : 0;
}
async function syncCalendarActivations() {
    if (sharedVouchers) { sharedVouchers.expireTown(env.TOWN_ID || 'default'); return; }
    // A state refresh must also check users imported while an earlier sync was running.
    while (calendarSyncRunning) await calendarSyncRunning;
    calendarSyncRunning = performCalendarActivationSync();
    try { await calendarSyncRunning; }
    finally { calendarSyncRunning = false; }
}

async function performCalendarActivationSync() {
    try {
        const activeUsers = await readMikroTikHotspotActiveUsers();
        // Read after the network call so newly recovered purchases are included.
        const data = readManagerData();
        let changed = false;
        const observedAt = Date.now();
        for (const active of activeUsers) {
            const voucher = data.vouchers.find((item) => String(item.username).trim() === String(active.user || '').trim());
            if (!voucher) continue;
            if (!voucher.hasLoggedIn) { voucher.hasLoggedIn = true; changed = true; }
            if (!voucher.activatedAt) {
                voucher.activatedAt = observedAt - parseRouterOsDuration(active.uptime) * 1000;
                voucher.activationSource = 'observed-session';
                changed = true;
            }
            if (!voucher.expiresAt) {
                const duration = activationDuration(voucher, data.plans);
                if (duration > 0) {
                    voucher.durationMs = duration;
                    voucher.expiresAt = voucher.activatedAt + duration;
                    voucher.expirySchedulePending = true;
                    changed = true;
                }
            }
            if (voucher.provisioning === 'pending') { voucher.provisioning = 'ready'; changed = true; }
            const status = voucher.expiresAt && voucher.expiresAt <= observedAt ? 'expired' : 'active';
            if (voucher.status !== status) { voucher.status = status; changed = true; }
        }
        for (const voucher of data.vouchers) {
            if (voucher.expiresAt > observedAt && !voucher.timezoneScheduleVersion && !voucher.expirySchedulePending) {
                voucher.expirySchedulePending = true;
                changed = true;
            }
            if (voucher.expiresAt && voucher.expiresAt <= observedAt && voucher.status !== 'expired') {
                voucher.status = 'expired';
                voucher.expirySchedulePending = true;
                changed = true;
            }
        }
        // Router scheduling failures must not discard evidence that a customer is online.
        if (changed) writeManagerData(data);
        for (const voucher of data.vouchers.filter((item) => item.expirySchedulePending && item.expiresAt)) {
            try {
                if (voucher.expiresAt <= Date.now()) await disableMikroTikUser(voucher.username);
                else await scheduleCalendarExpiration(voucher.username, voucher.expiresAt);
                const latest = readManagerData();
                const current = latest.vouchers.find((item) => item.id === voucher.id);
                if (current && current.expiresAt === voucher.expiresAt) {
                    current.expirySchedulePending = false;
                    current.timezoneScheduleVersion = 1;
                    writeManagerData(latest);
                }
            } catch (error) { console.error('Expiry scheduling will retry:', voucher.username, error.message); }
        }
    } catch (error) {
        console.error('Calendar activation sync failed:', error.message);
        throw error;
    }
}

function mergeMikroTikUsers(data, mikrotikUsers) {
    const knownUsernames = new Set(data.vouchers.map((voucher) => voucher.username));
    const imported = mikrotikUsers
        .filter((user) => user.name && !knownUsernames.has(user.name))
        .map((user) => {
            const plan = data.plans.find((item) => profileNameForPlan(item) === user.profile);
            const durationMs = plan
                ? ({ hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 }[plan.period] || 0) * plan.duration
                : 0;
            return {
                id: crypto.randomUUID(),
                username: user.name,
                password: '',
                phone: '',
                planId: plan?.id || '',
                amount: 0,
                dataLimit: plan?.dataLimit || 0,
                createdAt: Date.now(),
                // MikroTik does not report a creation date, so never let the manager's local
                // time-based check mark this expired; RouterOS remains the source of truth.
              //  expiresAt: Date.now() + (durationMs || 10 * 365 * 86400000),
                activatedAt: null,
                expiresAt: null,
              status: user.disabled === 'true' ? 'expired' : 'active',
                source: 'mikrotik',
                mikrotikProfile: user.profile || ''
            };
        });

    data.vouchers.unshift(...imported);
    const routerByName = new Map(mikrotikUsers.map((user) => [user.name, user]));
    const observedAt = Date.now();
    let changed = imported.length > 0;
    for (const voucher of data.vouchers) {
        const routerUser = routerByName.get(voucher.username);
        if (!routerUser) continue;
        if (!voucher.hasLoggedIn && parseRouterOsDuration(routerUser.uptime) > 0) {
            voucher.hasLoggedIn = true;
            changed = true;
        }
        const counters = [routerUser['bytes-in'], routerUser['bytes-out']];
        // Missing counters are unknown, not zero. Keep the last valid reading.
        if (!counters.every((value) => /^\d+$/.test(String(value)))) continue;
        const [upload, download] = counters.map(Number);
        if (!Number.isSafeInteger(upload + download)) continue;
        voucher.dataConsumedBytes = upload + download;
        if (upload + download > 0) voucher.hasLoggedIn = true;
        voucher.dataUsageUpdatedAt = observedAt;
        changed = true;
    }
    if (changed) writeManagerData(data);

    return data;
}

function chooseQuotaBytes(planName) {
    const quotas = {
        '3 Hours': 5 * 1024 * 1024 * 1024,
        'Daily': 11 * 1024 * 1024 * 1024,
        '3 Days': 17 * 1024 * 1024 * 1024,
        '7 Days': 33 * 1024 * 1024 * 1024,
        '30 Days': 90 * 1024 * 1024 * 1024
    };

    if (quotas[planName]) return quotas[planName];
    const plan = readManagerData().plans.find((item) => item.name === planName);
    return plan ? Number(plan.dataLimit) * 1024 * 1024 * 1024 : undefined;
}

function normalizePhone(phone) {
    const cleaned = String(phone || '').replace(/\D/g, '');

    if (!cleaned) {
        return '';
    }

    if (cleaned.length === 10 && /^0[2-9]/.test(cleaned)) {
        return `+233${cleaned.substring(1)}`;
    }

    if (cleaned.length === 12 && /^233[2-9]/.test(cleaned)) {
        return `+${cleaned}`;
    }

    return cleaned;
}


function recordPaidVoucher({
    reference,
    planName,
    amount,
    phone,
    username,
    password,
    source,
    paidAt,
    provisioning = 'pending'
}) {
    const data = readManagerData();

    const existing =
        data.vouchers.find(
            (voucher) =>
                voucher.paymentReference === reference
        );

    if (existing) {
        return existing;
    }

    const plan =
        data.plans.find(
            (item) => item.name === planName
        ) || defaultPlans.find((item) => item.name === planName);

    const imported = data.vouchers.find((item) => item.username === String(username).trim() && item.source === 'mikrotik' && !item.paymentReference);
    const now = Date.now();

    const voucher = {
        id: imported?.id || crypto.randomUUID(),

        username: String(username).trim(),
        password: String(password).trim(),
        phone: String(phone || '').trim(),

        planId:
            plan?.id ||
            planName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-'),

        amount: Number(amount),

        dataLimit:
            plan?.dataLimit || 0,

        createdAt: Number.isFinite(Date.parse(paidAt)) ? Date.parse(paidAt) : now,

        // Calendar validity starts ONLY on first login.
        activatedAt: imported?.activatedAt || null,
        expiresAt: imported?.expiresAt || null,
        activationSource: imported?.activationSource,
        expirySchedulePending: imported?.expirySchedulePending || false,
        planName,
        durationMs: imported?.durationMs || (plan ? planDurationMs(plan) : 0),
        sharedUsers: plan?.sharedUsers || 1,
        rateLimit: plan?.rateLimit || '',

        status: provisioning === 'pending' ? 'pending' : 'active',
        provisioning,

        source,

        paymentReference: reference
    };

    if (imported) data.vouchers = data.vouchers.filter((item) => item.id !== imported.id);
    data.vouchers.unshift(voucher);

    writeManagerData(data, imported ? voucher : null);

    return voucher;
}

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        service: 'EA-Soft payment server',
        version: BACKEND_VERSION,
        mikrotikApi: `${env.MIKROTIK_HOST || '192.168.10.1'}:${env.MIKROTIK_PORT || 8728}`
    });
});

// app.get('/api/admin/state', requireAdminToken, async (req, res) => {
//     try {
//         const data = mergeMikroTikUsers(readManagerData(), await readMikroTikHotspotUsers());
//         res.json({ success: true, plans: data.plans, users: data.vouchers });
//     } catch (error) {
//         console.error(error);
//         res.status(502).json({ success: false, message: `MikroTik user refresh failed: ${error.message || error}` });
//     }
// });

app.get('/api/admin/state', requireAdminToken, async (req, res) => {
    let warning;
    try { warning = await refreshTownStateForResponse(); }
    catch { warning = 'Router sync is unavailable. Showing saved records.'; }
    try {
        const data = readManagerData();
        res.json({ success: true, plans: data.plans, users: data.vouchers, sales: data.sales, dataUsage: data.dataUsage, warning, sharedVouchers: Boolean(sharedVouchers) });
    } catch (error) { res.status(500).json({ success: false, message: 'Could not read saved manager records.' }); }
});

app.get('/api/public/plans', (req, res) => {
    const data = readManagerData();
    res.json({ success: true, plans: data.plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        period: plan.period,
        duration: plan.duration,
        dataLimit: plan.dataLimit,
        price: plan.price,
        sharedUsers: plan.sharedUsers || 1,
        rateLimit: plan.rateLimit || ''
    })) });
});

app.put('/api/admin/plans', requireAdminToken, (req, res) => {
    const plans = Array.isArray(req.body?.plans) ? req.body.plans : null;
    if (!plans) {
        return res.status(400).json({ success: false, message: 'plans must be an array.' });
    }

    const data = readManagerData();
    const previousProfiles = data.plans.map((plan) => profileNameForPlan(plan));
    data.plans = plans.map((plan) => ({
        ...plan,
        price: Number(plan.price),
        dataLimit: Number(plan.dataLimit),
        duration: Number(plan.duration),
        sharedUsers: Math.max(1, Number(plan.sharedUsers) || 1),
        rateLimit: String(plan.rateLimit || '').trim()
    }));
    const currentProfiles = new Set(data.plans.map((plan) => profileNameForPlan(plan)));
    const removedProfiles = previousProfiles.filter((profile) => !currentProfiles.has(profile));

    (sharedVouchers ? Promise.resolve() : syncMikroTikProfiles(data.plans))
        .then(() => sharedVouchers ? undefined : removeMikroTikProfiles(removedProfiles))
        .then(() => {
            writeManagerData(data, null, [], true);
            return res.json({ success: true, plans: data.plans });
        })
        .catch((error) => {
            console.error(error);
            return res.status(502).json({ success: false, message: `MikroTik profile sync failed: ${error.message || error}` });
        });
});

app.post('/api/admin/vouchers', requireAdminToken, async (req, res) => {
    let reservedUsername;
    try {
        const { username, password, phone, planId, amount, requestId } = req.body || {};
        const data = readManagerData();
        const plan = data.plans.find((item) => item.id === planId);

        if (!username || !password || !plan) {
            return res.status(400).json({ success: false, message: 'Username, password, and a valid plan are required.' });
        }
        if (requestId !== undefined && !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) {
            return res.status(400).json({ success: false, message: 'Invalid voucher request ID.' });
        }
        const existingRequest = requestId && data.vouchers.find(v => v.managerRequestId === requestId);
        if (existingRequest) {
            if (existingRequest.username !== String(username).trim() || existingRequest.password !== String(password).trim() ||
                existingRequest.planId !== planId || existingRequest.amount !== Number(amount ?? plan.price) || existingRequest.phone !== String(phone || '').trim()) {
                return res.status(409).json({ success: false, message: 'This request ID belongs to a different voucher.' });
            }
            return res.json({ success: true, user: existingRequest, sales: data.sales });
        }
        if (data.vouchers.some(v => v.username === String(username).trim() && v.source !== 'mikrotik')) {
            return res.status(409).json({ success: false, message: 'This voucher username is already recorded. Refresh the list.' });
        }
        if (initializingVoucherUsernames.has(String(username).trim())) {
            return res.status(409).json({ success: false, message: 'This voucher username is already being created.' });
        }

        const profile = profileNameForPlan(plan);
        const quotaBytes = chooseQuotaBytes(plan.name);
        if (!profile || !quotaBytes) {
            return res.status(400).json({ success: false, message: `No MikroTik profile mapping exists for ${plan.name}.` });
        }

        if (sharedVouchers) {
            const name = String(username).trim();
            sharedVouchers.assertAvailable(name);
            if (initializingVoucherUsernames.has(name)) throw new Error('Voucher username is being created.');
            initializingVoucherUsernames.add(name);
            reservedUsername = name;
        } else {
            reservedUsername = String(username).trim();
            initializingVoucherUsernames.add(reservedUsername);
            await createMikroTikUser(username, password, profile, quotaBytes, requestId);
        }
        const now = Date.now();
        // A periodic refresh may have imported the router account while its add reply was delayed.
        data.vouchers = readManagerData().vouchers;
        const imported = data.vouchers.find(v => v.username === String(username).trim() && v.source === 'mikrotik');

        const voucher = {
        ...(imported || {}),
        id: imported?.id || crypto.randomUUID(),
        managerRequestId: requestId || null,

        username: String(username).trim(),
        password: String(password).trim(),
        phone: String(phone || '').trim(),

        planId: plan.id,
        durationMs: planDurationMs(plan),
        sharedUsers: plan.sharedUsers || 1,
        rateLimit: plan.rateLimit || '',

        amount: Number(amount ?? plan.price),

        dataLimit: plan.dataLimit,

        createdAt: now,

        // Starts only after first successful login.
        activatedAt: imported?.activatedAt || null,
        expiresAt: imported?.expiresAt || null,

        status: 'active',

        source: 'manager'
        };

        if (imported) data.vouchers = data.vouchers.filter(v => v.id !== imported.id);
        data.vouchers.unshift(voucher);
        writeManagerData(data, voucher);
        return res.status(201).json({ success: true, user: voucher, sales: data.sales });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message || 'Voucher creation failed.' });
    } finally { if (reservedUsername) initializingVoucherUsernames.delete(reservedUsername); }
});



app.put('/api/admin/vouchers/:id', requireAdminToken, (req, res) => {
    const data = readManagerData();
    const voucher = data.vouchers.find((item) => item.id === req.params.id);
    if (!voucher) {
        return res.status(404).json({ success: false, message: 'Voucher not found.' });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ success: false, message: 'Amount must be a non-negative number.' });
    }

    voucher.phone = String(req.body?.phone || '').trim();
    voucher.amount = amount;
    writeManagerData(data, voucher);
    return res.json({ success: true, user: voucher, sales: data.sales });
});

app.delete('/api/admin/vouchers/:id', requireAdminToken, async (req, res) => {
    const data = readManagerData();
    const voucher = data.vouchers.find((item) => item.id === req.params.id);
    if (!voucher) {
        return res.status(404).json({ success: false, message: 'Voucher not found.' });
    }

    try {
        if (sharedVouchers) await sharedVouchers.revoke(voucher.username);
        else await deleteMikroTikUser(voucher.username);
        const latestData = readManagerData();
        latestData.vouchers = latestData.vouchers.filter((item) => item.id !== req.params.id);
        writeManagerData(latestData, null, [req.params.id]);
        return res.json({ success: true });
    } catch (error) {
        console.error('Voucher deletion failed:', error.message || error);
        return res.status(502).json({ success: false, message: `Voucher deletion failed; manager record retained: ${error.message || error}` });
    }
});

const paymentJobs = new Map();
function rememberPaymentAttempt(reference, remove = false, delay = 30000, details = {}) {
    const data = readManagerData();
    const previous = data.paymentAttempts.find((item) => item.reference === reference) || {};
    data.paymentAttempts = data.paymentAttempts.filter((item) => item.reference !== reference);
    if (!remove) data.paymentAttempts.push({ ...previous, ...details, reference, nextCheckAt: Date.now() + delay });
    saveManagerData(data);
}
function fulfillPayment(reference) {
    if (typeof reference !== 'string' || !/^[a-zA-Z0-9._=-]{1,200}$/.test(reference)) return Promise.reject(new Error('A valid payment reference is required.'));
    if (paymentJobs.has(reference)) return paymentJobs.get(reference);
    const job = Promise.resolve().then(async () => {
        const transaction = await paystackVerify(reference);
        if (transaction.status !== 'success') throw new Error('This payment has not completed successfully yet.');
        if (transaction.reference !== reference || transaction.currency !== 'GHS' || !Number.isFinite(Number(transaction.amount)) || Number(transaction.amount) <= 0) throw new Error('Payment reference, currency, or amount is invalid.');
        const metadata = typeof transaction.metadata === 'string' ? JSON.parse(transaction.metadata) : transaction.metadata || {};
        if ((metadata.town_id || 'default') !== (env.TOWN_ID || 'default')) throw new Error('This payment belongs to a different town. Select its town before recovering it.');
        const fields = Array.isArray(metadata.custom_fields) ? metadata.custom_fields : [];
        const value = (name) => metadata[name] || fields.find((field) => field.variable_name === name)?.value;
        const planName = value('package_name') || value('plan_name');
        const username = value('voucher_username');
        const password = value('voucher_password');
        const profile = chooseProfile(planName);
        const quotaBytes = chooseQuotaBytes(planName);
        if (!planName || !username || !password || !profile || !quotaBytes) throw new Error('Payment is missing its hotspot package or credentials. Contact support with the reference.');
        if (metadata.package_amount != null && Number(metadata.package_amount) !== Number(transaction.amount)) throw new Error('Payment amount does not match the checkout price.');
        let data = readManagerData();
        let voucher = data.vouchers.find((item) => item.paymentReference === reference);
        if (voucher?.radiusRevoked) throw new Error('This voucher was revoked.');
        const attempt = data.paymentAttempts.find((item) => item.reference === reference);
        const plan = data.plans.find((item) => item.name === planName) || defaultPlans.find((item) => item.name === planName);
        const expectedAmount = attempt?.amount ?? voucher?.amount ?? plan?.price;
        if (!Number.isFinite(Number(expectedAmount)) || Math.round(Number(expectedAmount) * 100) !== Number(transaction.amount)) throw new Error('Verified payment amount does not match the package price.');
        if (!voucher && data.sales.some((sale) => sale.paymentReference === reference)) throw new Error('This payment was already recorded and its voucher was deleted.');
        if (!voucher) {
            if (sharedVouchers) sharedVouchers.assertAvailable(String(username).trim(), reference);
            voucher = recordPaidVoucher({ reference, planName, amount: Number(transaction.amount) / 100,
                phone: value('phone') || value('mobile_number') || transaction.customer?.phone || '',
                username, password, source: 'online-payment', paidAt: transaction.paid_at });
        }
        if (voucher.provisioning === 'pending') {
            rememberPaymentAttempt(reference);
            try {
                // Recover a prior successful router write if the process stopped before saving it.
                if (!sharedVouchers) {
                const routerUser = (await readMikroTikHotspotUsers()).find((item) => item.name === voucher.username);
                if (routerUser) {
                    if (routerUser.password !== voucher.password || routerUser.profile !== profile) throw new Error('Router username exists with different credentials or package.');
                } else await createMikroTikUser(voucher.username, voucher.password, profile, quotaBytes);
                }
            } catch (error) {
                throw new Error('Payment is recorded in Manager; hotspot activation is pending and will retry automatically. ' + error.message);
            }
            data = readManagerData();
            const current = data.vouchers.find((item) => item.id === voucher.id);
            if (!current) throw new Error('Voucher was deleted while activation was in progress.');
            current.provisioning = 'ready';
            current.status = 'active';
            writeManagerData(data);
            voucher = current;
            try { await sendVoucherSms(voucher.phone, voucher.username, voucher.password, profile); }
            catch (error) { console.error('Voucher SMS delivery failed:', error.message); }
        }
        rememberPaymentAttempt(reference, true);
        return { success: true, username: voucher.username, password: voucher.password, phone: voucher.phone, reference, profile };
    }).finally(() => paymentJobs.delete(reference));
    paymentJobs.set(reference, job);
    return job;
}
let paymentRecoveryRunning = false;
async function recoverPendingPayments() {
    if (paymentRecoveryRunning) return;
    paymentRecoveryRunning = true;
    try {
        const data = readManagerData();
        // Include paid vouchers whose router provisioning was interrupted by a restart.
        const pending = data.vouchers.filter((item) => item.provisioning === 'pending' && item.paymentReference);
        for (const voucher of pending) {
            if (!data.paymentAttempts.some((item) => item.reference === voucher.paymentReference)) rememberPaymentAttempt(voucher.paymentReference, false, 0);
        }
        const attempts = readManagerData().paymentAttempts.filter((item) => item.nextCheckAt <= Date.now()).slice(0, 5);
        for (const attempt of attempts) {
            rememberPaymentAttempt(attempt.reference, false, 60000);
            try { await fulfillPayment(attempt.reference); }
            catch (error) { console.error('Payment recovery pending:', attempt.reference, error.message); }
        }
    } catch (error) { console.error('Payment recovery failed:', error.message); }
    finally { paymentRecoveryRunning = false; }
}

app.post('/api/initiate-payment', async (req, res) => {
    let reservedUsername;
    try {
        const {
            planName,
            amount,
            phone,
            email = 'botee2020@gmail.com'
        } = req.body || {};

        if (!planName || !amount || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Plan, phone number, and amount are required.'
            });
        }

        const profile = chooseProfile(planName);
        const quotaBytes = chooseQuotaBytes(planName);
        if (!profile || !quotaBytes) {
            return res.status(400).json({
                success: false,
                message: 'Unknown package selected.'
            });
        }

        const selectedPlan = readManagerData().plans.find((item) => item.name === planName);
        if (!selectedPlan || !Number.isFinite(Number(selectedPlan.price)) || Number(selectedPlan.price) <= 0 || Math.round(Number(amount) * 100) !== Math.round(Number(selectedPlan.price) * 100)) {
            return res.status(400).json({ success: false, message: 'This package is unavailable or its price changed. Refresh the packages and try again.' });
        }
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: 'Provide a valid mobile money number.'
            });
        }

        const username = generateVoucherUsername();
        reservedUsername = username;
        initializingVoucherUsernames.add(username);
        const password = generateVoucherPassword();
        const reference = `EA-${crypto.randomUUID()}`;
        const secretKey = required('PAYSTACK_SECRET_KEY');

        const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                amount: Math.round(Number(amount) * 100),
                currency: 'GHS',
                reference,
                channels: ['mobile_money'],
                phone: normalizedPhone,
                metadata: {
                    town_id: env.TOWN_ID || 'default',
                    custom_fields: [
                        { display_name: 'Package', variable_name: 'package_name', value: planName },
                        { display_name: 'Hotspot Profile', variable_name: 'hotspot_profile', value: profile },
                        { display_name: 'Voucher Username', variable_name: 'voucher_username', value: username },
                        { display_name: 'Voucher Password', variable_name: 'voucher_password', value: password },
                        { display_name: 'Phone', variable_name: 'phone', value: normalizedPhone }
                    ],
                    package_amount: Math.round(Number(selectedPlan.price) * 100),
                    plan_name: planName,
                    hotspot_profile: profile,
                    package_name: planName,
                    voucher_username: username,
                    voucher_password: password,
                    phone: normalizedPhone
                }
            })
        });

        const paymentData = await paystackResponse.json();

        if (!paystackResponse.ok || !paymentData.status) {
            throw new Error(paymentData.message || 'Paystack transaction initialization failed.');
        }

        rememberPaymentAttempt(paymentData.data.reference, false, 30000, { amount: Number(selectedPlan.price), username });
        return res.json({
            success: true,
            access_code: paymentData.data.access_code,
            reference: paymentData.data.reference,
            authorization_url: paymentData.data.authorization_url,
            username,
            password,
            profile
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Payment initiation failed.'
        });
    } finally {
        if (reservedUsername) initializingVoucherUsernames.delete(reservedUsername);
    }
});

app.post('/api/payment-complete', async (req, res) => {
    try {
        const result = await fulfillPayment(req.body?.reference);
        res.json(result);
    } catch (error) { res.status(502).json({ success: false, message: error.message }); }
});

app.post('/api/admin/reconcile-payment', requireAdminToken, async (req, res) => {
    try { res.json(await fulfillPayment(req.body?.reference)); }
    catch (error) { res.status(502).json({ success: false, message: error.message }); }
});

app.post('/api/paystack/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-paystack-signature'];
        const secret = required('PAYSTACK_SECRET_KEY');
        const rawBody = req.rawBody?.length
            ? req.rawBody
            : Buffer.from(JSON.stringify(req.body || {}));

        if (!signature) {
            return res.status(401).json({ success: false, message: 'Missing Paystack signature.' });
        }

        const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
        const received = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expected, 'hex');
        const isValid = received.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, received);

        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid Paystack signature.' });
        }

        const event = JSON.parse(rawBody.toString('utf8'));

        if (event.event !== 'charge.success') {
            return res.status(200).json({ success: true, received: true });
        }

        const reference = event.data?.reference;
        if (!reference) {
            return res.status(400).json({ success: false, message: 'Missing Paystack reference.' });
        }

        const result = await fulfillPayment(reference);
        return res.status(200).json({ success: true, reference, received: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message || 'Webhook processing failed.' });
    }
});

// app.listen(PORT, () => {
//     console.log(`EA-Soft payment server running on port ${PORT}`);
//     console.log(`MikroTik API: ${env.MIKROTIK_HOST || '192.168.10.1'}:${env.MIKROTIK_PORT || 8728}`);
// });


    const timers = [];
    function startJobs() {
        if (timers.length) return;
        const sync = async () => {
            if (townRefreshRunning) return;
            await refreshTownState();
        };
        timers.push(setTimeout(recoverPendingPayments, 1000), setInterval(recoverPendingPayments, 30000),
            setTimeout(sync, 5000), setInterval(sync, 10000));
        timers.push(setTimeout(() => businessOperations.refresh().catch(console.error), 7000),
            setInterval(() => businessOperations.refresh().catch(console.error), 60000));
    }
    return { app, readManagerData, startJobs,
        updateSharedVoucher(id, changes) {
            const data = readManagerData();
            const voucher = data.vouchers.find((item) => item.id === id);
            if (!voucher) throw new Error('Voucher no longer exists.');
            if (Number.isSafeInteger(changes.dataConsumedBytes)) {
                recordDataUsage(data.dataUsage, changes.dataConsumedBytes - (voucher.dataConsumedBytes || 0), changes.dataUsageUpdatedAt);
            }
            Object.assign(voucher, changes);
            saveManagerData(data);
        },
        async disconnectSharedVoucher(username) {
            const api = new RouterOSAPI(getMikroTikApiOptions());
            try {
                await api.connect();
                for (const session of await api.write('/ip/hotspot/active/print')) {
                    if (String(session.user) === username && session['.id']) await api.write('/ip/hotspot/active/remove', [`=.id=${session['.id']}`]);
                }
            } finally { await api.close().catch(() => {}); }
        },
        stopJobs() { timers.forEach(clearInterval); timers.length = 0; } };
}

module.exports = { createTownApp };
if (require.main === module) {
    const { createMultiTownApp } = require('./towns');
    const manager = createMultiTownApp({ createTownApp,
        requestRestart: process.env.pm_id !== undefined ? () => setTimeout(() => process.exit(0), 500) : undefined });
    manager.app.listen(Number(process.env.PORT || 3000), () => {
        manager.startJobs();
        console.log('EA-Soft server ready for', manager.townCount, 'town(s).');
    });
}
