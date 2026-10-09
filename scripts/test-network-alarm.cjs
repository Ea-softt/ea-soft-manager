const assert = require('node:assert/strict');
async function main() {
  const { networkFailures, createNetworkAlarm, renderNetworkAlarm } = await import('../src/network-alarm.js');
  let now = 1000000;
  const data = { health: { internet: 'no-reply', internetCheckedAt: now }, stations: [{ name: 'Main', type: 'main' }, { name: 'Sub 1', type: 'substation' }], devices: [
    { ip: '192.168.10.2', name: 'Main AP', group: 'Main', status: 'no-reply', checkedAt: now },
    { ip: '192.168.10.3', name: 'Sub AP', group: 'Sub 1', status: 'no-reply', checkedAt: now },
    { ip: '192.168.10.4', group: 'Other', status: 'no-reply', checkedAt: now },
    { ip: '192.168.10.5', group: 'Main', status: 'unknown', checkedAt: now }
  ] };
  assert.equal(networkFailures(data, now).length, 3);
  assert.match(networkFailures(data, now)[2].message, /Substation Sub 1/);
  assert.equal(networkFailures(data, now + 120001).length, 0, 'Stale results cannot trigger alarms');
  assert.equal(networkFailures({ health: { internet: 'unknown', internetCheckedAt: now } }, now).length, 0);
  let beeps = 0, stopped = 0, repeating, timers = 0;
  class Audio {
    state = 'running'; currentTime = 0;
    async resume() {}
    async close() {}
    createOscillator() { return { frequency: {}, connect() {}, disconnect() {}, start() { beeps++; }, stop() { stopped++; } }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const alarm = createNetworkAlarm({ AudioContextClass: Audio, now: () => now, repeat: callback => { repeating = callback; timers++; return timers; }, cancel: () => { repeating = null; } });
  alarm.update(data, { active: true, town: 'default' });
  assert.equal(beeps, 0, 'Audio requires a user gesture to enable it');
  assert.equal(alarm.snapshot().failures.length, 3);
  await alarm.enable();
  assert.equal(beeps, 3);
  assert.equal(timers, 1);
  alarm.update(data, { active: true, town: 'default' });
  assert.equal(timers, 1, 'Polling does not create duplicate alarm loops');
  repeating(); assert.equal(beeps, 6);
  alarm.silence(); assert.equal(repeating, null);
  alarm.update(data, { active: true, town: 'default' });
  assert.equal(beeps, 6, 'Acknowledged failures remain silent');
  data.devices.push({ ip: '192.168.10.6', name: '<script>AP</script>', group: 'Sub 1', status: 'no-reply', checkedAt: now });
  alarm.update(data, { active: true, town: 'default' });
  assert.equal(beeps, 9, 'A new failure reactivates sound');
  const html = renderNetworkAlarm(alarm, text => text.replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
  assert.match(html, /&lt;script&gt;AP/); assert.doesNotMatch(html, /<script>/);
  data.health.internet = 'online'; data.devices.forEach(device => { device.status = 'online'; });
  alarm.update(data, { active: true, town: 'default' });
  assert.equal(alarm.snapshot().sounding, false);
  assert.equal(repeating, null);
  data.devices[0].status = 'no-reply';
  alarm.update(data, { active: true, town: 'default' });
  assert.equal(beeps, 12, 'Failure after recovery triggers a new alarm');
  alarm.leave(); assert.equal(repeating, null);
  assert.ok(stopped > 0);
  alarm.update(data, { active: false, town: 'default' });
  assert.equal(alarm.snapshot().failures.length, 0, 'No alarms outside Network monitor');
  alarm.update(data, { active: true, town: 'other' });
  assert.equal(alarm.snapshot().sounding, true);
  now += 120001; repeating();
  assert.equal(alarm.snapshot().sounding, false, 'Audio stops when the readings go stale');
  alarm.dispose();
  const unsupported = createNetworkAlarm({ AudioContextClass: null });
  await unsupported.enable(); assert.match(unsupported.snapshot().error, /unavailable/);
  console.log('Network alarm checks passed: main/substation failures, Internet outage, unknown/stale exclusions, sound opt-in, repetition, silence, recovery, new outages and page lifecycle.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
