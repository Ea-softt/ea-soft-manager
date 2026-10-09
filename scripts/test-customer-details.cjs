const assert = require('node:assert/strict');
const express = require('../hotspot/node_modules/express');
const { installCustomerDetails, customerConnections } = require('../hotspot/customer-details');

async function main() {
  const clientMac = 'AA:BB:CC:DD:EE:01';
  const reads = [];
  const router = async (command, args) => {
    reads.push([command, args]);
    assert.ok(command.endsWith('/print'), 'Customer inspection must be read-only');
    if (command === '/ip/hotspot/active/print') return [
      { user: '123', address: '10.0.0.4', 'mac-address': clientMac, uptime: '2h', 'bytes-in': '42', 'bytes-out': '100' },
      { user: 'other', address: '10.0.0.5', 'mac-address': 'BB:BB:BB:BB:BB:BB' }
    ];
    if (command === '/ip/dhcp-server/lease/print') return [
      { 'active-address': '10.0.0.4', 'active-mac-address': clientMac.toLowerCase(), 'host-name': 'Jane-iPhone' },
      { address: '10.0.0.4', 'mac-address': 'BB:BB:BB:BB:BB:BB', 'host-name': 'Wrong-device' }
    ];
    if (command === '/interface/bridge/host/print') return [{ 'mac-address': clientMac, 'on-interface': 'ether4' }];
    if (command === '/interface/wifi/registration-table/print') return [{ 'mac-address': clientMac, interface: 'AP-market', ssid: 'EA-WiFi', signal: '-55' }];
    throw Error('no such command');
  };
  const connections = await customerConnections(router, '123');
  assert.equal(connections.connected, true);
  assert.equal(connections.sessions.length, 1);
  assert.equal(connections.sessions[0].accessPoint, 'AP-market');
  assert.equal(connections.sessions[0].deviceName, 'Jane-iPhone');
  assert.match(connections.sessions[0].deviceType, /Possible iPhone/);
  assert.equal(connections.sessions[0].bridgePort, 'ether4');
  assert.equal(connections.sessions[0].wireless.ssid, 'EA-WiFi');
  assert.ok(reads[0][1].includes('=stats='));
  assert.ok(reads[0][1].includes('?user=123'));
  const noAp = await customerConnections((command, args) => command.includes('registration-table') ? Promise.resolve([]) : router(command, args), '123');
  assert.equal(noAp.sessions[0].accessPoint, null, 'An Ethernet bridge port is not proof of the access point');
  const offline = await customerConnections(async () => [], '123');
  assert.equal(offline.connected, false);
  const failed = await customerConnections(async () => { throw Error('Router offline'); }, '123');
  assert.equal(failed.connected, null, 'A failed read cannot imply the customer is offline');
  const capRouter = async (command, args) => {
    if (command === '/interface/wifi/print') return [{ name: 'cap-guest', 'master-interface': 'cap-main' }, { name: 'other-ap' }];
    if (command === '/interface/wifi/radio/print') return [{ interface: 'cap-main', 'remote-cap-name': 'market-cap', 'radio-mac': '11:22:33:44:55:66' }];
    if (command === '/interface/wifi/capsman/remote-cap/print') return [{ 'common-name': 'market-cap', identity: 'Market roof AP', 'board-name': 'cAP ax', address: '10.0.0.20' }];
    if (command === '/interface/wifi/registration-table/print') return [{ 'mac-address': clientMac, interface: 'cap-guest' }];
    return router(command, args);
  };
  const caps = await customerConnections(capRouter, '123');
  assert.equal(caps.sessions[0].accessPoint, 'Market roof AP', 'A guest interface must resolve through its master radio to the physical AP');
  assert.equal(caps.sessions[0].accessPointDetails.model, 'cAP ax');
  assert.ok(caps.accessPoints.some(ap => ap.interface === 'other-ap'), 'Include APs even when this user is not connected to them');

  const app = express();
  app.use(express.json());
  let stored = { vouchers: [{ id: 'voucher', username: '123', password: 'secret', planId: 'daily' }], plans: [{ id: 'daily', name: 'Daily' }] };
  installCustomerDetails(app, { requireAdmin: (req, res, next) => req.headers.authorization === 'test' ? next() : res.status(401).end(),
    read: () => structuredClone(stored), save: data => { stored = structuredClone(data); }, router });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/admin/vouchers/`;
    assert.equal((await fetch(url + 'voucher/details')).status, 401);
    assert.equal((await fetch(url + 'missing/details', { headers: { authorization: 'test' } })).status, 404);
    const response = await fetch(url + 'voucher/details', { headers: { authorization: 'test' } });
    assert.match(response.headers.get('cache-control'), /no-store/);
    const body = await response.json();
    assert.equal(body.plan, 'Daily');
    assert.equal(body.customer.password, undefined);
    assert.equal(body.connections.sessions[0].accessPoint, 'AP-market');
    const put = (payload, auth = true) => fetch(url + 'voucher/details', { method: 'PUT', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'test' } : {}) }, body: JSON.stringify(payload) });
    assert.equal((await put({ action: 'device' }, false)).status, 401);
    assert.equal((await put({ action: 'device', macAddress: 'bad', deviceType: 'iPhone' })).status, 400);
    assert.equal((await put({ action: 'device', macAddress: clientMac, deviceType: 'Made up type' })).status, 400);
    assert.equal((await put({ action: 'device', macAddress: clientMac, deviceType: 'Android phone', deviceModel: 'Galaxy A15', accessPoint: 'External AP' })).status, 200);
    assert.equal((await put({ action: 'access-point', name: 'External AP', address: '10.0.0.30', model: 'EAP225' })).status, 200);
    let saved = await (await fetch(url + 'voucher/details', { headers: { authorization: 'test' } })).json();
    assert.equal(saved.connections.sessions[0].deviceType, 'Android phone', 'Manager device type overrides a hostname hint');
    assert.equal(saved.connections.sessions[0].deviceModel, 'Galaxy A15');
    assert.equal(saved.connections.sessions[0].accessPoint, 'AP-market', 'Live AP evidence must override a saved assignment after roaming');
    assert.equal(saved.savedDevices[0].accessPoint, 'External AP');
    assert.ok(saved.connections.accessPoints.some(ap => ap.name === 'External AP' && ap.model === 'EAP225'));
    assert.equal((await put({ action: 'device', macAddress: clientMac, deviceType: 'iPhone', deviceModel: 'iPhone 15', accessPoint: 'External AP' })).status, 200);
    assert.equal(stored.vouchers[0].connectionDevices.length, 1, 'Saving again updates the same MAC without duplicates');
    const { renderCustomerDetails } = await import('../src/customer-details.js');
    const html = renderCustomerDetails({ user: body.customer, data: body }, {
      escapeText: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
      formatDate: String, formatDataUsage: String, money: String, status: () => 'active'
    });
    assert.match(html, /AP-market/);
    assert.match(html, /Jane-iPhone/);
    assert.match(html, /Possible iPhone/);
    const savedHtml = renderCustomerDetails({ user: saved.customer, data: saved }, {
      escapeText: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
      formatDate: String, formatDataUsage: String, money: String, status: () => 'active'
    });
    assert.match(savedHtml, /Galaxy A15/);
    assert.match(savedHtml, /data-customer-ap/);
    assert.match(savedHtml, /Android phone/);
    body.customer.username = '<script>';
    assert.doesNotMatch(renderCustomerDetails({ user: body.customer, data: body }, {
      escapeText: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
      formatDate: String, formatDataUsage: String, money: String, status: () => 'active'
    }), /<script>/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log('Customer details checks passed: authentication, MAC matching, AP evidence, hostname hints, offline/error states, read-only requests and escaped rendering.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
