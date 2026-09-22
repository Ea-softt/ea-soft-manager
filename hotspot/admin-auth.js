const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function matches(password, stored) {
    if (typeof password !== 'string' || password.length > 256) return false;
    const [salt, hash] = String(stored).split(':');
    if (!salt || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
    return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const emailOf = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword = (value) => typeof value === 'string' && value.length >= 12 && value.length <= 256;

function installAdminAuth(app, { env = process.env, file = env.ADMIN_ACCOUNT_FILE || path.join(__dirname, 'data', 'admin-account.json'), sendMail, now = Date.now } = {}) {
    let account;
    function save(next) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(file + '.tmp', file);
        account = next;
    }
    if (fs.existsSync(file)) {
        account = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!validEmail(account.email) || !account.passwordHash) throw new Error('Invalid admin account file.');
    } else if (validEmail(emailOf(env.ADMIN_EMAIL)) && env.ADMIN_PASSWORD_HASH) {
        save({ email: emailOf(env.ADMIN_EMAIL), passwordHash: env.ADMIN_PASSWORD_HASH });
    }
    const sessions = new Map();
    const limits = new Map();
    let reset = null;
    function rateLimit(req, res, next) {
        const time = now();
        for (const [key, item] of limits) if (item.until <= time) limits.delete(key);
        const key = `${req.ip}:${req.path}`;
        const item = limits.get(key) || { count: 0, until: time + 15 * 60000 };
        if (limits.size >= 5000 && !limits.has(key)) return res.status(429).json({ message: 'Too many requests. Try again later.' });
        limits.set(key, item);
        if (++item.count > 10) return res.status(429).json({ message: 'Too many attempts. Try again in 15 minutes.' });
        next();
    }
    function requireAdmin(req, res, next) {
        const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
        const session = sessions.get(digest(token));
        if (!session || session <= now()) {
            sessions.delete(digest(token));
            return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
        }
        req.sessionKey = digest(token);
        next();
    }
    app.use('/api/admin', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.post('/api/admin/session', rateLimit, (req, res) => {
        if (!account) return res.status(503).json({ message: 'Admin account setup is required on the server.' });
        const passwordOK = matches(req.body?.password, account.passwordHash);
        if (!passwordOK || emailOf(req.body?.email) !== account.email) return res.status(401).json({ message: 'Email or password is incorrect.' });
        for (const [key, expires] of sessions) if (expires <= now()) sessions.delete(key);
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(digest(token), now() + 8 * 3600000);
        res.json({ success: true, token, email: account.email });
    });
    app.delete('/api/admin/session', requireAdmin, (req, res) => {
        sessions.delete(req.sessionKey);
        res.json({ success: true });
    });
    app.put('/api/admin/account', requireAdmin, rateLimit, (req, res) => {
        if (!matches(req.body?.currentPassword, account.passwordHash)) return res.status(400).json({ message: 'Current password is incorrect.' });
        const email = emailOf(req.body?.email);
        const password = req.body?.newPassword;
        if (!validEmail(email) || (password && !validPassword(password))) return res.status(400).json({ message: 'Enter a valid email and a password of 12–256 characters.' });
        save({ email, passwordHash: password ? hashPassword(password) : account.passwordHash });
        reset = null;
        sessions.clear();
        res.json({ success: true });
    });
    app.post('/api/admin/forgot-password', rateLimit, async (req, res) => {
        if (!sendMail && !(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM)) return res.status(503).json({ message: 'Password recovery email is not configured. Contact the administrator.' });
        const message = 'If that email matches your account, a reset code will arrive shortly. It expires in 15 minutes.';
        if (!account || emailOf(req.body?.email) !== account.email) return res.json({ success: true, message });
        if (reset && reset.sentAt + 60000 > now()) return res.json({ success: true, message });
        const code = crypto.randomBytes(6).toString('hex').toUpperCase();
        const pending = { hash: digest(code), expires: now() + 15 * 60000, sentAt: now(), attempts: 0 };
        reset = pending;
        try {
            // Email delivery is optional: a missing mail dependency must not stop login or payments.
            const deliver = sendMail || ((mail) => require('nodemailer').createTransport({
                host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: Number(env.SMTP_PORT || 587) === 465,
                requireTLS: true, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
                connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
            }).sendMail(mail));
            await deliver({ from: env.SMTP_FROM, to: account.email, subject: 'EA-Soft Manager password reset', text: `Your password reset code is: ${code}\n\nEnter this code in EA-Soft Manager within 15 minutes. If you did not request this, ignore this email.` });
            res.json({ success: true, message });
        } catch {
            if (reset === pending) reset = null;
            res.status(503).json({ message: 'Could not send the recovery email. Please try again later.' });
        }
    });
    app.post('/api/admin/reset-password', rateLimit, (req, res) => {
        if (!reset || reset.expires <= now() || reset.attempts >= 5) return res.status(400).json({ message: 'Reset code is invalid or expired. Request a new code.' });
        reset.attempts += 1;
        const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
        if (emailOf(req.body?.email) !== account.email || !crypto.timingSafeEqual(Buffer.from(digest(code)), Buffer.from(reset.hash))) return res.status(400).json({ message: 'Reset code is invalid or expired.' });
        if (!validPassword(req.body?.password)) return res.status(400).json({ message: 'Use a password of 12–256 characters.' });
        save({ email: account.email, passwordHash: hashPassword(req.body.password) });
        reset = null;
        sessions.clear();
        res.json({ success: true });
    });
    return requireAdmin;
}
module.exports = { installAdminAuth, hashPassword };
