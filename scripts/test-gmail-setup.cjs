const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { authorize } = require('./setup-gmail.cjs');

async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-gmail-'));
    const credentialsFile = path.join(directory, 'client.json');
    const outputFile = path.join(directory, '.env.gmail');
    fs.writeFileSync(credentialsFile, JSON.stringify({ installed: { client_id: 'client.apps.googleusercontent.com', client_secret: 'test-secret' } }));
    try {
        const logs = [];
        let getUrl;
        const announced = new Promise((resolve) => { getUrl = resolve; });
        let authorization;
        const setup = authorize({ credentialsFile, email: 'sender@gmail.com', outputFile,
            announce: (message) => { logs.push(message); if (message.includes('https://accounts.google.com/')) { authorization = new URL(message.split('\n')[1]); getUrl(); } },
            request: async (url, options) => {
                assert.equal(url, 'https://oauth2.googleapis.com/token');
                assert.equal(options.body.get('code'), 'test-code');
                assert.equal(options.body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
                assert.equal(crypto.createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
                return { ok: true, json: async () => ({ refresh_token: 'test-refresh', scope: 'https://www.googleapis.com/auth/gmail.send' }) };
            }
        });
        await announced;
        assert.equal(authorization.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.send');
        assert.equal(authorization.searchParams.get('access_type'), 'offline');
        const callback = new URL(authorization.searchParams.get('redirect_uri'));
        assert.equal(callback.hostname, '127.0.0.1');
        callback.search = new URLSearchParams({ state: 'wrong', code: 'test-code' });
        assert.equal((await fetch(callback)).status, 400);
        assert.equal(fs.existsSync(outputFile), false);
        callback.searchParams.set('state', authorization.searchParams.get('state'));
        assert.equal((await fetch(callback)).status, 200);
        await setup;
        assert.match(fs.readFileSync(outputFile, 'utf8'), /GMAIL_REFRESH_TOKEN=test-refresh/);
        assert.doesNotMatch(logs.join('\n'), /test-secret|test-refresh/);
        await assert.rejects(authorize({ credentialsFile, email: 'sender@gmail.com', outputFile }), /already exists/);
        await assert.rejects(authorize({ credentialsFile, email: 'sender@gmail.com', outputFile: outputFile + '.new', timeoutMs: 30, announce() {} }), /timed out/);
        assert.equal(fs.existsSync(outputFile + '.new'), false);
        console.log('Gmail setup checks passed: loopback callback, state, PKCE, scope, private output, overwrite protection, timeout. No Google requests.');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
