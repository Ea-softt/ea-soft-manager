const checks = [
  { title: 'Ping a network device', command: '/ping address=192.168.10.1 count=5', description: 'Replace the address with the device IP. Replies show reachability and delay.' },
  { title: 'Ping the Internet', command: '/ping address=8.8.8.8 count=5', description: 'Check whether the router can reach the Internet.' },
  { title: 'Active hotspot users', command: '/ip hotspot active print detail', description: 'Shows connected usernames, addresses, uptime and session-time-left when available.' },
  { title: 'Hotspot data usage', command: '/ip hotspot user print stats', description: 'Shows local hotspot user counters. Check current session traffic with /ip hotspot active print stats.' },
  { title: 'Check a hotspot user', command: '/ip hotspot user print detail where name="123"', description: 'Replace 123 with the username. Check disabled, profile and configured limits. A disabled user can also be suspended; it does not always mean expired.' },
  { title: 'Voucher expiry schedules', command: '/system scheduler print detail where name~"^EA-EXP-"', description: 'Shows manager calendar expiry schedules and next-run. For RADIUS vouchers, check expiry in Vouchers & users and session-time-left in the active session.' },
  { title: 'Router date and time', command: '/system clock print', description: 'Check the router date, time and timezone when investigating expiry.' }
];

function notesKey(workspace, account) {
  return `ea-soft-troubleshooting-notes-v1:${JSON.stringify([workspace, account])}`;
}

export function renderTroubleshootingNotes({ workspace, account, escapeText }) {
  let notes = '';
  let error = '';
  try { notes = localStorage.getItem(notesKey(workspace, account)) || ''; }
  catch { error = 'Saved notes could not be loaded on this device.'; }
  return `<div class="heading-row"><div><p class="eyebrow">ROUTER CHECKS</p><h1>Troubleshooting notes</h1><p class="subhead">Keep useful commands and your troubleshooting results.</p></div></div>
    <section class="panel troubleshooting-editor"><label for="troubleshooting-notes">Your notes</label><textarea id="troubleshooting-notes" rows="10" dir="ltr" spellcheck="false" placeholder="Record the town, username or device IP, command, result and what fixed the issue.">${escapeText(notes)}</textarea><p id="notes-save-status" role="status">${escapeText(error || 'Notes save automatically on this device for your manager account. They are not included in server backups.')}</p></section>
    <div class="troubleshooting-checks">${checks.map((check, index) => `<section class="panel"><h2>${escapeText(check.title)}</h2><p>${escapeText(check.description)}</p><pre>${escapeText(check.command)}</pre><button class="secondary-button" data-notes-command="${index}">Open in Terminal</button></section>`).join('')}</div>
    <p>Command reference: <a href="https://help.mikrotik.com/docs/spaces/ROS/pages/8323183/Ping" target="_blank" rel="noopener noreferrer">MikroTik Ping</a> · <a href="https://help.mikrotik.com/docs/spaces/ROS/pages/56459266/HotSpot%2B-%2BCaptive%2Bportal" target="_blank" rel="noopener noreferrer">MikroTik HotSpot</a></p>`;
}

export function bindTroubleshootingNotes({ workspace, account, openTerminal }) {
  const editor = document.querySelector('#troubleshooting-notes');
  if (!editor) return;
  editor.addEventListener('input', () => {
    const status = document.querySelector('#notes-save-status');
    try {
      localStorage.setItem(notesKey(workspace, account), editor.value);
      status.textContent = 'Notes saved on this device. They are not included in server backups.';
    } catch {
      status.textContent = 'Notes could not be saved. Keep a copy before leaving this page.';
    }
  });
  document.querySelectorAll('[data-notes-command]').forEach(button => {
    button.addEventListener('click', () => {
      const check = checks[Number(button.dataset.notesCommand)];
      if (check) openTerminal(check.command);
    });
  });
}
