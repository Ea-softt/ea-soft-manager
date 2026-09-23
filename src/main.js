import { createIcons, LayoutDashboard, Users, Tags, Settings, Search, Plus, Download, Upload, MoreHorizontal, Clock3, Database, Wifi, CheckCircle2, AlertTriangle, Trash2, Pencil, X, Save, CalendarDays, Smartphone, ChevronDown } from 'lucide';
import './style.css';
import './mobile.css';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

const FileExport = registerPlugin('FileExport');
const BiometricLogin = registerPlugin('BiometricLogin');
const isAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const STORAGE_KEY = 'ea-soft-manager-v1';
const DEFAULT_API_URL = 'http://104.248.239.23/api';
const defaultPlans = [
  { id: '3-hours', name: '3 Hours', period: 'hours', duration: 3, dataLimit: 5, price: 3.75, sharedUsers: 1, rateLimit: '', color: 'mint' },
  { id: 'daily', name: 'Daily', period: 'days', duration: 1, dataLimit: 11, price: 5, sharedUsers: 1, rateLimit: '', color: 'sun' },
  { id: '3-days', name: '3 Days', period: 'days', duration: 3, dataLimit: 17, price: 10, sharedUsers: 1, rateLimit: '', color: 'sky' },
  { id: '7-days', name: '7 Days', period: 'days', duration: 7, dataLimit: 33, price: 25, sharedUsers: 1, rateLimit: '', color: 'coral' },
  { id: '30-days', name: '30 Days', period: 'days', duration: 30, dataLimit: 90, price: 70, sharedUsers: 1, rateLimit: '', color: 'violet' }
];

const seedUsers = [
  { id: crypto.randomUUID(), username: 'EA-483921', password: 'Q7L2XP', phone: '0241234567', planId: 'daily', amount: 5, dataLimit: 11, createdAt: Date.now() - 86400000, expiresAt: Date.now() + 86400000, status: 'active' },
  { id: crypto.randomUUID(), username: 'EA-720184', password: 'N4K9TZ', phone: '0559876543', planId: '3-days', amount: 10, dataLimit: 17, createdAt: Date.now() - 2 * 86400000, expiresAt: Date.now() + 86400000, status: 'active' },
  { id: crypto.randomUUID(), username: 'EA-110672', password: 'V8M1RC', phone: '0204567890', planId: '3-hours', amount: 3.75, dataLimit: 5, createdAt: Date.now() - 4 * 86400000, expiresAt: Date.now() - 2 * 3600000, status: 'expired' }
];

function getDefaultApiUrl() {
  if (Capacitor.isNativePlatform()) return DEFAULT_API_URL;
  const { protocol, host, hostname } = window.location;
  if (protocol === 'http:' || protocol === 'https:') {
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      return `${protocol}//${host}`;
    }
  }
  return DEFAULT_API_URL;
}

const initialState = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.settings) {
      saved.plans = [];
      saved.users = [];
      saved.settings = { apiUrl: getDefaultApiUrl(), adminToken: '', currency: 'GH₵', ...(saved.settings || {}) };
      if (!saved.settings.apiUrl) saved.settings.apiUrl = getDefaultApiUrl();
      return saved;
    }
  } catch {}
  return { plans: defaultPlans, users: seedUsers, settings: { apiUrl: getDefaultApiUrl(), adminToken: '', currency: 'GH₵' } };
};

let state = initialState();
let authenticated = false;
let financeAvailable = false;
let hasLoadedState = false;
let syncError = '';
let accountEmail = '';
let loginMode = 'login';
let recoveryEmail = '';
let authGeneration = 0;
state.settings.adminToken = '';
state.users = [];
state.sales = [];
state.plans = [];
let activeView = 'overview';
let searchTerm = '';
let statusFilter = 'all';
let financeRange = 'daily';
let editingPlan = null;
let editingUser = null;
let bulkCreating = false;
let bulkDeleting = false;
const selectedVoucherIds = new Set();

function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: { apiUrl: state.settings.apiUrl, currency: state.settings.currency } })); }
persist();

function signOut() {
  if (authenticated) apiRequest('/api/admin/session', { method: 'DELETE' }).catch(() => {});
  authenticated = false;
  financeAvailable = false;
  hasLoadedState = false;
  syncError = '';
  accountEmail = '';
  loginMode = 'login';
  authGeneration += 1;
  state.settings.adminToken = '';
  state.users = [];
state.sales = [];
  state.plans = [];
  editingUser = null;
  editingPlan = null;
  selectedVoucherIds.clear();
  activeView = 'overview';
  persist();
  render();
}

