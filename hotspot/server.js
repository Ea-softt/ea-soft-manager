require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

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

const app = express();
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
        if (req.originalUrl === '/api/paystack/webhook') {
            req.rawBody = Buffer.from(buf);
        }
    }
}));

app.use(cors({
    origin: process.env.FRONTEND_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-paystack-signature', 'Authorization']
}));

const PORT = process.env.PORT || 3000;
const BACKEND_VERSION = 'email-password-admin-2026-09-22-startup-fix';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'manager.json');

const defaultPlans = [
    { id: '3-hours', name: '3 Hours', period: 'hours', duration: 3, dataLimit: 5, price: 3.75, color: 'mint' },
    { id: 'daily', name: 'Daily', period: 'days', duration: 1, dataLimit: 11, price: 5, color: 'sun' },
    { id: '3-days', name: '3 Days', period: 'days', duration: 3, dataLimit: 17, price: 10, color: 'sky' },
    { id: '7-days', name: '7 Days', period: 'days', duration: 7, dataLimit: 33, price: 25, color: 'coral' },
    { id: '30-days', name: '30 Days', period: 'days', duration: 30, dataLimit: 90, price: 70, color: 'violet' }
];

function readManagerData() {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return {
            plans: Array.isArray(data.plans) ? data.plans : defaultPlans,
            vouchers: Array.isArray(data.vouchers) ? data.vouchers : []
        };
    } catch {
        return { plans: defaultPlans, vouchers: [] };
    }
}

function writeManagerData(data) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const { installAdminAuth } = require('./admin-auth');
const requireAdminToken = installAdminAuth(app);

function required(name) {
    if (!process.env[name]) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return process.env[name];
}

function getMikroTikApiOptions() {
    const host = process.env.MIKROTIK_HOST || '192.168.10.1';
    const port = Number(process.env.MIKROTIK_PORT || 8728);

    return {
        host,
        port,
        user: required('MIKROTIK_USERNAME'),
        password: required('MIKROTIK_PASSWORD'),
        timeout: Number(process.env.MIKROTIK_REQUEST_TIMEOUT_MS || 10000) / 1000
    };
}

function generateVoucherUsername() {
    return 'EA-' + Math.floor(100000 + Math.random() * 900000);
}

function generateVoucherPassword() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
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

async function createMikroTikUser(username, password, profile, quotaBytes) {
    const api = new RouterOSAPI(getMikroTikApiOptions());

    const numericQuotaBytes = Number(quotaBytes);

    if (!Number.isFinite(numericQuotaBytes) || numericQuotaBytes <= 0) {
        throw new Error(`Invalid data quota for voucher: ${quotaBytes}`);
    }

    try {
        await api.connect();

        const result = await api.write('/ip/hotspot/user/add', [
            `=name=${String(username).trim()}`,
            `=password=${String(password).trim()}`,
            `=profile=${String(profile).trim()}`,

            // IMPORTANT:
            // Do NOT use limit-uptime.
            // Calendar validity is controlled by the backend scheduler.

            `=limit-bytes-total=${String(numericQuotaBytes)}`
        ]);

        console.log(
            `MikroTik voucher created: ${username} | ` +
            `profile=${profile} | ` +
            `limit-bytes-total=${numericQuotaBytes}`
        );

        return result;

    } catch (error) {
        const message = error.message || String(error);

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

    const provider = (process.env.SMS_PROVIDER || 'generic').toLowerCase();
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
            const senderId = process.env.AFRICASTALKING_SENDER_ID || 'EA-Soft';

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
            const smsUrl = process.env.SMS_API_URL || process.env.SMS_HTTP_URL;
            if (!smsUrl) {
                return { success: false, message: 'BulkSMS Ghana API URL is not configured.' };
            }

            const url = new URL(smsUrl);
            const bulkSmsRecipient = normalizedPhone.startsWith('+233')
                ? `0${normalizedPhone.substring(4)}`
                : normalizedPhone;

            url.searchParams.set('to', bulkSmsRecipient);
            url.searchParams.set('msg', message);
            url.searchParams.set('sender_id', process.env.SMS_SENDER_ID || 'EA-Soft');

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

        const smsUrl = process.env.SMS_API_URL || process.env.SMS_HTTP_URL;
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
        '3 Hours': process.env.PROFILE_3_HOURS || '3-HOURS',
        'Daily': process.env.PROFILE_DAILY || 'DAILY',
        '3 Days': process.env.PROFILE_3_DAYS || '3-DAYS',
        '7 Days': process.env.PROFILE_7_DAYS || '7-DAYS',
        '30 Days': process.env.PROFILE_30_DAYS || '30-DAYS'
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
        return await api.write('/ip/hotspot/user/print');
    } catch (error) {
        if (error?.errno === 'UNKNOWNREPLY' && /!empty/.test(error.message || '')) return [];
        throw error;
    } finally {
        await api.close().catch(() => {});
    }
}

