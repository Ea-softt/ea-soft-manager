// Read-only RouterOS inspection. Never logs credentials or customer passwords.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../hotspot/package.json'));
backendRequire('dotenv').config({ path: path.resolve(__dirname, '../hotspot/.env'), override: true });
const { RouterOSAPI } = backendRequire('routeros-client');
const api = new RouterOSAPI({
  host: process.env.MIKROTIK_HOST || '192.168.10.1',
  user: process.env.MIKROTIK_USERNAME,
  password: process.env.MIKROTIK_PASSWORD,
  port: Number(process.env.MIKROTIK_PORT || 8728),
  timeout: 10
});
api.on('error', () => {});
const deadline = setTimeout(() => { console.error('Live inspection timed out; router reachability is unverified.'); process.exit(1); }, 25000);
async function read(command, properties) {
  try { return await api.write(command, [`=.proplist=${properties}`]); }
  catch (error) {
    if (error?.errno === 'UNKNOWNREPLY' && /!empty/.test(error.message || '')) return [];
    throw error;
  }
}
(async () => {
  try {
    await api.connect();
    console.log('Connected to MikroTik API. Running read-only expiry inspection.');
    const clock = await read('/system/clock/print', 'date,time,time-zone-name,gmt-offset');
    const active = await read('/ip/hotspot/active/print', 'user,uptime,session-time-left');
    const users = await read('/ip/hotspot/user/print', 'name,disabled,uptime,profile');
    const schedules = (await read('/system/scheduler/print', 'name,start-date,start-time,next-run,disabled,run-count'))
      .filter((item) => String(item.name).startsWith('EA-EXP-'));
    console.log(JSON.stringify({ clock, activeSessions: active.length, hotspotUsers: users.length, expirySchedules: schedules.length,
      activeWithoutExpirySchedule: active.filter((item) => !schedules.some((schedule) => schedule.name === `EA-EXP-${String(item.user).replace(/[^A-Za-z0-9_-]/g, '-')}`)).length,
      disabledExpirySchedules: schedules.filter((item) => item.disabled === 'true').length }, null, 2));
    const dataFile = process.env.DATA_FILE || path.resolve(__dirname, '../hotspot/data/manager.json');
    if (!fs.existsSync(dataFile)) {
      console.log('Backend manager.json is unavailable here; live payment records cannot be compared.');
      return;
    }
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const paid = (data.vouchers || []).filter((item) => item.source === 'online-payment');
    console.log(JSON.stringify({ localDataFile: dataFile, onlinePaymentVouchers: paid.length,
      onlinePaidMissingExpiry: paid.filter((item) => !item.expiresAt && active.some((session) => session.user === item.username)).length,
      expiredPaidStillConnected: paid.filter((item) => item.expiresAt && item.expiresAt <= Date.now() && active.some((session) => session.user === item.username)).length,
      note: 'Local saved records may differ from the deployed backend. This inspection does not simulate login or disconnection.' }, null, 2));
  } catch (error) {
    console.error('Live inspection failed:', error.code || error.errno || error.message);
    process.exitCode = 1;
  } finally {
    await api.close().catch(() => {});
    clearTimeout(deadline);
  }
})();