function renderLogin() {
  const recovering = loginMode === 'forgot';
  const resetting = loginMode === 'reset';
  const title = recovering ? 'Forgot password' : resetting ? 'Reset password' : 'Admin sign in';
  document.querySelector('#app').innerHTML = `<main class="login-page"><form class="panel settings-panel login-card" id="admin-login-form"><p class="eyebrow">EA-SOFT MANAGER</p><h1>${title}</h1><p>${recovering ? 'Enter your account email to receive a reset code.' : resetting ? 'Enter the code from your email and choose a new password.' : 'Sign in to manage vouchers, plans, and finances.'}</p><label>Email<input name="email" type="email" required autocomplete="username" maxlength="254" /></label>${resetting ? '<label>Reset code<input name="code" required autocomplete="one-time-code" maxlength="12" /></label>' : ''}${!recovering ? `<label>${resetting ? 'New password' : 'Password'}<input name="password" type="password" required ${resetting ? 'minlength="12"' : ''} maxlength="256" autocomplete="${resetting ? 'new-password' : 'current-password'}" /></label>` : ''}${resetting ? '<label>Confirm password<input name="confirmPassword" type="password" required minlength="12" maxlength="256" autocomplete="new-password" /></label>' : ''}<div id="biometric-controls"></div><p id="login-error" role="status" aria-live="polite"></p><button class="primary-button full-button" type="submit">${recovering ? 'Send reset code' : resetting ? 'Save new password' : 'Sign in'}</button><button class="text-button" type="button" id="login-mode">${loginMode === 'login' ? 'Forgot password?' : 'Back to sign in'}</button>${recovering ? '<button class="text-button" type="button" id="have-code">I already have a reset code</button>' : ''}</form></main>`;
  const form = document.querySelector('#admin-login-form');
  form.elements.email.value = recoveryEmail;
  if (isAndroid() && loginMode === 'login') refreshBiometricControls(form);
  document.querySelector('#login-mode').onclick = () => { loginMode = loginMode === 'login' ? 'forgot' : 'login'; renderLogin(); };
  const haveCode = document.querySelector('#have-code');
  if (haveCode) haveCode.onclick = () => { recoveryEmail = form.elements.email.value; loginMode = 'reset'; renderLogin(); };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const errorText = form.querySelector('#login-error');
    button.disabled = true;
    errorText.textContent = '';
    const email = form.elements.email.value.trim();
    try {
      if (recovering) {
        const result = await apiRequest('/api/admin/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        recoveryEmail = email;
        loginMode = 'reset';
        renderLogin();
        document.querySelector('#login-error').textContent = result.message;
      } else if (resetting) {
        const password = form.elements.password.value;
        if (password !== form.elements.confirmPassword.value) throw new Error('Passwords do not match.');
        await apiRequest('/api/admin/reset-password', { method: 'POST', body: JSON.stringify({ email, code: form.elements.code.value, password }) });
        if (isAndroid()) await BiometricLogin.clear().catch(() => {});
        recoveryEmail = email;
        loginMode = 'login';
        renderLogin();
        document.querySelector('#login-error').textContent = 'Password updated. Sign in with your new password.';
      } else {
        const result = await apiRequest('/api/admin/session', { method: 'POST', body: JSON.stringify({ email, password: form.elements.password.value }) });
        if (isAndroid() && document.querySelector('#enable-fingerprint')?.checked) {
          try { await BiometricLogin.save({ email, password: form.elements.password.value, apiUrl: apiUrl() }); }
          catch (error) { alert('Signed in, but fingerprint setup was not completed: ' + error.message); }
        }
        state.settings.adminToken = result.token;
        accountEmail = result.email;
        authenticated = true;
        recoveryEmail = '';
        persist();
        render();
        await refreshVoucherStatus();
      }
    } catch (error) {
      errorText.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
async function refreshBiometricControls(form) {
  try {
    const status = await BiometricLogin.status();
    if (document.querySelector('#admin-login-form') !== form || loginMode !== 'login') return;
    const controls = document.querySelector('#biometric-controls');
    if (!controls) return;
    controls.innerHTML = status.available
      ? `${status.enabled ? '<button type="button" class="secondary-button full-button" id="fingerprint-login">Sign in with fingerprint</button>' : ''}<label class="biometric-option"><input type="checkbox" id="enable-fingerprint" />${status.enabled ? 'Update saved fingerprint login after signing in' : 'Enable fingerprint sign-in on this phone'}</label>`
      : `<p>${escapeText(status.message || 'Fingerprint sign-in is unavailable. Use your password.')}</p>`;
    document.querySelector('#fingerprint-login')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const message = form.querySelector('#login-error');
      const submit = form.querySelector('button[type="submit"]');
      button.disabled = true;
      submit.disabled = true;
      message.textContent = '';
      try {
        const credentials = await BiometricLogin.unlock();
        if (document.querySelector('#admin-login-form') !== form || loginMode !== 'login') return;
        if (credentials.apiUrl !== apiUrl()) throw new Error('The server connection changed. Sign in with your password and enable fingerprint again.');
        const result = await apiRequest('/api/admin/session', { method: 'POST', body: JSON.stringify({ email: credentials.email, password: credentials.password }) });
        if (document.querySelector('#admin-login-form') !== form || loginMode !== 'login') return;
        state.settings.adminToken = result.token;
        accountEmail = result.email;
        authenticated = true;
        persist();
        render();
        await refreshVoucherStatus();
      } catch (error) {
        if (error.status === 401) await BiometricLogin.clear().catch(() => {});
        message.textContent = error.message;
        await refreshBiometricControls(form);
      } finally { button.disabled = false; submit.disabled = false; }
    });
  } catch { /* Password login remains available if the native plugin is unavailable. */ }
}

function apiUrl(pathname = '') { return `${state.settings.apiUrl.trim().replace(/\/+$/, '').replace(/\/api$/i, '')}${pathname}`; }
function hasRemoteApi() { return Boolean(state.settings.apiUrl && state.settings.adminToken); }
async function apiRequest(pathname, options = {}) {
  const generation = authGeneration;
  let endpoint;
  try {
    endpoint = new URL(apiUrl(pathname));
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error();
  } catch {
    throw new Error('The server connection is not configured correctly. Contact the administrator.');
  }
  if (!Capacitor.isNativePlatform() && window.location.protocol === 'https:' && endpoint.protocol === 'http:') {
    throw new Error('The manager is open over HTTPS, but the API URL uses HTTP. The browser blocks this connection. Set the Manager API URL to the HTTPS address of your backend.');
  }
  let response;
  try {
    const headers = { 'Content-Type': 'application/json', ...(state.settings.adminToken ? { Authorization: `Bearer ${state.settings.adminToken}` } : {}), ...(options.headers || {}) };
    if (Capacitor.isNativePlatform()) {
      const result = await CapacitorHttp.request({ url: endpoint.href, method: options.method || 'GET', headers, data: options.body ? JSON.parse(options.body) : undefined, connectTimeout: 15000, readTimeout: 60000 });
      response = { status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => typeof result.data === 'string' ? JSON.parse(result.data) : result.data };
    } else {
      response = await fetch(endpoint.href, { ...options, headers });
    }
  } catch {
    throw new Error(`Cannot reach ${endpoint.origin}${endpoint.pathname}. Check your connection or contact the administrator. If the backend is reachable, check its HTTPS certificate and CORS settings.`);
  }
  const data = await response.json().catch(() => ({}));
  if (generation !== authGeneration) throw new Error('You have signed out. Sign in again to continue.');
  if (response.status === 401) {
    if (authenticated) signOut();
    const error = new Error(data.message || 'Your session has expired. Please sign in again.');
    error.status = 401;
    throw error;
  }
  if (response.status === 404) throw new Error(`The backend at ${endpoint.origin} is missing ${endpoint.pathname}. Install the updated server.js, admin-auth.js, package.json, and package-lock.json, run npm install, then restart the backend.`);
  if (!response.ok || data.success === false) throw new Error(data.message || `API request failed (${response.status})`);
  return data;
}
async function syncRemoteState() {
  if (!hasRemoteApi()) throw new Error('Sign in to connect to your workspace.');
  const remote = await apiRequest('/api/admin/state');
  if (bulkCreating || bulkDeleting) return;
  if (!Array.isArray(remote.plans) || !Array.isArray(remote.users)) throw new Error('The backend returned an invalid workspace response.');
  financeAvailable = Array.isArray(remote.sales);
  if (financeAvailable) state.sales = remote.sales;
  hasLoadedState = true;
  syncError = remote.warning || '';
  state.plans = remote.plans;
  state.users = remote.users;
  persist();
}
function money(value) { return `${state.settings.currency}${Number(value).toFixed(2)}`; }
function formatDate(value) {
  if (value == null || value === '') return 'Awaiting first login';
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Expiry unavailable';
  return new Intl.DateTimeFormat('en-GH', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}
function getPlan(id) { return state.plans.find((plan) => plan.id === id); }
function refreshStatus() {
  // MikroTik-sourced vouchers carry an authoritative status from RouterOS; only
  // vouchers we manage locally should be flipped by the local expiry clock.
  state.users = state.users.map((user) => (user.source === 'mikrotik' || user.provisioning === 'pending' ? user : { ...user, status: user.status === 'expired' || (user.expiresAt != null && user.expiresAt <= Date.now()) ? 'expired' : 'active' }));
  persist();
}
function icon(name, size = 18) {
  const iconName = name.replace(/[A-Z]/g, (letter, index) => `${index ? '-' : ''}${letter.toLowerCase()}`);
  return `<i data-lucide="${iconName}" width="${size}" height="${size}"></i>`;
}

function render() {
  if (!authenticated) { renderLogin(); return; }
  for (const id of selectedVoucherIds) { if (!state.users.some((user) => user.id === id)) selectedVoucherIds.delete(id); }
  refreshStatus();
  const activeUsers = state.users.filter((user) => user.status === 'active').length;
  const revenue = financeAvailable ? state.sales.reduce((total, user) => total + Number(user.amount || 0), 0) : null;
  const expiring = state.users.filter((user) => user.status === 'active' && user.expiresAt != null && user.expiresAt - Date.now() < 86400000).length;

  document.querySelector('#app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">EA</span><div><strong>EA-Soft</strong><small>Manager</small></div></div>
        <nav class="nav-list">
          ${navItem('overview', 'LayoutDashboard', 'Overview')}
          ${navItem('users', 'Users', 'Vouchers & users')}
          ${navItem('plans', 'Tags', 'Plans & pricing')}
          ${navItem('finances', 'CalendarDays', 'Finances')}
          ${navItem('settings', 'Settings', 'Settings')}
        </nav>
        <div class="sidebar-foot"><span class="status-dot"></span> Admin workspace</div>
      </aside>
      <main class="main-content">
        <header class="topbar"><div class="mobile-brand">EA-Soft <span>Manager</span></div><div class="top-actions"><button class="icon-button" data-action="export" title="Export backup">${icon('Download')}</button><button class="secondary-button" data-action="sign-out">Sign out</button></div></header>
        <section class="page-wrap">${syncError ? `<p class="panel" role="alert">${escapeText(syncError)}</p>` : ''}${hasLoadedState && !financeAvailable ? '<p class="panel" role="status">Your backend needs the finance update. Available vouchers and plans are shown; revenue and voucher deletion are unavailable until it is updated.</p>' : ''}${hasLoadedState || activeView === 'settings' ? renderView({ activeUsers, revenue, expiring }) : '<section class="panel"><h2>Loading your records</h2><p>No data has loaded yet. A connection error does not mean your records were deleted.</p><button class="secondary-button" data-action="sync">Retry</button></section>'}</section>
      </main>
    </div>
    ${renderModal()}`;
  createIcons({ icons: { LayoutDashboard, Users, Tags, Settings, Search, Plus, Download, Upload, MoreHorizontal, Clock3, Database, Wifi, CheckCircle2, AlertTriangle, Trash2, Pencil, X, Save, CalendarDays, Smartphone, ChevronDown } });
  bindEvents();
}

function navItem(view, iconName, label) { return `<button class="nav-item ${activeView === view ? 'active' : ''}" data-view="${view}">${icon(iconName)}<span>${label}</span></button>`; }
function renderView(stats) {
  if (activeView === 'users') return renderUsers();
  if (activeView === 'plans') return renderPlans();
  if (activeView === 'finances') return renderFinances();
  if (activeView === 'settings') return renderSettings();
  return renderOverview(stats);
}
function startOfDay(date = new Date()) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek(date = new Date()) { const d = new Date(date); const offset = (d.getDay() + 6) % 7; d.setDate(d.getDate() - offset); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfMonth(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), 1).getTime(); }
function startOfYear(date = new Date()) { return new Date(date.getFullYear(), 0, 1).getTime(); }
function usersInRange(from, to) { return state.sales.filter((user) => user.createdAt >= from && user.createdAt < to); }
function rangeStats(from, to) { const users = usersInRange(from, to); return { revenue: users.reduce((total, user) => total + Number(user.amount || 0), 0), count: users.length }; }
function financeBuckets(range) {
  const now = new Date();
  const buckets = [];
  if (range === 'daily') {
    for (let i = 6; i >= 0; i -= 1) { const day = new Date(now); day.setDate(day.getDate() - i); const from = startOfDay(day); const to = from + 86400000; buckets.push({ label: new Intl.DateTimeFormat('en-GH', { weekday: 'short', day: 'numeric' }).format(day), from, to }); }
  } else if (range === 'weekly') {
    for (let i = 7; i >= 0; i -= 1) { const day = new Date(now); day.setDate(day.getDate() - i * 7); const from = startOfWeek(day); const to = from + 7 * 86400000; buckets.push({ label: `Wk ${new Intl.DateTimeFormat('en-GH', { month: 'short', day: 'numeric' }).format(new Date(from))}`, from, to }); }
  } else if (range === 'monthly') {
    for (let i = 11; i >= 0; i -= 1) { const month = new Date(now.getFullYear(), now.getMonth() - i, 1); const from = month.getTime(); const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime(); buckets.push({ label: new Intl.DateTimeFormat('en-GH', { month: 'short', year: '2-digit' }).format(month), from, to }); }
  } else {
    for (let i = 4; i >= 0; i -= 1) { const year = now.getFullYear() - i; const from = new Date(year, 0, 1).getTime(); const to = new Date(year + 1, 0, 1).getTime(); buckets.push({ label: String(year), from, to }); }
  }
  return buckets.map((bucket) => ({ ...bucket, ...rangeStats(bucket.from, bucket.to) }));
}
function financeRangeTab(range, label) { return `<button class="${financeRange === range ? 'primary-button' : 'secondary-button'}" data-action="finance-range" data-id="${range}">${label}</button>`; }
function escapeText(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function renderFinances() {
  if (!financeAvailable) return '<section class="panel"><h1>Finance history unavailable</h1><p>Install the finance update on the backend to load permanent sales records. No zero balances are being reported.</p></section>';
  const now = new Date();
  const summary = [
    { label: 'Today', ...rangeStats(startOfDay(now), startOfDay(now) + 86400000), color: 'mint' },
    { label: 'This week', ...rangeStats(startOfWeek(now), startOfWeek(now) + 7 * 86400000), color: 'sun' },
    { label: 'This month', ...rangeStats(startOfMonth(now), new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()), color: 'sky' },
    { label: 'This year', ...rangeStats(startOfYear(now), new Date(now.getFullYear() + 1, 0, 1).getTime()), color: 'coral' }
  ];
  const buckets = financeBuckets(financeRange);
  return `<div class="heading-row"><div><p class="eyebrow">FINANCES</p><h1>Revenue statistics</h1><p class="subhead">Recorded sales remain in your finances after vouchers are activated, expire, or are deleted.</p></div></div>
    <div class="stat-grid">${summary.map((item) => `<div class="stat-card ${item.color}"><span class="stat-icon">${icon('Database')}</span><p>${item.label}</p><strong>${money(item.revenue)}</strong><small>${item.count} voucher${item.count === 1 ? '' : 's'}</small></div>`).join('')}</div>
    <section class="panel table-panel"><div class="panel-head"><div><p class="eyebrow">BREAKDOWN</p><h2>Revenue by period</h2></div><div class="toolbar">${financeRangeTab('daily', 'Daily')}${financeRangeTab('weekly', 'Weekly')}${financeRangeTab('monthly', 'Monthly')}${financeRangeTab('yearly', 'Yearly')}</div></div><div class="table-scroll"><table><thead><tr><th>Period</th><th>Vouchers</th><th>Revenue</th></tr></thead><tbody>${buckets.map((bucket) => `<tr><td>${bucket.label}</td><td>${bucket.count}</td><td>${money(bucket.revenue)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function renderOverview({ activeUsers, revenue, expiring }) {
  const recent = [...state.users].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  return `<div class="heading-row"><div><p class="eyebrow">CONTROL ROOM</p><h1>Good morning, EA-Soft.</h1><p class="subhead">A clear view of your hotspot business, vouchers, and plan performance.</p></div><button class="primary-button" data-action="new-user">${icon('Plus')} New voucher</button></div>
    <div class="stat-grid"><div class="stat-card mint"><span class="stat-icon">${icon('Wifi')}</span><p>Active vouchers</p><strong>${activeUsers}</strong><small>Currently valid</small></div><div class="stat-card sun"><span class="stat-icon">${icon('Database')}</span><p>Total revenue</p><strong>${revenue === null ? 'Unavailable' : money(revenue)}</strong><small>All recorded sales</small></div><div class="stat-card sky"><span class="stat-icon">${icon('Clock3')}</span><p>Expiring soon</p><strong>${expiring}</strong><small>Within 24 hours</small></div><div class="stat-card coral"><span class="stat-icon">${icon('Users')}</span><p>All customers</p><strong>${state.users.length}</strong><small>Voucher records</small></div></div>
    <div class="content-grid"><section class="panel wide-panel"><div class="panel-head"><div><p class="eyebrow">LATEST ACTIVITY</p><h2>Recent vouchers</h2></div><button class="text-button" data-view="users">View all ${icon('ChevronDown')}</button></div>${userTable(recent)}</section><section class="panel"><div class="panel-head"><div><p class="eyebrow">YOUR CATALOG</p><h2>Plans</h2></div><button class="icon-button small" data-action="new-plan">${icon('Plus')}</button></div><div class="mini-plans">${state.plans.slice(0, 5).map(planMini).join('')}</div></section></div>`;
}
function renderUsers() {
  const filtered = state.users.filter((user) => `${user.username} ${user.phone} ${getPlan(user.planId)?.name || ''}`.toLowerCase().includes(searchTerm.toLowerCase()) && (statusFilter === 'all' || user.status === statusFilter));
  return `<div class="heading-row"><div><p class="eyebrow">CUSTOMER LEDGER</p><h1>Vouchers & users</h1><p class="subhead">Every credential, payment, limit, and expiry in one place.</p></div><button class="primary-button" data-action="new-user">${icon('Plus')} New voucher</button></div><div class="toolbar"><label class="search-box">${icon('Search')}<input id="user-search" value="${searchTerm}" placeholder="Search username, phone, or plan" /></label><select id="status-filter"><option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All statuses</option><option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option><option value="expired" ${statusFilter === 'expired' ? 'selected' : ''}>Expired</option></select><button class="secondary-button" data-action="bulk-users">${icon('Plus')} Bulk vouchers</button><button class="secondary-button" data-action="bulk-delete" ${selectedVoucherIds.size && !bulkDeleting ? '' : 'disabled'}>${icon('Trash2')} ${bulkDeleting ? 'Deleting…' : 'Delete selected (' + selectedVoucherIds.size + ')'}</button><button class="secondary-button" data-action="export">${icon('Download')} Export</button></div><section class="panel table-panel">${userTable(filtered, true)}</section>`;
}
function userTable(users, full = false) {
  if (!users.length) return '<div class="empty-state">No voucher records match this view.</div>';
  return `<div class="table-scroll"><table><thead><tr>${full ? '<th><input type="checkbox" id="select-all-vouchers" aria-label="Select all visible vouchers" ' + (users.every((user) => selectedVoucherIds.has(user.id)) ? 'checked' : '') + (bulkDeleting ? ' disabled' : '') + '></th>' : ''}<th>Customer</th><th>Plan</th><th>Amount</th><th>Expiry</th><th>Status</th><th></th></tr></thead><tbody>${users.map((user) => `<tr>${full ? '<td><input type="checkbox" data-select-voucher="' + user.id + '" aria-label="Select ' + user.username + '" ' + (selectedVoucherIds.has(user.id) ? 'checked' : '') + (bulkDeleting ? ' disabled' : '') + '></td>' : ''}<td><div class="user-cell"><span class="user-badge">${user.username.slice(-2)}</span><div><strong>${user.username}</strong><small>${user.phone || 'No phone saved'} · ${user.password}</small></div></div></td><td>${getPlan(user.planId)?.name || 'Custom'}<small class="table-note">${user.dataLimit} GB</small></td><td>${money(user.amount)}</td><td>${user.activatedAt && !user.expiresAt ? 'Active ? expiry unavailable' : formatDate(user.expiresAt)}</td><td><span class="pill ${user.status}">${user.provisioning === 'pending' ? 'Paid ? activation pending' : user.status === 'active' ? 'Active' : 'Expired'}</span></td><td><div class="row-actions"><button class="icon-button small" data-action="edit-user" data-id="${user.id}" title="Edit voucher">${icon('Pencil', 16)}</button><button class="icon-button small" data-action="delete-user" data-id="${user.id}" title="Delete voucher">${icon('Trash2', 16)}</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
function planMini(plan) { return `<div class="mini-plan"><span class="plan-color ${plan.color}"></span><div><strong>${plan.name}</strong><small>${plan.dataLimit} GB · ${plan.duration} ${plan.period}</small></div><b>${money(plan.price)}</b></div>`; }
function renderPlans() { return `<div class="heading-row"><div><p class="eyebrow">PRODUCT CATALOG</p><h1>Plans & pricing</h1><p class="subhead">Change price, data limit, and time limit without touching the hotspot portal.</p></div><button class="primary-button" data-action="new-plan">${icon('Plus')} Add plan</button></div><div class="plan-grid">${state.plans.map((plan) => `<article class="plan-card ${plan.color}"><div class="plan-card-top"><span class="plan-color"></span><div class="row-actions"><button class="icon-button small" data-action="edit-plan" data-id="${plan.id}" title="Edit plan">${icon('Pencil', 16)}</button><button class="icon-button small" data-action="delete-plan" data-id="${plan.id}" title="Delete plan">${icon('Trash2', 16)}</button></div></div><h2>${plan.name}</h2><p class="plan-price">${money(plan.price)}</p><div class="plan-meta"><span>${icon('Database', 15)} ${plan.dataLimit} GB</span><span>${icon('Clock3', 15)} ${plan.duration} ${plan.period}</span><span>Shared: ${plan.sharedUsers || 1}</span><span>${plan.rateLimit || 'No rate limit'}</span></div></article>`).join('')}</div>`; }
function renderSettings() {
  return `<div class="heading-row"><div><p class="eyebrow">WORKSPACE</p><h1>Settings</h1><p class="subhead">Manage your admin account and workspace preferences.</p></div></div><section class="panel settings-panel"><h2>Admin account</h2><form id="account-form" class="settings-panel"><label>Email / username<input name="email" type="email" required maxlength="254" autocomplete="username" /></label><label>Current password<input name="currentPassword" type="password" required maxlength="256" autocomplete="current-password" /></label><label>New password (optional)<input name="newPassword" type="password" minlength="12" maxlength="256" autocomplete="new-password" /></label><label>Confirm new password<input name="confirmPassword" type="password" maxlength="256" autocomplete="new-password" /></label><p>Your email is your username and receives password-reset codes. Use at least 12 characters for a new password. Saving signs out all sessions.</p><p id="account-message" role="status" aria-live="polite"></p><button class="primary-button" type="submit">Update account</button></form>${isAndroid() ? '<h2>Fingerprint sign-in</h2><p>Enable it from the sign-in screen after entering your password. Turning it off removes the saved login from this phone.</p><button class="secondary-button" data-action="disable-fingerprint">Disable fingerprint sign-in</button>' : ''}<h2>Recover a hotspot payment</h2><p>Enter a successful Paystack reference to verify and recover a missing purchase.</p><label>Payment reference<input id="payment-reference" /></label><button class="secondary-button" data-action="recover-payment">Recover payment</button><h2>Workspace</h2><label>Currency<input id="currency-input" maxlength="4" /></label><div class="settings-actions"><button class="secondary-button" data-action="import">${icon('Upload')} Import backup</button><button class="primary-button" data-action="save-settings">${icon('Save')} Save settings</button></div></section>`;
}
async function saveAccount(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  const message = form.querySelector('#account-message');
  button.disabled = true;
  try {
    const fields = Object.fromEntries(new FormData(form));
    if (fields.newPassword !== fields.confirmPassword) throw new Error('Passwords do not match.');
    await apiRequest('/api/admin/account', { method: 'PUT', body: JSON.stringify(fields) });
    if (isAndroid()) await BiometricLogin.clear().catch(() => {});
    recoveryEmail = fields.email;
    signOut();
    document.querySelector('#login-error').textContent = 'Account updated. Sign in with your updated details.';
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
}
function renderModal() {
  if (editingUser?.bulk) {
    return `<div class="modal-backdrop"><form class="modal" id="bulk-user-form"><button type="button" class="close-button" data-action="close-modal">${icon('X')}</button><p class="eyebrow">BULK VOUCHERS</p><h2>Create bulk vouchers</h2><label>Plan / package<select name="planId" required>${state.plans.map((plan) => `<option value="${plan.id}">${plan.name} · ${plan.dataLimit} GB · ${plan.duration} ${plan.period} · ${money(plan.price)}</option>`).join('')}</select></label><div class="form-row"><label>Quantity<input name="quantity" type="number" min="1" max="100" step="1" value="10" required /></label><label>Amount paid per voucher<input name="amount" type="number" min="0" step="0.01" value="0" required /></label></div><label>Mobile number (optional)<input name="phone" /></label><p>Leave amount paid at zero for future sales. Connected vouchers start validity on first login.</p><label><span><input name="download" type="checkbox" checked /> Download credentials as CSV</span></label><p id="bulk-progress" role="status" aria-live="polite"></p><button class="primary-button full-button" type="submit" ${state.plans.length ? '' : 'disabled'}>${icon('Save')} Create vouchers</button></form></div>`;
  }
  if (editingUser) {
    const user = editingUser;
    const isEditing = Boolean(user.id);
    return `<div class="modal-backdrop"><form class="modal" id="user-form"><button type="button" class="close-button" data-action="close-modal">${icon('X')}</button><p class="eyebrow">VOUCHER RECORD</p><h2>${isEditing ? 'Edit voucher' : 'Create voucher'}</h2><div class="form-row"><label>Username<input name="username" value="${user.username || ''}" placeholder="EA-123456" required ${isEditing ? 'readonly' : ''} /></label><label>Password<input name="password" value="${user.password || ''}" placeholder="ABC123" required ${isEditing ? 'readonly' : ''} /></label></div><label>Customer mobile number<input name="phone" value="${user.phone || ''}" placeholder="0241234567" required /></label><div class="form-row"><label>Plan<select name="planId" ${isEditing ? 'disabled' : ''}>${state.plans.map((plan) => `<option value="${plan.id}" ${user.planId === plan.id ? 'selected' : ''}>${plan.name}</option>`).join('')}</select></label><label>Amount paid<input name="amount" type="number" min="0" step="0.01" value="${user.amount ?? ''}" required /></label></div><button class="primary-button full-button" type="submit">${icon('Save')} ${isEditing ? 'Update voucher' : 'Save voucher'}</button></form></div>`;
  }
  if (!editingPlan) return '';
  const plan = editingPlan;
  return `<div class="modal-backdrop"><form class="modal" id="plan-form"><button type="button" class="close-button" data-action="close-modal">${icon('X')}</button><p class="eyebrow">PLAN EDITOR</p><h2>${plan.id ? 'Edit plan' : 'Add plan'}</h2><label>Plan name<input name="name" value="${plan.name || ''}" required /></label><div class="form-row"><label>Price<input name="price" type="number" min="0" step="0.01" value="${plan.price || ''}" required /></label><label>Data limit (GB)<input name="dataLimit" type="number" min="0" step="0.1" value="${plan.dataLimit || ''}" required /></label></div><div class="form-row"><label>Time limit<input name="duration" type="number" min="1" value="${plan.duration || 1}" required /></label><label>Unit<select name="period"><option value="hours" ${plan.period === 'hours' ? 'selected' : ''}>Hours</option><option value="days" ${plan.period === 'days' ? 'selected' : ''}>Days</option><option value="weeks" ${plan.period === 'weeks' ? 'selected' : ''}>Weeks</option><option value="months" ${plan.period === 'months' ? 'selected' : ''}>Months</option></select></label></div><div class="form-row"><label>Shared users<input name="sharedUsers" type="number" min="1" step="1" value="${plan.sharedUsers || 1}" required /></label><label>Rate limit<input name="rateLimit" value="${plan.rateLimit || ''}" placeholder="e.g. 5M/5M" /></label></div><button class="primary-button full-button" type="submit">${icon('Save')} Save plan</button></form></div>`;
}
function bindEvents() { const accountForm = document.querySelector('#account-form'); if (accountForm) { accountForm.elements.email.value = accountEmail; accountForm.addEventListener('submit', saveAccount); document.querySelector('#currency-input').value = state.settings.currency; } document.querySelectorAll('[data-view]').forEach((el) => el.onclick = () => { if (bulkCreating || bulkDeleting) return; activeView = el.dataset.view; render(); }); document.querySelectorAll('[data-action]').forEach((el) => el.onclick = () => handleAction(el.dataset.action, el.dataset.id)); document.querySelector('#user-search')?.addEventListener('input', (e) => { searchTerm = e.target.value; render(); document.querySelector('#user-search')?.focus(); }); document.querySelector('#status-filter')?.addEventListener('change', (e) => { statusFilter = e.target.value; render(); }); document.querySelector('#plan-form')?.addEventListener('submit', savePlan); document.querySelector('#user-form')?.addEventListener('submit', saveUser); document.querySelector('#bulk-user-form')?.addEventListener('submit', saveBulkUsers); bindVoucherSelection(); }
async function handleAction(action, id) { if (!authenticated) return; if (action === 'disable-fingerprint') { try { await BiometricLogin.clear(); alert('Fingerprint sign-in disabled on this phone.'); } catch (error) { alert(error.message); } return; } if (action === 'recover-payment') { const reference = document.querySelector('#payment-reference').value.trim(); if (!reference) return; try { await apiRequest('/api/admin/reconcile-payment', { method: 'POST', body: JSON.stringify({ reference }) }); await syncRemoteState(); alert('Payment verified and recorded.'); } catch (error) { alert(error.message); } render(); return; } if (action === 'sign-out') { if (!bulkCreating && !bulkDeleting) signOut(); return; } if (bulkCreating || bulkDeleting) return; if (action === 'bulk-delete') { await deleteSelectedVouchers(); return; } if (action === 'bulk-users') editingUser = { bulk: true }; if (action === 'new-plan') editingPlan = { name: '', price: 0, dataLimit: 1, duration: 1, period: 'days', sharedUsers: 1, rateLimit: '', color: 'mint' }; if (action === 'edit-plan') editingPlan = { ...getPlan(id) }; if (action === 'new-user') editingUser = { username: `EA-${Math.floor(100000 + Math.random() * 900000)}`, password: Math.random().toString(36).slice(2, 8).toUpperCase(), planId: state.plans[0]?.id, amount: state.plans[0]?.price || 0 }; if (action === 'edit-user') editingUser = { ...state.users.find((user) => user.id === id) }; if (action === 'close-modal') { editingPlan = null; editingUser = null; } if (action === 'delete-plan' && confirm('Delete this plan?')) { const plans = state.plans.filter((plan) => plan.id !== id); if (hasRemoteApi()) await apiRequest('/api/admin/plans', { method: 'PUT', body: JSON.stringify({ plans }) }); state.plans = plans; persist(); } if (action === 'delete-user') { await deleteVoucher(id); return; } if (action === 'finance-range') financeRange = id; if (action === 'export') await exportBackup(); if (action === 'import') importBackup(); if (action === 'save-settings') await saveSettings(); if (action === 'sync') { try { await syncRemoteState(); alert('Backend connected and data synchronized.'); } catch (error) { alert(error.message); } } render(); }
async function savePlan(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); const plan = { ...editingPlan, ...data, price: Number(data.price), dataLimit: Number(data.dataLimit), duration: Number(data.duration), sharedUsers: Number(data.sharedUsers), rateLimit: data.rateLimit.trim(), id: editingPlan.id || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), color: editingPlan.color || 'mint' }; state.plans = editingPlan.id ? state.plans.map((item) => item.id === editingPlan.id ? plan : item) : [...state.plans, plan]; if (hasRemoteApi()) await apiRequest('/api/admin/plans', { method: 'PUT', body: JSON.stringify({ plans: state.plans }) }); editingPlan = null; persist(); render(); }
async function saveUser(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); const existing = editingUser.id && state.users.find((user) => user.id === editingUser.id); if (existing) { const update = { phone: data.phone.trim(), amount: Number(data.amount) }; if (hasRemoteApi()) { const result = await apiRequest(`/api/admin/vouchers/${existing.id}`, { method: 'PUT', body: JSON.stringify(update) }); Object.assign(existing, result.user); if (Array.isArray(result.sales)) state.sales = result.sales; } else Object.assign(existing, update); } else { const plan = getPlan(data.planId); if (hasRemoteApi()) { const result = await apiRequest('/api/admin/vouchers', { method: 'POST', body: JSON.stringify(data) }); state.users.unshift(result.user); if (Array.isArray(result.sales)) state.sales = result.sales; } else { const durationMs = { hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 }[plan.period] * plan.duration; state.users.unshift({ id: crypto.randomUUID(), username: data.username.trim(), password: data.password.trim(), phone: data.phone.trim(), planId: plan.id, amount: Number(data.amount), dataLimit: plan.dataLimit, createdAt: Date.now(), expiresAt: Date.now() + durationMs, status: 'active' }); } } editingUser = null; persist(); activeView = 'users'; render(); }
async function saveSettings() { state.settings.currency = document.querySelector('#currency-input')?.value || 'GH\u20b5'; persist(); }
async function saveExportFile(filename, text, mimeType) {
  if (Capacitor.isNativePlatform()) {
    await FileExport.exportFile({ filename, text, mimeType: mimeType.split(';')[0] });
    return;
  }
  const downloadUrl = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}
async function exportBackup() {
  try {
    await saveExportFile('ea-soft-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ ...state, settings: { apiUrl: state.settings.apiUrl, currency: state.settings.currency } }, null, 2), 'application/json');
  } catch (error) {
    alert('Could not export backup: ' + error.message);
  }
}
function importBackup() { const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json'; input.onchange = () => { const file = input.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const imported = JSON.parse(reader.result); if (!Array.isArray(imported.plans) || !Array.isArray(imported.users)) throw new Error('Invalid backup'); state = { plans: imported.plans, users: imported.users, sales: state.sales, settings: { ...state.settings } }; persist(); render(); } catch { alert('That backup file is not valid.'); } }; reader.readAsText(file); }; input.click(); }

function voucherRandomNumber(limit) {
  const randomValue = new Uint32Array(1);
  const ceiling = Math.floor(4294967296 / limit) * limit;
  do { crypto.getRandomValues(randomValue); } while (randomValue[0] >= ceiling);
  return randomValue[0] % limit;
}
function generateShortVoucherCredentials() {
  const existingUsernames = new Set(state.users.map((user) => user.username));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const username = 'EA-' + (100000 + voucherRandomNumber(900000));
    if (!existingUsernames.has(username)) {
      const password = Array.from({ length: 6 }, () => alphabet[voucherRandomNumber(alphabet.length)]).join('');
      return { username, password };
    }
  }
  throw new Error('Could not generate an unused voucher code. Sync the backend and try again.');
}
async function downloadVoucherCsv(users, plan) {
  const escapeCell = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const rows = [['Username', 'Password', 'Plan', 'Data limit (GB)', 'Amount paid'], ...users.map((user) => [user.username, user.password, plan.name, user.dataLimit, user.amount])];
  await saveExportFile('ea-soft-vouchers-' + new Date().toISOString().slice(0, 10) + '.csv', rows.map((row) => row.map(escapeCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
async function saveBulkUsers(event) {
  event.preventDefault();
  if (bulkCreating) return;
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const plan = getPlan(data.planId);
  const quantity = Number(data.quantity);
  const amount = Number(data.amount);
  if (!plan || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || !Number.isFinite(amount) || amount < 0) {
    alert('Select a package, a quantity from 1 to 100, and a valid amount.');
    return;
  }
  const remote = hasRemoteApi();
  const durationMs = { hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 }[plan.period] * Number(plan.duration);
  if (!remote && (!Number.isFinite(durationMs) || durationMs <= 0)) {
    alert('This package needs a valid duration.');
    return;
  }
  bulkCreating = true;
  form.querySelectorAll('input, select, button').forEach((control) => { control.disabled = true; });
  const created = [];
  let failure = '';
  try {
    for (let index = 0; index < quantity; index += 1) {
      form.querySelector('#bulk-progress').textContent = 'Creating voucher ' + (index + 1) + ' of ' + quantity + '…';
      const credentials = { ...generateShortVoucherCredentials(), phone: String(data.phone || '').trim(), planId: plan.id, amount };
      let user;
      if (remote) {
        const result = await apiRequest('/api/admin/vouchers', { method: 'POST', body: JSON.stringify(credentials) });
        user = result.user;
        if (Array.isArray(result.sales)) state.sales = result.sales;
      } else {
        const now = Date.now();
        user = { ...credentials, id: crypto.randomUUID(), dataLimit: plan.dataLimit, createdAt: now, expiresAt: now + durationMs, status: 'active' };
      }
      created.push(user);
      state.users.unshift(user);
      persist();
    }
  } catch (error) {
    failure = error.message;
  } finally {
    bulkCreating = false;
    editingUser = null;
    activeView = 'users';
    render();
  }
  if (created.length && data.download) {
    try { await downloadVoucherCsv(created, plan); }
    catch (error) { alert('Vouchers were created, but CSV sharing failed: ' + error.message); }
  }
  alert(failure ? 'Created ' + created.length + ' of ' + quantity + ' vouchers. Stopped: ' + failure + ' Check the voucher list before creating the remainder.' : 'Created ' + created.length + ' vouchers for ' + plan.name + '.');
}
async function deleteVoucher(id) {
  if (!financeAvailable) { alert('Update the backend before deleting vouchers so their sales history is preserved.'); return; }
  const remote = hasRemoteApi();
  if (!confirm(remote ? 'Delete this voucher from MikroTik and the manager? Active users will be disconnected.' : 'Delete this local voucher? Configure the backend to also delete MikroTik accounts.')) return;
  bulkDeleting = true;
  try {
    if (remote) await apiRequest('/api/admin/vouchers/' + encodeURIComponent(id), { method: 'DELETE' });
    state.users = state.users.filter((user) => user.id !== id);
    selectedVoucherIds.delete(id);
    persist();
  } catch (error) {
    alert(error.message);
  } finally {
    bulkDeleting = false;
    render();
  }
}
function bindVoucherSelection() {
  const checkboxes = [...document.querySelectorAll('[data-select-voucher]')];
  const selectAll = document.querySelector('#select-all-vouchers');
  if (selectAll) {
    selectAll.indeterminate = checkboxes.some((checkbox) => checkbox.checked) && !checkboxes.every((checkbox) => checkbox.checked);
    selectAll.addEventListener('change', () => {
      checkboxes.forEach((checkbox) => {
        if (selectAll.checked) selectedVoucherIds.add(checkbox.dataset.selectVoucher);
        else selectedVoucherIds.delete(checkbox.dataset.selectVoucher);
      });
      render();
    });
  }
  checkboxes.forEach((checkbox) => checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedVoucherIds.add(checkbox.dataset.selectVoucher);
    else selectedVoucherIds.delete(checkbox.dataset.selectVoucher);
    render();
  }));
}
async function deleteSelectedVouchers() {
  if (!financeAvailable) { alert('Update the backend before deleting vouchers so their sales history is preserved.'); return; }
  const ids = [...selectedVoucherIds].filter((id) => state.users.some((user) => user.id === id));
  if (!ids.length || !confirm('Delete ' + ids.length + ' selected vouchers' + (hasRemoteApi() ? ' from MikroTik and the manager? Active users will be disconnected.' : ' from this local manager? Configure the backend to also delete MikroTik accounts.') + '')) return;
  const remote = hasRemoteApi();
  bulkDeleting = true;
  render();
  let deleted = 0;
  let failure = '';
  try {
    for (const id of ids) {
      if (remote) await apiRequest('/api/admin/vouchers/' + encodeURIComponent(id), { method: 'DELETE' });
      state.users = state.users.filter((user) => user.id !== id);
      selectedVoucherIds.delete(id);
      deleted += 1;
      persist();
    }
  } catch (error) {
    failure = error.message;
  } finally {
    bulkDeleting = false;
    render();
  }
  alert(failure ? 'Deleted ' + deleted + ' of ' + ids.length + ' records. Remaining records are still selected. ' + failure : 'Deleted ' + deleted + ' voucher records.');
}
let statusRefreshRunning = false;
async function refreshVoucherStatus() {
  if (!authenticated || statusRefreshRunning || bulkDeleting || document.hidden || editingUser || editingPlan || document.activeElement?.matches('input, select, textarea')) return;
  statusRefreshRunning = true;
  try {
    if (hasRemoteApi()) await syncRemoteState();
    if (!editingUser && !editingPlan && activeView !== 'settings' && !document.activeElement?.matches('input, select, textarea')) render();
  } catch (error) {
    syncError = error.message;
    console.error('Voucher status refresh failed:', error.message);
    if (authenticated && !editingUser && !editingPlan) render();
  } finally {
    statusRefreshRunning = false;
  }
}
render();
refreshVoucherStatus();
setInterval(refreshVoucherStatus, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshVoucherStatus(); });