function parseRouterOsDuration(value) {
    const text = String(value || '').trim();

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

        // Remove an old scheduler with the same name.
        try {
            await api.write(
                '/system/scheduler/remove',
                [`=numbers=${schedulerName}`]
            );
        } catch {
            // Scheduler may not exist.
        }

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

        const startDate =
            formatRouterOsDate(expiryDate);

        const startTime =
            formatRouterOsTime(expiryDate);

        const onEvent =
            `:local u "${user}"; ` +
            `/ip hotspot active remove [find user=$u]; ` +
            `/ip hotspot user set [find name=$u] disabled=yes; ` +
            `/system scheduler remove [find name="${schedulerName}"];`;

        await api.write(
            '/system/scheduler/add',
            [
                `=name=${schedulerName}`,
                '=interval=0s',
                `=start-date=${startDate}`,
                `=start-time=${startTime}`,
                `=on-event=${onEvent}`,
                '=policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon'
            ]
        );

        console.log(
            `Calendar expiry scheduled: ${user} | ` +
            `expires=${expiryDate.toISOString()}`
        );

    } finally {
        await api.close().catch(() => {});
    }
}


let calendarSyncRunning = false;


async function syncCalendarActivations() {
    if (calendarSyncRunning) {
        return;
    }

    calendarSyncRunning = true;

    try {
        const data = readManagerData();

        const activeUsers =
            await readMikroTikHotspotActiveUsers();

        let changed = false;

        for (const active of activeUsers) {

            const username =
                String(active.user || '').trim();

            if (!username) {
                continue;
            }

            const voucher =
                data.vouchers.find(
                    (item) =>
                        String(item.username).trim() === username
                );

            if (!voucher) {
                continue;
            }

            // Already activated.
            if (
                voucher.activatedAt &&
                voucher.expiresAt
            ) {
                continue;
            }

            const plan =
                data.plans.find(
                    (item) => item.id === voucher.planId
                );

            if (!plan) {
                console.warn(
                    `Cannot determine plan for voucher ${username}`
                );

                continue;
            }

            const durationMs =
                planDurationMs(plan);

            if (!durationMs) {
                console.warn(
                    `Invalid duration for plan ${plan.name}`
                );

                continue;
            }

            /*
             * RouterOS reports how long the current
             * session has been active.
             *
             * Therefore:
             *
             * actual login time =
             * current time - current session uptime
             */
            const uptimeSeconds =
                parseRouterOsDuration(active.uptime);

            const activationAt =
                Date.now() -
                (uptimeSeconds * 1000);

            const expiresAt =
                activationAt +
                durationMs;

            voucher.activatedAt =
                activationAt;

            voucher.expiresAt =
                expiresAt;

            voucher.status =
                expiresAt > Date.now()
                    ? 'active'
                    : 'expired';

            changed = true;

            console.log(
                `Voucher activated: ${username} | ` +
                `plan=${plan.name} | ` +
                `activated=${new Date(activationAt).toISOString()} | ` +
                `expires=${new Date(expiresAt).toISOString()}`
            );

            if (expiresAt <= Date.now()) {

                await disableMikroTikUser(username);

            } else {

                await scheduleCalendarExpiration(
                    username,
                    expiresAt
                );
            }
        }

        // Keep manager status synchronized with known expiry times.
        for (const voucher of data.vouchers) {

            if (
                voucher.expiresAt &&
                Number(voucher.expiresAt) <= Date.now() &&
                voucher.status !== 'expired'
            ) {
                voucher.status = 'expired';
                changed = true;
            }
        }

        if (changed) {
            writeManagerData(data);
        }

    } catch (error) {

        console.error(
            'Calendar voucher sync error:',
            error.message || error
        );

    } finally {

        calendarSyncRunning = false;
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

    if (imported.length) {
        data.vouchers.unshift(...imported);
        writeManagerData(data);
    }

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

// function recordPaidVoucher({ reference, planName, amount, phone, username, password, source }) {
//     const data = readManagerData();
//     const existing = data.vouchers.find((voucher) => voucher.paymentReference === reference);
//     if (existing) return existing;

//     const plan = data.plans.find((item) => item.name === planName);
//     const durationMs = plan
//         ? ({ hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 }[plan.period] || 0) * plan.duration
//         : 0;
//     const now = Date.now();
//     const voucher = {
//         id: crypto.randomUUID(),
//         username: String(username).trim(),
//         password: String(password).trim(),
//         phone: String(phone || '').trim(),
//         planId: plan?.id || planName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
//         amount: Number(amount),
//         dataLimit: plan?.dataLimit || 0,
//         createdAt: now,
//         expiresAt: durationMs ? now + durationMs : now,
//         status: durationMs ? 'active' : 'expired',
//         source,
//         paymentReference: reference
//     };

//     data.vouchers.unshift(voucher);
//     writeManagerData(data);
//     return voucher;
// }

function recordPaidVoucher({
    reference,
    planName,
    amount,
    phone,
    username,
    password,
    source
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
        );

    const now = Date.now();

    const voucher = {
        id: crypto.randomUUID(),

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

        createdAt: now,

        // Calendar validity starts ONLY on first login.
        activatedAt: null,
        expiresAt: null,

        status: 'active',

        source,

        paymentReference: reference
    };

    data.vouchers.unshift(voucher);

    writeManagerData(data);

    return voucher;
}

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        service: 'EA-Soft payment server',
        version: BACKEND_VERSION,
        mikrotikApi: `${process.env.MIKROTIK_HOST || '192.168.10.1'}:${process.env.MIKROTIK_PORT || 8728}`
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
    try {
        await syncCalendarActivations();

        const data = mergeMikroTikUsers(
            readManagerData(),
            await readMikroTikHotspotUsers()
        );

        res.json({
            success: true,
            plans: data.plans,
            users: data.vouchers
        });

    } catch (error) {
        console.error(error);

        res.status(502).json({
            success: false,
            message:
                `MikroTik user refresh failed: ${
                    error.message || error
                }`
        });
    }
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

    syncMikroTikProfiles(data.plans)
        .then(() => removeMikroTikProfiles(removedProfiles))
        .then(() => {
            writeManagerData(data);
            return res.json({ success: true, plans: data.plans });
        })
        .catch((error) => {
            console.error(error);
            return res.status(502).json({ success: false, message: `MikroTik profile sync failed: ${error.message || error}` });
        });
});

