const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Run locally: the Google redirect returns to this computer, not the VPS.
async function authorize({ credentialsFile, email, outputFile, request = fetch, announce = console.log, timeoutMs = 5 * 60000 }) {
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email || '')) throw new Error('Enter a valid Gmail sender address.');
    const credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')).installed;
    if (!credentials?.client_id || !credentials?.client_secret) throw new Error('Download an OAuth client JSON for application type Desktop app.');
    if (fs.existsSync(outputFile)) throw new Error('Output file already exists. Choose a new output filename to keep existing credentials safe.');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(32).toString('hex');
    let redirectUri;
    let timer;
    let processing = false;
    let expired = false;
    let resolveResult;
    let rejectResult;
    const completion = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        const url = new URL(req.url, redirectUri);
        if (req.method !== 'GET' || url.pathname !== '/oauth/callback') { res.writeHead(404); res.end('Not found.'); return; }
        if (url.searchParams.get('state') !== state) { res.writeHead(400); res.end('Authorization state did not match. Return to the original sign-in link.'); return; }
        if (processing) { res.writeHead(409); res.end('Authorization is already being completed.'); return; }
        processing = true;
        try {
            if (url.searchParams.has('error')) throw new Error('Google authorization was declined. Run the helper again when ready.');
            const code = url.searchParams.get('code');
            if (!code) throw new Error('Google did not return an authorization code.');
            const response = await request('https://oauth2.googleapis.com/token', {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: credentials.client_id, client_secret: credentials.client_secret,
                    code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
                signal: AbortSignal.timeout(20000)
            });
            const tokens = await response.json().catch(() => ({}));
            if (!response.ok || !tokens.refresh_token) throw new Error('Google did not issue a refresh token. Check the OAuth client and consent settings, then run the helper again.');
            if (!String(tokens.scope || '').split(' ').includes('https://www.googleapis.com/auth/gmail.send')) throw new Error('Gmail send permission was not granted. Run the helper again and allow sending email.');
            const settings = { EMAIL_PROVIDER: 'gmail', EMAIL_FROM: email.toLowerCase(), GMAIL_CLIENT_ID: credentials.client_id,
                GMAIL_CLIENT_SECRET: credentials.client_secret, GMAIL_REFRESH_TOKEN: tokens.refresh_token };
            if (Object.values(settings).some((value) => typeof value !== 'string' || !/^[A-Za-z0-9@._/+\-=]+$/.test(value))) throw new Error('Google returned an unexpected credential format.');
            if (expired) throw new Error('Authorization timed out. Run the helper again.');
            fs.writeFileSync(outputFile, Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
            res.end('Gmail authorization saved. You can close this tab and return to your terminal.');
            resolveResult();
        } catch (error) {
            res.writeHead(400);
            res.end('Authorization could not be completed. Check the local terminal.');
            rejectResult(error);
        }
    });
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: credentials.client_id, redirect_uri: redirectUri, response_type: 'code',
            scope: 'https://www.googleapis.com/auth/gmail.send', access_type: 'offline', prompt: 'consent', login_hint: email,
            state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
        timer = setTimeout(() => { expired = true; rejectResult(new Error('Authorization timed out. Run the helper again.')); }, timeoutMs);
        announce(`Open this link in your browser on THIS computer and sign in as ${email}:\n${url.href}`);
        await completion;
        announce(`Saved private settings to ${outputFile}. Do not share or commit this file. See hotspot/GMAIL-SETUP.md for deployment.`);
    } finally {
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
    }
}

if (require.main === module) {
    const [credentialsFile, email, output] = process.argv.slice(2);
    if (!credentialsFile || !email || credentialsFile === '--help') {
        console.log('Usage: node scripts/setup-gmail.cjs <desktop-client.json> <sender@gmail.com> [output-file]\nDefault output: hotspot/.env.gmail (never overwrites an existing file).');
        process.exitCode = credentialsFile === '--help' ? 0 : 1;
    } else authorize({ credentialsFile, email, outputFile: path.resolve(output || 'hotspot/.env.gmail') })
        .catch(() => { console.error('Gmail setup failed. Check the Desktop OAuth JSON, granted Gmail send permission, network connection, and that the output file does not already exist. No secrets have been printed.'); process.exitCode = 1; });
}
module.exports = { authorize };
