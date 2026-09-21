require('dotenv').config({ override: true });

const { RouterOSAPI } = require('routeros-client');

const api = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST || '192.168.10.1',
    user: process.env.MIKROTIK_USERNAME,
    password: process.env.MIKROTIK_PASSWORD,
    port: Number(process.env.MIKROTIK_PORT || 8728),
    timeout: Number(process.env.MIKROTIK_REQUEST_TIMEOUT_MS || 10000) / 1000
});

async function main() {
    try {
        await api.connect();
        const users = await api.write('/user/print');
        const user = users.find((row) => row.name === 'ea-payment');

        if (!user || !user['.id']) {
            throw new Error('RouterOS user ea-payment was not found.');
        }

        await api.write('/user/set', [
            `=.id=${user['.id']}`,
            '=address=10.200.0.1/32'
        ]);

        console.log('Updated ea-payment allowed address to 10.200.0.1/32.');
        await api.close();
    } catch (error) {
        console.error('Could not update RouterOS API user:', error.message || error);
        try {
            await api.close();
        } catch {}
        process.exitCode = 1;
    }
}

main();
