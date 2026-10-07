const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('../hotspot/node_modules/express');
const { installNetworkMonitor, validIp, replies, routeInterface } = require('../hotspot/network-monitor');

async function main() {
  assert.equal(validIp('192.168.10.254'), true);
  for (const ip of ['192.168.10.0', '192.168.10.255', '192.168.1.2', '192.168.10.02', '/ping']) assert.equal(validIp(ip), false);
  assert.equal(replies([{ time: '1ms' }]), true);
  assert.equal(replies([{ status: 'timeout' }]), false);
  assert.equal(routeInterface({ active: 'true', 'immediate-gw': '10.0.0.1%ether1' }), 'ether1');
  assert.equal(routeInterface({ active: 'true', 'gateway-status': '10.0.0.1 reachable via ether2' }), 'ether2');
  assert.equal(routeInterface({ active: 'true', gateway: 'pppoe-out1' }), 'pppoe-out1');
  assert.equal(routeInterface({ active: 'false', gateway: 'ether2' }), null);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-network-'));
  const file = path.join(directory, 'inventory.json');
  const app = express(); app.use(express.json());
  let online = true, broken = false, ticks = 100000, pingCount = 0, holdResource = null;
  const monitor = installNetworkMonitor(app, (req, res, next) => req.headers.authorization === 'Bearer test' ? next() : res.sendStatus(401), {
    env: { NETWORK_INVENTORY_FILE: file, NETWORK_WAN_INTERFACE: 'pppoe-out1' }, now: () => ticks,
    router: async (command, args) => {
      if (broken) throw Error('disconnected');
      if (command === '/system/resource/print' && holdResource) return new Promise(resolve => { holdResource = resolve; });
      if (command === '/ping') {
        pingCount++;
        const address = args.find(arg => arg.startsWith('=address=')).slice(9);
        return address === '1.1.1.1' || address === '192.168.10.2' && online ? [{ time: '1ms' }] : [{ status: 'timeout' }];
      }
      if (command === '/ip/arp/print') return [{ address: '192.168.10.3', 'mac-address': 'AA:BB:CC:DD:EE:FF' }, { address: '10.0.0.2' }];
      if (command === '/ip/dhcp-server/lease/print') return [{ address: '192.168.10.3', 'host-name': 'Old EAP' }];
      if (command === '/interface/monitor-traffic') { assert.deepEqual(args, ['=interface=pppoe-out1', '=once=']); return [{ 'rx-bits-per-second': '73000000', 'tx-bits-per-second': '8000000' }]; }
      if (command === '/ip/hotspot/active/print') return Array.from({ length: 27 }, () => ({}));
      return [];
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = (endpoint, method = 'GET', body, auth = true) => fetch(`http://127.0.0.1:${server.address().port}/api/admin/network${endpoint}`, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {})
  });
  try {
    assert.equal((await request('', 'GET', null, false)).status, 401);
    assert.equal((await request('/scan', 'POST', null, false)).status, 401);
    assert.equal((await request('/internet', 'POST', null, false)).status, 401);
    assert.equal((await request('/stations', 'POST', { name: 'Main', type: 'main' }, false)).status, 401);
    assert.equal((await request('/stations', 'POST', { name: 'Other', type: 'main' })).status, 400);
    assert.equal((await request('/stations', 'POST', { name: 'Main', type: 'main' })).status, 200);
    assert.equal((await request('/stations', 'POST', { name: 'main', type: 'substation' })).status, 409);
    assert.equal((await request('/stations', 'POST', { name: 'Substation 1', type: 'substation' })).status, 200);
    assert.equal((await request('/device', 'PUT', { ip: '192.168.10.2', name: 'CPE610', group: 'Missing station' })).status, 400);
    assert.equal((await request('/device', 'PUT', { ip: '192.168.10.255', name: 'bad', group: 'Main' })).status, 400);
    await monitor.scan();
    let data = monitor.snapshot();
    assert.equal(data.progress, 254); assert.equal(data.devices.length, 2);
    assert.equal(data.health.activeUsers, 27); assert.equal(data.health.downloadMbps, 73); assert.equal(data.health.uploadMbps, 8);
    assert.equal(data.health.internet, 'online');
    assert.equal(data.devices[0].status, 'online'); assert.equal(data.devices[1].status, 'no-reply');
    assert.equal((await request('/device', 'PUT', { ip: '192.168.10.2', name: 'CPE610', group: 'Main' })).status, 200);
    holdResource = true;
    const pendingScan = monitor.scan();
    assert.equal(monitor.snapshot().devices[0].status, 'online', 'starting a scan retains the previous device status');
    assert.equal(monitor.snapshot().health.downloadMbps, 73, 'starting a scan retains previous traffic rates');
    const releaseResource = holdResource; holdResource = null; releaseResource([]); await pendingScan;
    const previousCount = pingCount;
    await request('/scan', 'POST'); assert.equal(pingCount, previousCount, 'scan is rate limited');
    online = false; ticks += 61000; await monitor.scan();
    data = monitor.snapshot();
    assert.equal(data.devices[0].name, 'CPE610'); assert.equal(data.devices[0].group, 'Main');
    assert.equal(data.devices[0].status, 'no-reply'); assert.equal(data.devices[0].lastSeenAt, 100000);
    const otherApp = express();
    const restored = installNetworkMonitor(otherApp, (_req, _res, next) => next(), { env: { NETWORK_INVENTORY_FILE: file }, router: async () => [] });
    assert.equal(restored.snapshot().devices[0].name, 'CPE610'); assert.equal(restored.snapshot().devices[0].status, 'unknown');
    assert.equal(restored.snapshot().stations[0].name, 'Main');
    assert.equal((await request('/stations', 'PUT', { previousName: 'Main', name: 'Head office', type: 'main' })).status, 200);
    assert.equal(monitor.snapshot().devices[0].group, 'Head office', 'renaming retains device assignments');
    assert.equal((await request('/stations', 'PUT', { previousName: 'Head office', name: 'Substation 1', type: 'main' })).status, 409);
    const stationCount = monitor.snapshot().stations.length;
    fs.mkdirSync(file + '.tmp');
    assert.equal((await request('/stations', 'POST', { name: 'Cannot save', type: 'substation' })).status, 500);
    assert.equal(monitor.snapshot().stations.length, stationCount, 'failed station writes roll back');
    fs.rmdirSync(file + '.tmp');
    const legacyFile = path.join(directory, 'legacy.json');
    fs.writeFileSync(legacyFile, JSON.stringify([{ ip: '192.168.10.11', name: 'CPE610', group: 'Main', lastSeenAt: 123 }]));
    const legacy = installNetworkMonitor(express(), (_req, _res, next) => next(), { env: { NETWORK_INVENTORY_FILE: legacyFile }, router: async () => [] });
    assert.equal(legacy.snapshot().devices[0].group, 'Main'); assert.equal(legacy.snapshot().devices[0].lastSeenAt, 123);
    assert.equal(legacy.snapshot().stations[0].type, 'main');
    broken = true; await monitor.scan(); data = monitor.snapshot();
    assert.equal(data.health.router, 'unknown'); assert.equal(data.health.activeUsers, null);
    assert.equal(data.devices[0].status, 'unknown'); assert.match(data.error, /failed/);
    const response = await request(''); assert.equal(response.headers.get('cache-control'), 'no-store');
    let deniedPingCount = 0;
    const denied = installNetworkMonitor(express(), (_req, _res, next) => next(), {
      env: { NETWORK_INVENTORY_FILE: path.join(directory, 'denied.json'), MIKROTIK_PASSWORD: 'private-test-secret' },
      router: async command => {
        if (command === '/ping') { deniedPingCount++; throw Error('not enough permissions private-test-secret'); }
        if (command === '/ip/arp/print') return [{ address: '192.168.10.11', 'mac-address': 'AA:BB' }];
        if (command === '/ip/route/print') return [{ active: 'true', gateway: 'pppoe-out1' }];
        if (command === '/interface/monitor-traffic') return [{ 'rx-bits-per-second': '73000000', 'tx-bits-per-second': '8000000' }];
        return [];
      }
    });
    await denied.scan();
    const deniedData = denied.snapshot();
    assert.equal(deniedPingCount, 2, 'permission rejection stops unnecessary subnet ping requests after both Internet probes');
    assert.match(deniedData.error, /test policy/); assert.ok(!deniedData.error.includes('private-test-secret'));
    assert.equal(deniedData.health.wan, 'pppoe-out1'); assert.equal(deniedData.health.downloadMbps, 73);
    assert.equal(deniedData.devices[0].ip, '192.168.10.11');
    assert.match(deniedData.devices[0].checkError, /permission denied/);
    let mode = 'fallback', targetCalls = [], releaseInternet;
    const internetOnly = installNetworkMonitor(express(), (_req, _res, next) => next(), {
      env: { NETWORK_INVENTORY_FILE: path.join(directory, 'internet.json') },
      router: async (command, args) => {
        assert.equal(command, '/ping', 'Internet check must not trigger inventory or other router commands');
        const target = args[0].slice(9); targetCalls.push(target);
        if (mode === 'hold') await new Promise(resolve => { if (!releaseInternet) releaseInternet = []; releaseInternet.push(resolve); });
        if (mode === 'broken') throw Error('connection timed out');
        if (mode === 'invalid') return {};
        return target === '8.8.8.8' && ['fallback', 'hold'].includes(mode) ? [{ time: '2ms' }] : [{ status: 'timeout' }];
      }
    });
    await internetOnly.checkInternet();
    assert.deepEqual(targetCalls, ['1.1.1.1', '8.8.8.8']);
    assert.equal(internetOnly.snapshot().health.internet, 'online');
    assert.match(internetOnly.snapshot().health.internetMessage, /8\.8\.8\.8/);
    assert.equal(internetOnly.snapshot().progress, 0); assert.equal(internetOnly.snapshot().scanning, false);
    mode = 'offline'; await internetOnly.checkInternet();
    assert.equal(internetOnly.snapshot().health.internet, 'no-reply');
    mode = 'broken'; await internetOnly.checkInternet();
    assert.equal(internetOnly.snapshot().health.internet, 'unknown');
    assert.match(internetOnly.snapshot().health.internetMessage, /connection timed out/);
    mode = 'invalid'; await internetOnly.checkInternet();
    assert.equal(internetOnly.snapshot().health.internet, 'unknown');
    assert.match(internetOnly.snapshot().health.internetMessage, /invalid ping response/);
    mode = 'hold'; targetCalls = [];
    const checkOne = internetOnly.checkInternet(), checkTwo = internetOnly.checkInternet();
    assert.equal(checkOne, checkTwo); assert.equal(targetCalls.length, 2);
    for (const release of releaseInternet) release(); await checkOne;
    assert.equal(internetOnly.snapshot().health.internetChecking, false);
    broken = false;
    const callsBefore = pingCount;
    const internetResponse = await request('/internet', 'POST');
    assert.equal(internetResponse.status, 200);
    assert.equal((await internetResponse.json()).health.internet, 'online');
    assert.equal(pingCount - callsBefore, 2, 'manual Internet check does not run a subnet scan');
    const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
    const context = vm.createContext({
      crypto: require('node:crypto').webcrypto, URL, console, setInterval() {}, setTimeout() {},
      window: { location: { protocol: 'https:', host: 'example.test', hostname: 'example.test' } },
      document: { hidden: false, querySelector: selector => selector === '#app' ? {} : selector === '#admin-login-form' ? { elements: { email: {} }, addEventListener() {} } : selector === '#login-mode' ? {} : null, querySelectorAll: () => [], addEventListener() {} },
      localStorage: { getItem: () => null, setItem() {} },
      Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}), createIcons() {}
    });
    for (const name of source.match(/import \{ (.*?) \} from 'lucide'/)[1].split(', ')) if (name !== 'createIcons') context[name] = {};
    vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
    context.fixture = { stations: [{ name: 'Main', type: 'main' }, { name: 'Substation 3', type: 'substation' }, { name: '<script>station</script>', type: 'substation' }], health: { router: 'online', internet: 'unknown', internetMessage: '<script>ping error</script>', downloadMbps: null, uploadMbps: null, activeUsers: 27 }, devices: [{ ip: '192.168.10.2', group: 'Main', name: '<script>bad</script>', status: 'no-reply' }] };
    vm.runInContext('networkData = fixture; selectedTown = "default";', context);
    const html = vm.runInContext('renderNetwork()', context);
    assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;')); assert.ok(!html.includes('<script>bad'));
    assert.ok(html.includes('NO REPLY')); assert.ok(html.includes('Unavailable'));
    assert.ok(html.includes('Substation 3')); assert.ok(html.includes('192.168.10.2'));
    assert.ok(html.includes('Check Internet')); assert.ok(html.includes('&lt;script&gt;ping error&lt;/script&gt;'));
    assert.ok(html.includes('Create station')); assert.ok(html.includes('&lt;script&gt;station&lt;/script&gt;'));
    assert.ok(html.includes('value="main"')); assert.ok(!html.includes('CPE610 · EAP110'));
    vm.runInContext('selectedTown = "all"', context);
    assert.match(vm.runInContext('renderNetwork()', context), /Select a town/);
    console.log('Network monitor checks passed: station creation/rename/persistence/migration/rollback, Internet probes, subnet scan, auth, rates and UI escaping.');
  } finally {
    server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
