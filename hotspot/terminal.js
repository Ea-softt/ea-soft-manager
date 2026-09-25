const { Client } = require('ssh2');

function sshOptions(env) {
    const fingerprint = env.MIKROTIK_SSH_HOST_SHA256 || '';
    if (!/^[a-fA-F0-9]{64}$/.test(fingerprint)) throw new Error('Configure MIKROTIK_SSH_HOST_SHA256 with the trusted router host key SHA256 hex fingerprint.');
    const username = env.MIKROTIK_SSH_USERNAME || env.MIKROTIK_USERNAME;
    const password = env.MIKROTIK_SSH_PASSWORD || env.MIKROTIK_PASSWORD;
    if (!username || !password) throw new Error('Configure MikroTik SSH credentials on the backend.');
    const port = Number(env.MIKROTIK_SSH_PORT || 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MikroTik SSH port.');
    return { host: env.MIKROTIK_HOST || '192.168.10.1', port, username, password,
        readyTimeout: 10000, hostHash: 'sha256', hostVerifier: (key) => key === fingerprint.toLowerCase() };
}

function runCommand(command, options, { ClientClass = Client, timeout = 20000, maxBytes = 262144 } = {}) {
    return new Promise((resolve) => {
        const client = new ClientClass();
        const chunks = [];
        let bytes = 0;
        let finished = false;
        const finish = (message, exitCode = null) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            client.destroy();
            resolve({ output: Buffer.concat(chunks).toString('utf8'), message, exitCode });
        };
        const timer = setTimeout(() => finish('Command timed out. It may already have changed the router; check before retrying.'), timeout);
        const collect = (data) => {
            if (finished) return;
            const buffer = Buffer.from(data);
            const remaining = maxBytes - bytes;
            chunks.push(buffer.subarray(0, remaining));
            bytes += buffer.length;
            if (bytes > maxBytes) finish('Output limit reached; output was truncated.');
        };
        client.on('error', (error) => finish(`SSH error: ${error.message}`));
        client.on('close', () => finish('SSH connection closed before completion. Check the router before retrying.'));
        client.on('ready', () => {
            if (finished) return;
            client.exec(command, (error, stream) => {
                if (finished) { stream?.destroy(); return; }
                if (error) return finish(`SSH command failed: ${error.message}`);
                stream.on('data', collect);
                stream.stderr.on('data', collect);
                stream.on('error', (err) => finish(`SSH stream error: ${err.message}`));
                stream.on('close', (code) => finish(code && code !== 0 ? `Command exited with status ${code}.` : 'Command completed.', code ?? null));
                stream.end();
            });
        });
        try { client.connect(options); }
        catch (error) { finish(`SSH connection failed: ${error.message}`); }
    });
}

function installTerminal(app, requireAdmin, { env = process.env, execute = runCommand } = {}) {
    let running = false;
    app.post('/api/admin/terminal', requireAdmin, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const command = req.body?.command;
        if (typeof command !== 'string' || !command.trim() || command.length > 4096 || /[\x00-\x1f\x7f]/.test(command)) {
            return res.status(400).json({ success: false, message: 'Enter a single-line RouterOS command (up to 4096 characters).' });
        }
        if (running) return res.status(409).json({ success: false, message: 'A terminal command is already running. Wait for it to finish.' });
        let options;
        try { options = sshOptions(env); }
        catch (error) { return res.status(503).json({ success: false, message: error.message }); }
        running = true;
        try { res.json({ success: true, ...await execute(command.trim(), options) }); }
        catch { res.status(502).json({ success: false, message: 'Terminal connection failed. Check the router before retrying.' }); }
        finally { running = false; }
    });
}

module.exports = { installTerminal, runCommand, sshOptions };
