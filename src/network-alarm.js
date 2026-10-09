export function networkFailures(data, now = Date.now()) {
  const recent = time => Number.isFinite(time) && time > 0 && now >= time && now - time <= 120000;
  const failures = [];
  if (data?.health?.internet === 'no-reply' && recent(data.health.internetCheckedAt)) {
    failures.push({ id: 'internet', message: 'Internet not replying: neither Internet ping target answered the router.' });
  }
  const stations = new Map((data?.stations || []).filter(station => ['main', 'substation'].includes(station.type)).map(station => [station.name, station]));
  for (const device of data?.devices || []) {
    const station = stations.get(device.group);
    if (station && device.status === 'no-reply' && recent(device.checkedAt)) {
      failures.push({ id: `device:${device.group}:${device.ip}`, message: `${station.type === 'main' ? 'Main station' : 'Substation'} ${station.name}: ${device.name || device.detectedName || 'Device'} (${device.ip}) is not replying.` });
    }
  }
  return failures;
}

export function createNetworkAlarm({ AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, repeat = setInterval, cancel = clearInterval, now = Date.now } = {}) {
  let context, timer, enabled = false, active = false, town, data, error = '';
  let failures = [], silenced = new Set(), sounding = false;
  const tones = new Set();
  function stop() {
    if (timer) cancel(timer);
    timer = null;
    sounding = false;
    for (const tone of tones) { try { tone.stop(); } catch {} }
    tones.clear();
  }
  function beep() {
    if (!context || context.state !== 'running') { error = 'Sound is paused by this device. Press Enable sound to resume it.'; stop(); return; }
    for (let index = 0; index < 3; index++) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const start = context.currentTime + index * 0.4;
      oscillator.type = 'sine'; oscillator.frequency.value = index % 2 ? 880 : 660;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.25);
      oscillator.connect(gain); gain.connect(context.destination);
      tones.add(oscillator);
      oscillator.onended = () => { tones.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(start + 0.3);
    }
  }
  function check() {
    failures = active ? networkFailures(data, now()) : [];
    const ids = new Set(failures.map(failure => failure.id));
    silenced = new Set([...silenced].filter(id => ids.has(id)));
    const shouldSound = enabled && active && failures.some(failure => !silenced.has(failure.id));
    if (!shouldSound) { stop(); return; }
    if (!sounding) {
      sounding = true;
      beep();
      if (sounding) timer = repeat(() => { check(); if (sounding) beep(); }, 15000);
    }
  }
  return {
    update(next, options) {
      if (town !== options.town) { stop(); silenced.clear(); }
      town = options.town; active = options.active; data = next; check();
    },
    async enable() {
      try {
        if (!AudioContextClass) throw Error('Sound alarms are unavailable on this device. Visual alerts remain active.');
        context ||= new AudioContextClass();
        await context.resume();
        if (context.state !== 'running') throw Error('Sound could not start. Press Enable sound again.');
        enabled = true; error = ''; silenced.clear(); stop(); check();
        if (active && !sounding) beep();
      } catch (failure) { enabled = false; error = failure.message; stop(); }
    },
    disable() { enabled = false; stop(); },
    silence() { failures.forEach(failure => silenced.add(failure.id)); stop(); },
    snapshot() { return { enabled, sounding, error, failures, silenced: failures.length > 0 && failures.every(failure => silenced.has(failure.id)) }; },
    leave() { active = false; stop(); },
    dispose() { active = false; enabled = false; stop(); context?.close().catch(() => {}); }
  };
}

export function renderNetworkAlarm(alarm, escapeText) {
  const state = alarm.snapshot();
  return `<section class="panel network-alarm ${state.failures.length ? 'network-alarm-triggered' : ''}"><h2>${state.failures.length ? 'Network alarm' : 'Network alarm monitor'}</h2>${state.failures.length ? `<div role="alert"><strong>${state.failures.length} failed check${state.failures.length === 1 ? '' : 's'}</strong><ul>${state.failures.map(failure => `<li>${escapeText(failure.message)}</li>`).join('')}</ul></div>` : '<p>No recent no-reply results for Internet or assigned station devices.</p>'}<p>Alerts cover Internet checks and devices assigned to main stations and substations. Sound repeats every 15 seconds until silenced or the checks recover. Keep Network monitor open.</p><div class="terminal-actions"><button type="button" class="secondary-button" id="network-alarm-enable">${state.enabled ? 'Test / resume sound' : 'Enable sound'}</button>${state.enabled ? '<button type="button" class="secondary-button" id="network-alarm-disable">Turn sound off</button>' : ''}<button type="button" class="secondary-button" id="network-alarm-silence" ${!state.failures.length || state.silenced ? 'disabled' : ''}>${state.silenced ? 'Current alarms silenced' : 'Silence current alarms'}</button></div><p role="status">${escapeText(state.error || (state.sounding ? 'Alarm sounding.' : state.silenced ? 'Current alarms silenced. New failures will sound.' : state.enabled ? 'Sound enabled.' : 'Press Enable sound to allow audible alarms on this device.'))}</p></section>`;
}
