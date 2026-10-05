// Router scheduler dates are local wall time; manager timestamps are UTC.
function wallTime(timestamp, zone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
function parseWallTime(value, zone) {
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value || '')) return null;
    const wall = value.replace(' ', 'T'), naive = Date.parse(wall + 'Z');
    if (!Number.isFinite(naive)) return null;
    const matches = new Set();
    for (const delta of [-36, 0, 36]) {
        const sample = naive + delta * 3600000;
        const offset = Date.parse(wallTime(sample, zone) + 'Z') - sample;
        const candidate = naive - offset;
        if (wallTime(candidate, zone) === wall) matches.add(candidate);
    }
    // Reject repeated/missing DST wall times instead of guessing.
    return matches.size === 1 ? [...matches][0] : null;
}
function schedulerTime(timestamp, clock) {
    const zone = clock['time-zone-name'];
    if (!zone || zone === 'manual') throw new Error('Configure a named router timezone before scheduling calendar expiry.');
    const wall = wallTime(timestamp, zone);
    if (parseWallTime(wall, zone) !== Math.floor(timestamp / 1000) * 1000) throw new Error('Expiry falls in an ambiguous router clock hour; backend expiry will retry.');
    const [date, time] = wall.split('T');
    const [year, month, day] = date.split('-');
    return { date: /^\d{4}-/.test(clock.date || '') ? date : `${['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][Number(month)-1]}/${day}/${year}`, time };
}
function firstLoginEvidence(voucher, logs, zone, now = Date.now()) {
    if (!voucher.createdAt) return null;
    const user = String(voucher.username);
    const entries = logs.map(l => ({ time: parseWallTime(l.time, zone), message: String(l.message || '') }))
        .filter(l => l.time != null && l.time >= voucher.createdAt - 120000 && l.time <= now);
    const creation = entries.filter(l => l.message.startsWith(`hotspot user ${user} added `)).sort((a,b) => a.time-b.time)[0];
    if (!creation || Math.abs(creation.time - voucher.createdAt) > 120000) return null;
    const login = entries.filter(l => l.time >= creation.time && l.message.startsWith(`${user} (`) && /\): logged in$/.test(l.message)).sort((a,b) => a.time-b.time)[0];
    return login?.time || null;
}
module.exports = { wallTime, parseWallTime, schedulerTime, firstLoginEvidence };
