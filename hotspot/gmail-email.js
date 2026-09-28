const address = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validAddress = (value) => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) && value.length <= 254;
const present = (value) => typeof value === 'string' && Boolean(value.trim());

function gmailConfigured(env) {
    return validAddress(address(env.EMAIL_FROM)) &&
        ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'].every((key) => present(env[key]));
}

async function deliverGmailEmail(env, mail, request = fetch) {
    if (!gmailConfigured(env)) throw new Error('Gmail recovery email is not configured.');
    const from = address(env.EMAIL_FROM);
    const to = address(mail.to);
    if (!validAddress(to)) throw new Error('Invalid recovery email recipient.');
    const tokenResponse = await request('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID.trim(), client_secret: env.GMAIL_CLIENT_SECRET.trim(),
            refresh_token: env.GMAIL_REFRESH_TOKEN.trim(), grant_type: 'refresh_token' }),
        signal: AbortSignal.timeout(20000)
    });
    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokens.access_token !== 'string' || !tokens.access_token) {
        // Provider responses can contain private authorization details. Do not expose them.
        throw new Error('Gmail authorization failed. Reauthorize the sending account using the Gmail setup helper.');
    }
    const subject = Buffer.from(String(mail.subject), 'utf8').toString('base64');
    const body = Buffer.from(String(mail.text), 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
    const message = [`From: EA-Soft Manager <${from}>`, `To: ${to}`, `Subject: =?UTF-8?B?${subject}?=`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
    const response = await request(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(from)}/messages/send`, {
        method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: Buffer.from(message, 'utf8').toString('base64url') }),
        signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`Gmail rejected the recovery email (HTTP ${response.status}). Check the Gmail API, sending account, and gmail.send permission.`);
}

module.exports = { gmailConfigured, deliverGmailEmail };
