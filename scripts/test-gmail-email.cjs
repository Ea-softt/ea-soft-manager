const assert = require('node:assert/strict');
const { recoveryEmailConfigured, deliverRecoveryEmail } = require('../hotspot/admin-auth');

async function main() {
    const env = { EMAIL_PROVIDER: 'gmail', EMAIL_FROM: 'sender@gmail.com', GMAIL_CLIENT_ID: 'client', GMAIL_CLIENT_SECRET: 'private-secret', GMAIL_REFRESH_TOKEN: 'private-refresh' };
    for (const key of ['EMAIL_FROM', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) {
        assert.equal(recoveryEmailConfigured({ ...env, [key]: '' }), false);
    }
    assert.equal(recoveryEmailConfigured(env), true);
    const mail = { to: 'agent@example.test', subject: 'Reset — EA-Soft', text: 'Code: ABC123\nExpires in 15 minutes.' };
    const calls = [];
    await deliverRecoveryEmail(env, mail, async (url, options) => {
        calls.push(url);
        assert.ok(options.signal);
        if (url === 'https://oauth2.googleapis.com/token') {
            assert.equal(options.body.get('grant_type'), 'refresh_token');
            assert.equal(options.body.get('refresh_token'), env.GMAIL_REFRESH_TOKEN);
            assert.equal(options.body.get('client_secret'), env.GMAIL_CLIENT_SECRET);
            return { ok: true, json: async () => ({ access_token: 'private-access' }) };
        }
        assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/sender%40gmail.com/messages/send');
        assert.equal(options.headers.Authorization, 'Bearer private-access');
        const raw = JSON.parse(options.body).raw;
        assert.match(raw, /^[\w-]+$/);
        const decoded = Buffer.from(raw, 'base64url').toString('utf8');
        assert.match(decoded, /From: EA-Soft Manager <sender@gmail.com>\r\nTo: agent@example.test/);
        const [headers, body] = decoded.split('\r\n\r\n');
        assert.equal(Buffer.from(headers.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)[1], 'base64').toString('utf8'), mail.subject);
        assert.equal(Buffer.from(body, 'base64').toString('utf8'), mail.text);
        assert.doesNotMatch(decoded, /private-/);
        return { ok: true, status: 200 };
    });
    assert.equal(calls.length, 2);
    await assert.rejects(deliverRecoveryEmail(env, mail, async () => ({ ok: false, json: async () => ({ error: 'private-refresh' }) })), (error) => /authorization failed/.test(error.message) && !error.message.includes('private-refresh'));
    await assert.rejects(deliverRecoveryEmail(env, mail, async (url) => url.includes('oauth2') ? { ok: true, json: async () => ({ access_token: 'test' }) } : { ok: false, status: 403 }), /HTTP 403/);
    await assert.rejects(deliverRecoveryEmail(env, { ...mail, to: 'agent@example.test\r\nBcc: other@example.test' }, async () => { throw new Error('Should never send'); }), /Invalid recovery email recipient/);
    await assert.rejects(deliverRecoveryEmail(env, mail, async () => { throw new Error('Timed out'); }), /Timed out/);
    console.log('Gmail email checks passed: configuration, token refresh, MIME encoding, send-only request, failures and header validation. No emails sent.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
