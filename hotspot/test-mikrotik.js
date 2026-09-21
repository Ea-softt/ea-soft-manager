require('dotenv').config({ override: true });

const { RouterOSAPI } = require('routeros-client');

const api = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST || '192.168.10.1',
    user: process.env.MIKROTIK_USERNAME,
    password: process.env.MIKROTIK_PASSWORD,
    port: Number(process.env.MIKROTIK_PORT || 8728),
    timeout: Number(process.env.MIKROTIK_REQUEST_TIMEOUT_MS || 10000) / 1000
});

async function test() {
    try {
        await api.connect();

        console.log('SUCCESS: Connected to MikroTik RouterOS API');

        const identity = await api.write('/system/identity/print');

        console.log('MikroTik identity:');
        console.log(identity);

        const resources = await api.write('/system/resource/print');

        console.log('RouterOS resource:');
        console.log(resources);

        await api.close();
    } catch (error) {
        console.error('MikroTik API ERROR:');
        console.error(error);

        try {
            await api.close();
        } catch {}
    }
}

test();