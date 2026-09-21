require('dotenv').config({ override: true });
const { RouterOSAPI } = require('routeros-client');
const api = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USERNAME,
    password: process.env.MIKROTIK_PASSWORD,
    port: Number(process.env.MIKROTIK_PORT),
    timeout: 10
});
(async () => {
    try {
        await api.connect();
        console.log('SERVER_PROFILES', await api.write('/ip/hotspot/profile/print'));
        console.log('HOTSPOT_SERVERS', await api.write('/ip/hotspot/print'));
        await api.close();
    } catch (error) {
        console.error(error.message || error);
        try { await api.close(); } catch {}
        process.exitCode = 1;
    }
})();
