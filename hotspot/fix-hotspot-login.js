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
        const profiles = await api.write('/ip/hotspot/profile/print');
        const profile = profiles.find((row) => row.name === 'hsprof1');
        if (!profile || !profile['.id']) {
            throw new Error('Hotspot profile hsprof1 was not found.');
        }
        await api.write('/ip/hotspot/profile/set', [
            `=.id=${profile['.id']}`,
            '=login-by=cookie,http-chap,http-pap'
        ]);
        const updated = await api.write('/ip/hotspot/profile/print');
        console.log(updated.find((row) => row.name === 'hsprof1'));
        await api.close();
    } catch (error) {
        console.error('Hotspot login configuration failed:', error.message || error);
        try { await api.close(); } catch {}
        process.exitCode = 1;
    }
})();