app.post('/api/admin/vouchers', requireAdminToken, async (req, res) => {
    try {
        const { username, password, phone, planId, amount } = req.body || {};
        const data = readManagerData();
        const plan = data.plans.find((item) => item.id === planId);

        if (!username || !password || !plan) {
            return res.status(400).json({ success: false, message: 'Username, password, and a valid plan are required.' });
        }

        const profile = profileNameForPlan(plan);
        const quotaBytes = chooseQuotaBytes(plan.name);
        if (!profile || !quotaBytes) {
            return res.status(400).json({ success: false, message: `No MikroTik profile mapping exists for ${plan.name}.` });
        }

        await createMikroTikUser(username, password, profile, quotaBytes);
        const now = Date.now();

        const voucher = {
        id: crypto.randomUUID(),

        username: String(username).trim(),
        password: String(password).trim(),
        phone: String(phone || '').trim(),

        planId: plan.id,

        amount: Number(amount ?? plan.price),

        dataLimit: plan.dataLimit,

        createdAt: now,

        // Starts only after first successful login.
        activatedAt: null,
        expiresAt: null,

        status: 'active',

        source: 'manager'
        };

        data.vouchers.unshift(voucher);
        writeManagerData(data);
        return res.status(201).json({ success: true, user: voucher });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message || 'Voucher creation failed.' });
    }
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
    writeManagerData(data);
    return res.json({ success: true, user: voucher });
});

app.delete('/api/admin/vouchers/:id', requireAdminToken, async (req, res) => {
    const data = readManagerData();
    const voucher = data.vouchers.find((item) => item.id === req.params.id);
    if (!voucher) {
        return res.status(404).json({ success: false, message: 'Voucher not found.' });
    }

    try {
        await deleteMikroTikUser(voucher.username);
        const latestData = readManagerData();
        latestData.vouchers = latestData.vouchers.filter((item) => item.id !== req.params.id);
        writeManagerData(latestData);
        return res.json({ success: true });
    } catch (error) {
        console.error('Voucher deletion failed:', error.message || error);
        return res.status(502).json({ success: false, message: `Voucher deletion failed; manager record retained: ${error.message || error}` });
    }
});

app.post('/api/initiate-payment', async (req, res) => {
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

        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: 'Provide a valid mobile money number.'
            });
        }

        const username = generateVoucherUsername();
        const password = generateVoucherPassword();
        const reference = `EA-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
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
                    custom_fields: [
                        { display_name: 'Package', variable_name: 'package_name', value: planName },
                        { display_name: 'Hotspot Profile', variable_name: 'hotspot_profile', value: profile },
                        { display_name: 'Voucher Username', variable_name: 'voucher_username', value: username },
                        { display_name: 'Voucher Password', variable_name: 'voucher_password', value: password },
                        { display_name: 'Phone', variable_name: 'phone', value: normalizedPhone }
                    ],
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

        return res.json({
            success: true,
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
    }
});

app.post('/api/payment-complete', async (req, res) => {
    try {
        const {
            reference,
            planName,
            amount,
            phone,
            username,
            password
        } = req.body || {};

        if (!reference || !planName || !amount || !phone || !username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Missing payment or voucher information.'
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

        let transaction;

        try {
            transaction = await paystackVerify(reference);
        } catch (error) {
            throw new Error(`Paystack verification failed: ${error.message || error}`);
        }
        const paidAmount = Number(transaction.amount) / 100;
        const expectedAmount = Number(amount);

        if (transaction.status !== 'success') {
            return res.status(400).json({
                success: false,
                message: 'Paystack transaction is not successful.'
            });
        }

        if (Math.abs(paidAmount - expectedAmount) > 0.005) {
            return res.status(400).json({
                success: false,
                message: 'Payment amount does not match the selected package.'
            });
        }

        const savedVoucher = readManagerData().vouchers.find((voucher) => voucher.paymentReference === reference);
        if (savedVoucher) {
            return res.json({
                success: true,
                username: savedVoucher.username,
                password: savedVoucher.password,
                profile,
                reference,
                phone: savedVoucher.phone,
                sms: { success: true, message: 'Voucher was already created.' }
            });
        }

        await createMikroTikUser(username, password, profile, quotaBytes);

        recordPaidVoucher({
            reference,
            planName,
            amount: expectedAmount,
            phone,
            username,
            password,
            source: 'online-payment'
        });

        const smsResult = await sendVoucherSms(phone, username, password, profile);

        return res.json({
            success: true,
            username,
            password,
            profile,
            reference,
            phone,
            sms: smsResult
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Payment processing failed.'
        });
    }
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

        const transaction = await paystackVerify(reference);
        if (transaction.status !== 'success') {
            return res.status(400).json({ success: false, message: 'Webhook payment was not successful.' });
        }

        const customFields = event.data?.metadata?.custom_fields || [];
        const profileName = event.data?.metadata?.package_name || event.data?.metadata?.plan_name || customFields.find((field) => field.variable_name === 'package_name')?.value || 'Daily';
        const profile = chooseProfile(profileName) || chooseProfile('Daily');
        const quotaBytes = chooseQuotaBytes(profileName) || chooseQuotaBytes('Daily');
        const username = event.data?.metadata?.voucher_username || generateVoucherUsername();
        const password = event.data?.metadata?.voucher_password || generateVoucherPassword();

        const savedVoucher = readManagerData().vouchers.find((voucher) => voucher.paymentReference === reference);
        if (savedVoucher) {
            return res.status(200).json({ success: true, username: savedVoucher.username, password: savedVoucher.password, profile, reference, received: true });
        }

        await createMikroTikUser(username, password, profile, quotaBytes);
        recordPaidVoucher({
            reference,
            planName: profileName,
            amount: Number(transaction.amount) / 100,
            phone: event.data?.metadata?.phone || event.data?.customer?.phone || '',
            username,
            password,
            source: 'paystack-webhook'
        });
        const smsResult = await sendVoucherSms(event.data?.metadata?.phone || event.data?.customer?.phone || '', username, password, profile);

        return res.status(200).json({ success: true, username, password, profile, reference, sms: smsResult });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message || 'Webhook processing failed.' });
    }
});

// app.listen(PORT, () => {
//     console.log(`EA-Soft payment server running on port ${PORT}`);
//     console.log(`MikroTik API: ${process.env.MIKROTIK_HOST || '192.168.10.1'}:${process.env.MIKROTIK_PORT || 8728}`);
// });

app.listen(PORT, () => {
    console.log(
        `EA-Soft payment server running on port ${PORT}`
    );

    console.log(
        `MikroTik API: ${
            process.env.MIKROTIK_HOST || '192.168.10.1'
        }:${
            process.env.MIKROTIK_PORT || 8728
        }`
    );

    // Check for newly activated vouchers immediately.
    setTimeout(() => {
        syncCalendarActivations().catch((error) => {
            console.error(
                'Initial calendar sync failed:',
                error.message || error
            );
        });

        // Check every 10 seconds.
        setInterval(() => {
            syncCalendarActivations().catch((error) => {
                console.error(
                    'Calendar sync failed:',
                    error.message || error
                );
            });
        }, 10000);

    }, 5000);
});
