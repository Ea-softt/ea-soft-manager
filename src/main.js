import { createIcons, LayoutDashboard, Users, Tags, Settings, Search, Plus, Download, Upload, MoreHorizontal, Clock3, Database, Wifi, CheckCircle2, AlertTriangle, Trash2, Pencil, X, Save, CalendarDays, Smartphone, ChevronDown, Terminal } from 'lucide';
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
let accountRole = 'manager';
let staffRecords = [];
let agentLedger = { sales: [], payments: [], amountDue: 0 };
let agentBusy = false;
let agentRequestId = null;
let agentResult = null;
let staffMessage = '';
let staffTab = 'register';
let backupBusy = false;
let backupPreview = null;
let backupMessage = '';
const reportRequests = new Map();
let loginMode = 'login';
let recoveryEmail = '';
let authGeneration = 0;
let towns = [];
let selectedTown = 'default';
let townSummaries = [];
let townsComplete = false;
let sharedVoucherMode = false;
let townSettings = null;
let townSettingsLoading = false;
let townSettingsError = '';
let townSaveMessage = '';
let savingTown = false;
let pendingRequests = 0;
state.settings.adminToken = '';
state.users = [];
state.sales = [];
state.plans = [];
let activeView = 'overview';
let searchTerm = '';
let statusFilter = 'all';
let financeRange = 'daily';
let usageRange = 'daily';
let dataUsage = null;
let editingPlan = null;
let editingUser = null;
let bulkCreating = false;
const pendingBulkVouchers = new Map();
let bulkDeleting = false;
let terminalDraft = '';
let networkData = null;
let networkOtherStatus = 'all';
let networkError = '';
let networkBusy = false;
let terminalOutput = '';
let terminalBusy = false;
let operationsData = null, operationsError = '', operationsBusy = false, operationsQuery = '', operationCustomer = '';
let backupSchedule = null, scheduleLoading = false, scheduleError = '';
let pendingOperation = null;
let terminalLastCommand = '';
const selectedVoucherIds = new Set();

function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: { apiUrl: state.settings.apiUrl, currency: state.settings.currency } })); }
persist();

function signOut() {
  networkOtherStatus = 'all';
  networkData = null; networkError = ''; networkBusy = false;
  pendingBulkVouchers.clear();
  operationsData = null; operationsError = ''; operationsBusy = false; operationsQuery = ''; operationCustomer = '';
  backupSchedule = null; scheduleLoading = false; scheduleError = '';
  pendingOperation = null;
  if (authenticated) apiRequest('/api/admin/session', { method: 'DELETE' }).catch(() => {});
  terminalDraft = '';
  terminalOutput = '';
  terminalBusy = false;
  terminalLastCommand = '';
  authenticated = false;
  towns = [];
  sharedVoucherMode = false;
  townSettings = null;
  townSettingsLoading = false;
  townSettingsError = '';
  townSaveMessage = '';
  savingTown = false;
  selectedTown = 'default';
  townSummaries = [];
  financeAvailable = false;
  hasLoadedState = false;
  syncError = '';
  accountEmail = '';
  accountRole = 'manager';
  staffTab = 'register';
  backupPreview = null;
  backupMessage = '';
  reportRequests.clear();
  staffRecords = [];
  agentLedger = { sales: [], payments: [], amountDue: 0 };
  agentResult = null;
  agentRequestId = null;
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
        accountRole = result.role || 'manager';
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
        accountRole = result.role || 'manager';
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
  if (/^\/api\/(agent\/(state|vouchers)|admin\/(agents|agent-payments(?:\/[^/]+\/void)?))$/.test(pathname)) {
    if (selectedTown === 'all') throw new Error('Select a town first.');
    pathname = pathname.replace('/api/', `/api/towns/${encodeURIComponent(selectedTown)}/`);
  }
  const townRoutes = /^\/api\/admin\/(state|plans|vouchers(?:\/[^/]+)?|terminal|network(?:\/scan|\/device|\/internet|\/stations)?|reconcile-payment|report-history|operations(?:\?.*)?)$/;
  if (townRoutes.test(pathname)) {
    if (selectedTown === 'all') throw new Error('Select a town first.');
    pathname = pathname.replace('/api/', `/api/towns/${encodeURIComponent(selectedTown)}/`);
  }
  pendingRequests += 1;
  try { return await performApiRequest(pathname, options); }
  finally {
    pendingRequests -= 1;
    const picker = document.querySelector('#town-select');
    if (picker) picker.disabled = Boolean(pendingRequests || bulkCreating || bulkDeleting || terminalBusy || editingUser || editingPlan);
  }
}
async function performApiRequest(pathname, options = {}) {
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
  if (response.status === 404) throw new Error(data.message || `The backend at ${endpoint.origin} is missing ${endpoint.pathname}. Upload the complete server update, including business-operations.js, router-time.js, customer.html, workspace-backup.js, server.js, towns.js, shared-vouchers.js, admin-auth.js, terminal.js, network-monitor.js, package.json, and package-lock.json to the backend folder, keep its .env and data, run npm ci, then restart the backend.`);
  if (!response.ok || data.success === false) throw new Error(data.message || `API request failed (${response.status})`);
  return data;
}
async function syncRemoteState() {
  if (!hasRemoteApi()) throw new Error('Sign in to connect to your workspace.');
  if (accountRole === 'agent') {
    const town = selectedTown;
    if (!towns.length) towns = (await apiRequest('/api/agent/towns')).towns;
    const remote = await apiRequest('/api/agent/state');
    if (selectedTown !== town) return;
    state.plans = remote.plans;
    state.users = remote.users;
    agentLedger = remote;
    hasLoadedState = true;
    syncError = '';
    return;
  }
  const town = selectedTown;
  const generation = authGeneration;
  if (!towns.length) {
    const result = await apiRequest('/api/admin/towns');
    if (generation !== authGeneration) return;
    if (!Array.isArray(result.towns) || !result.towns.some((item) => item.id === 'default')) throw new Error('Install the multi-town backend update to load your towns.');
    towns = result.towns;
    sharedVoucherMode = result.sharedVouchers === true;
  }
  if (town === 'all') {
    const result = await apiRequest('/api/admin/towns/overview');
    if (selectedTown !== town || generation !== authGeneration) return;
    townSummaries = result.towns;
    townsComplete = result.complete;
    state.sales = result.sales;
    dataUsage = result.complete ? result.dataUsage : null;
    state.users = [];
    state.plans = [];
    financeAvailable = result.complete;
    hasLoadedState = true;
    syncError = result.complete ? '' : 'Some town records are unavailable. Combined totals are unavailable until all towns can be read.';
    return;
  }
  const remote = await apiRequest('/api/admin/state');
  if (selectedTown !== town || generation !== authGeneration) return;
  if (bulkCreating || bulkDeleting) return;
  if (!Array.isArray(remote.plans) || !Array.isArray(remote.users)) throw new Error('The backend returned an invalid workspace response.');
  financeAvailable = Array.isArray(remote.sales);
  dataUsage = remote.dataUsage || null;
  if (financeAvailable) state.sales = remote.sales;
  hasLoadedState = true;
  syncError = remote.warning || '';
  state.plans = remote.plans;
  state.users = remote.users;
  if (activeView === 'agents') await loadAgentManagement();
  persist();
}
function money(value) { return `${state.settings.currency}${Number(value).toFixed(2)}`; }
function formatDataUsage(bytes) {
  if (typeof bytes === 'string' && /^\d+$/.test(bytes)) bytes = Number(bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 0) return 'Unavailable';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('en-GH', { maximumFractionDigits: unit ? 2 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}
function dataUsageCell(user) {
  const formatted = formatDataUsage(user.dataConsumedBytes);
  const known = formatted !== 'Unavailable';
  const timestamp = Number(user.dataUsageUpdatedAt);
  const updated = known && Number.isFinite(timestamp) && timestamp > 0
    ? `<small>Read ${escapeText(formatDate(timestamp))}</small>` : '';
  if (!known) return '<td title="No valid usage reading has reached the manager yet. Check this town’s Router health if this persists."><span>Awaiting usage reading</span><small>Updates after router sync</small></td>';
  return `<td title="Upload + download reported by the router; counters may reset. Units use 1024 bytes per KB.">${formatted}${updated}</td>`;
}
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
  if (accountRole === 'agent') { renderAgentPortal(); return; }
  for (const id of selectedVoucherIds) { if (!state.users.some((user) => user.id === id)) selectedVoucherIds.delete(id); }
  refreshStatus();
  const voucherStatuses = state.users.map(voucherDisplayStatus);
  const activeUsers = voucherStatuses.filter((status) => status === 'active').length;
  const waitingUsers = voucherStatuses.filter((status) => status === 'awaiting').length;
  const revenue = financeAvailable ? state.sales.filter((sale) => !sale.reportDeletedAt).reduce((total, user) => total + Number(user.amount || 0), 0) : null;
  const expiring = state.users.filter((user) => user.status === 'active' && user.expiresAt != null && user.expiresAt - Date.now() < 86400000).length;

  document.querySelector('#app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">EA</span><div><strong>EA-Soft</strong><small>Manager</small></div></div>
        <nav class="nav-list">
          ${navItem('overview', 'LayoutDashboard', 'Overview')}
          ${navItem('users', 'Users', 'Vouchers & users')}
          ${navItem('agents', 'Users', 'Agents & staff')}
          ${navItem('plans', 'Tags', 'Plans & pricing')}
          ${navItem('finances', 'CalendarDays', 'Finances')}
          ${navItem('consumption', 'Database', 'Data consumption')}
          ${navItem('operations', 'Search', 'Business operations')}
          ${navItem('terminal', 'Terminal', 'Terminal')}
          ${navItem('network', 'Wifi', 'Network monitor')}
          ${navItem('settings', 'Settings', 'Settings')}
          ${navItem('backup', 'Download', 'Backup & restore')}
        </nav>
        <div class="sidebar-foot"><span class="status-dot"></span> ${sharedVoucherMode ? 'Vouchers valid in all towns' : 'Admin workspace'}</div>
      </aside>
      <main class="main-content">
        <header class="topbar"><label class="town-picker">Town<select id="town-select" ${pendingRequests || bulkCreating || bulkDeleting || terminalBusy || editingUser || editingPlan ? 'disabled' : ''}><option value="all" ${selectedTown === 'all' ? 'selected' : ''}>All towns</option>${(towns.length ? towns : [{ id: 'default', name: 'Main town' }]).map((town) => `<option value="${escapeText(town.id)}" ${selectedTown === town.id ? 'selected' : ''}>${escapeText(town.name)}</option>`).join('')}</select></label><div class="mobile-brand">EA-Soft <span>Manager</span></div><div class="top-actions"><button class="icon-button" data-action="export" title="Export backup">${icon('Download')}</button><button class="secondary-button" data-action="sign-out">Sign out</button></div></header>
        <section class="page-wrap">${syncError ? `<p class="panel" role="alert">${escapeText(syncError)}</p>` : ''}${selectedTown !== 'all' && hasLoadedState && !financeAvailable ? '<p class="panel" role="status">Your backend needs the finance update. Available vouchers and plans are shown; revenue and voucher deletion are unavailable until it is updated.</p>' : ''}${hasLoadedState || activeView === 'settings' || activeView === 'terminal' || activeView === 'network' || activeView === 'backup' ? renderView({ activeUsers, waitingUsers, revenue, expiring }) : '<section class="panel"><h2>Loading your records</h2><p>No data has loaded yet. A connection error does not mean your records were deleted.</p><button class="secondary-button" data-action="sync">Retry</button></section>'}</section>
      </main>
    </div>
    ${renderModal()}`;
  createIcons({ icons: { LayoutDashboard, Users, Tags, Settings, Search, Plus, Download, Upload, MoreHorizontal, Clock3, Database, Wifi, CheckCircle2, AlertTriangle, Trash2, Pencil, X, Save, CalendarDays, Smartphone, ChevronDown, Terminal } });
  bindEvents();
  bindTownSettings();
  bindAgentManagement();
  bindReportHistory();
  bindBackup();
  bindOperations();
  bindBackupSchedule();
}

function agentSalesTable(sales, showAgent = false) {
  const vouchers = new Map(state.users.map((voucher) => [voucher.id, voucher]));
  return `<div class="table-wrap"><table><thead><tr>${showAgent ? '<th>Agent</th>' : ''}<th>Created</th><th>${showAgent ? 'Voucher' : 'Username / Password'}</th><th>Plan</th><th>Customer number</th><th>Amount</th>${showAgent ? '<th>Actions</th>' : ''}</tr></thead><tbody>${sales.map((sale) => `<tr>${showAgent ? `<td>${escapeText(sale.agentName || sale.agentId)}</td>` : ''}<td>${escapeText(formatDate(sale.createdAt))}</td><td>${escapeText(sale.username || sale.voucherId)}${showAgent ? '' : `<br><small>Password: ${escapeText(vouchers.get(sale.voucherId || sale.id)?.password ?? 'Unavailable (voucher deleted)')}</small>`}</td><td>${escapeText(sale.planName || getPlan(sale.planId)?.name || sale.planId)}</td><td>${escapeText(sale.phone || '')}</td><td>${money(sale.amount)}</td>${showAgent ? `<td>${vouchers.has(sale.voucherId || sale.id) ? `<button class="secondary-button" data-action="delete-user" data-id="${escapeText(sale.voucherId || sale.id)}" ${bulkDeleting ? 'disabled' : ''}>Delete voucher</button>` : '<small>Voucher deleted; sale retained</small>'}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${showAgent ? 7 : 5}">No agent vouchers yet.</td></tr>`}</tbody></table></div>`;
}
function agentBalance(sales, payments) {
  const salesCents = sales.reduce((sum, sale) => sum + Math.round(Number(sale.amount) * 100), 0);
  const receivedCents = payments.filter((payment) => !payment.voidedAt).reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
  return { totalSales: salesCents / 100, totalReceived: receivedCents / 100,
    amountDue: Math.max(0, salesCents - receivedCents) / 100, creditBalance: Math.max(0, receivedCents - salesCents) / 100 };
}
function agentBalanceSummary(sales, payments) {
  const balance = agentBalance(sales, payments);
  return `<p>${sales.length} vouchers</p><p>Total sales payable to manager: <strong>${money(balance.totalSales)}</strong></p><p>Already received by manager: <strong>${money(balance.totalReceived)}</strong></p><p>Remaining balance to pay: <strong>${money(balance.amountDue)}</strong></p>${balance.creditBalance ? `<p>Agent credit (received above current sales): <strong>${money(balance.creditBalance)}</strong></p>` : ''}<p>The full sales amount belongs to the manager. Only payments recorded as received reduce the remaining balance.</p>`;
}
function agentPaymentHistory(payments, canCorrect = false) {
  return payments.map((payment) => `<article><p>${payment.voidedAt ? 'Reversed payment' : 'Received by manager'}: ${money(payment.amount)} on ${escapeText(formatDate(payment.createdAt))}</p>${payment.voidedAt ? `<p>Reversed on ${escapeText(formatDate(payment.voidedAt))}: ${escapeText(payment.voidReason || '')}. Excluded from received total.</p>` : canCorrect ? `<details><summary>Correct a payment entered by mistake</summary><form class="agent-payment-void-form" data-payment="${escapeText(payment.id)}"><fieldset><label>Reason<input name="reason" required maxlength="300" placeholder="Why was this payment entered incorrectly?" /></label><button class="secondary-button">Delete payment record (reverse)</button></fieldset><p class="staff-error" role="alert"></p></form></details>` : ''}</article>`).join('') || '<p>No payments recorded.</p>';
}
function renderAgentPortal() {
  document.querySelector('#app').innerHTML = `<main class="main-content"><header class="topbar"><strong>EA-Soft Agent</strong><button class="secondary-button" id="agent-signout" ${agentBusy ? 'disabled' : ''}>Sign out</button></header><section class="page-wrap"><h1>Create customer voucher</h1><p>${escapeText(accountEmail)}</p><label>Town<select id="agent-town" ${agentBusy ? 'disabled' : ''}>${(towns.length ? towns : [{ id: 'default', name: 'Main town' }]).map((town) => `<option value="${escapeText(town.id)}" ${selectedTown === town.id ? 'selected' : ''}>${escapeText(town.name)}</option>`).join('')}</select></label>${syncError ? `<p role="alert">${escapeText(syncError)}</p>` : ''}<section class="panel"><h2>Payments to manager</h2><p>For the selected town.</p>${hasLoadedState ? agentBalanceSummary(agentLedger.sales, agentLedger.payments) : '<p>Loading...</p>'}<form id="agent-voucher-form" class="settings-panel"><fieldset ${agentBusy || !hasLoadedState ? 'disabled' : ''}><label>Customer plan<select name="planId" required>${state.plans.map((plan) => `<option value="${escapeText(plan.id)}">${escapeText(plan.name)} — ${money(plan.price)}</option>`).join('')}</select></label><label>Customer phone number<input name="phone" type="tel" required maxlength="16" placeholder="0241234567" autocomplete="tel" /></label><p>The voucher code and password are generated automatically. The selected plan sets the price.</p><button class="primary-button" type="submit">${agentBusy ? 'Creating voucher…' : 'Create voucher & send SMS'}</button></fieldset><p id="agent-error" role="alert"></p></form></section>${agentResult ? `<section class="panel" role="status"><h2>Voucher created — ${money(agentResult.amount)}</h2><p>Username: <strong>${escapeText(agentResult.username)}</strong> · Password: <strong>${escapeText(agentResult.password)}</strong></p><p>${agentResult.smsStatus === 'submitted' ? 'SMS submitted to the provider.' : 'SMS was not confirmed. Give these voucher details to the customer.'}</p></section>` : ''}<section class="panel"><h2>Your vouchers</h2>${agentSalesTable(agentLedger.sales)}</section><section class="panel"><h2>Payments received by manager</h2>${agentPaymentHistory(agentLedger.payments)}</section></section></main>`;
  document.querySelector('#agent-signout')?.addEventListener('click', signOut);
  document.querySelector('#agent-town')?.addEventListener('change', async (event) => {
    selectedTown = event.target.value;
    agentResult = null;
    agentRequestId = null;
    hasLoadedState = false;
    state.plans = [];
    agentLedger = { sales: [], payments: [], amountDue: 0 };
    render();
    await refreshVoucherStatus();
  });
  document.querySelector('#agent-voucher-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (agentBusy) return;
    const form = event.target;
    const payload = { planId: form.elements.planId.value, phone: form.elements.phone.value.trim() };
    const fingerprint = JSON.stringify([selectedTown, payload]);
    if (agentRequestId?.fingerprint !== fingerprint) agentRequestId = { fingerprint, id: crypto.randomUUID() };
    payload.requestId = agentRequestId.id;
    agentBusy = true;
    form.querySelector('fieldset').disabled = true;
    document.querySelector('#agent-town').disabled = true;
    document.querySelector('#agent-signout').disabled = true;
    try {
      const result = await apiRequest('/api/agent/vouchers', { method: 'POST', body: JSON.stringify(payload) });
      agentResult = result.user;
      agentRequestId = null;
      try { await syncRemoteState(); } catch (error) { syncError = error.message; }
      agentBusy = false;
      render();
    } catch (error) {
      if (!authenticated || accountRole !== 'agent') return;
      form.querySelector('#agent-error').textContent = error.message;
      form.querySelector('fieldset').disabled = false;
      document.querySelector('#agent-town').disabled = false;
      document.querySelector('#agent-signout').disabled = false;
    } finally { agentBusy = false; }
  });
}
async function loadAgentManagement() {
  const town = selectedTown;
  const [staff, ledger] = await Promise.all([
    apiRequest('/api/admin/staff'),
    town === 'all' ? Promise.resolve({ sales: [], payments: [], amountDue: 0 }) : apiRequest('/api/admin/agents')
  ]);
  if (town !== selectedTown) return;
  staffRecords = staff.staff;
  agentLedger = ledger;
}
function renderAgentManagement() {
  const ids = [...new Set([...staffRecords.filter((user) => user.role === 'agent').map((user) => user.id), ...agentLedger.sales.map((sale) => sale.agentId)])];
  const tabs = [
    ['register', 'Plus', 'Register account'],
    ['staff', 'Users', 'Registered staff'],
    ['balances', 'CalendarDays', 'Agent balances'],
    ['history', 'Tags', 'Agent voucher history']
  ];
  const panel = (id) => `id="staff-panel-${id}" role="tabpanel" aria-labelledby="staff-tab-${id}" data-staff-panel="${id}" ${staffTab !== id ? 'hidden' : ''}`;
  const townName = towns.find((town) => town.id === selectedTown)?.name || 'Selected town';
  const townNotice = '<div class="staff-empty"><h3>Select a town</h3><p>Choose a town from the selector above to view its agent balances and voucher history.</p></div>';
  return `<div class="staff-workspace">
    <div class="heading-row staff-heading"><div><p class="eyebrow">TEAM MANAGEMENT</p><h1>Agents & staff</h1><p class="subhead">Manage your team, track agent sales, and record payments.</p></div><span class="staff-scope">${icon('Users', 16)} ${staffRecords.length} registered staff</span></div>
    <div class="staff-tabs" role="tablist" aria-label="Agents and staff sections">${tabs.map(([id, symbol, label]) => `<button type="button" class="staff-tab ${staffTab === id ? 'active' : ''}" id="staff-tab-${id}" role="tab" aria-selected="${staffTab === id}" aria-controls="staff-panel-${id}" tabindex="${staffTab === id ? '0' : '-1'}" data-staff-tab="${id}">${icon(symbol, 18)}<span>${label}</span></button>`).join('')}</div>
    ${staffMessage ? `<p class="staff-notice" role="status">${escapeText(staffMessage)}</p>` : ''}
    <section class="panel staff-tab-panel staff-registration" ${panel('register')}>
      <div class="staff-panel-heading"><p class="eyebrow">GROW YOUR TEAM</p><h2>Register account</h2><p>Create an account with the access this person needs.</p></div>
      <div class="staff-register-layout"><form id="staff-form" class="settings-panel"><fieldset>
        <label>Name<input name="name" required maxlength="100" autocomplete="name" placeholder="Full name" /></label>
        <label>Email<input name="email" type="email" required maxlength="254" autocomplete="off" placeholder="name@example.com" /></label>
        <label>Initial password<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password" placeholder="At least 12 characters" /></label>
        <label>Role<select name="role"><option value="agent">Agent - create vouchers only</option><option value="manager">Manager - full management access</option></select></label>
        <button class="primary-button">${icon('Plus', 16)} Register account</button><button type="reset" class="secondary-button">Clear form</button></fieldset><p class="staff-error" role="alert"></p></form>
        <aside class="staff-access-note"><h3>Choose the right access</h3><p><strong>Agent</strong><br>Create customer vouchers and view their own sales and payments.</p><p><strong>Manager</strong><br>Manage staff, plans, vouchers, and payments.</p><p>Everyone uses the same sign-in page with their own email and password.</p></aside></div>
    </section>
    <section class="panel staff-tab-panel" ${panel('staff')}><div class="staff-panel-heading"><p class="eyebrow">YOUR TEAM</p><h2>Registered staff</h2><p>Update roles or remove access to a staff account.</p></div><div class="staff-account-list">${renderStaffAccounts()}</div></section>
    <section class="panel staff-tab-panel" ${panel('balances')}><div class="staff-panel-heading"><p class="eyebrow">PAYMENTS & BALANCES</p><h2>Agent balances</h2><p>${selectedTown === 'all' ? 'Balances are shown for one town at a time.' : `Sales and payments for ${escapeText(townName)}.`}</p></div>${selectedTown === 'all' ? townNotice : `<div class="staff-balance-grid">${ids.map((id) => {
      const sales = agentLedger.sales.filter((sale) => sale.agentId === id);
      const payments = agentLedger.payments.filter((payment) => payment.agentId === id);
      const balance = agentBalance(sales, payments);
      return `<article class="staff-balance-card"><h3>${escapeText(staffRecords.find((user) => user.id === id)?.name || sales[0]?.agentName || id)}</h3>${agentBalanceSummary(sales, payments)}${balance.amountDue > 0 ? `<form class="agent-payment-form" data-agent="${escapeText(id)}"><fieldset><label>Amount actually received from agent<input name="amount" type="number" min="0.01" max="${balance.amountDue.toFixed(2)}" step="0.01" required /></label><p>Record money only after you receive it. This reduces the remaining balance.</p><button class="secondary-button">Record payment received</button></fieldset><p class="staff-error" role="alert"></p></form>` : ''}<details class="staff-payment-history"><summary>Payment history</summary>${agentPaymentHistory(payments, true)}</details></article>`;
    }).join('') || '<div class="staff-empty"><h3>No agent balances yet</h3><p>Register an agent to start tracking their voucher sales.</p></div>'}</div>`}</section>
    <section class="panel staff-tab-panel" ${panel('history')}><div class="staff-panel-heading"><p class="eyebrow">SALES RECORDS</p><h2>Agent voucher history</h2><p>${selectedTown === 'all' ? 'Voucher history is shown for one town at a time.' : `All agent voucher sales for ${escapeText(townName)}.`}</p></div>${selectedTown === 'all' ? townNotice : agentSalesTable(agentLedger.sales, true)}</section>
  </div>`;
}
function renderStaffAccounts() {
  return staffRecords.map((user) => `<article class="staff-account"><p><strong>${escapeText(user.name)}</strong> · ${escapeText(user.email)} · ${escapeText(user.role)}</p>${user.email === accountEmail ? '<p>Your account</p>' : `<form class="staff-role-form" data-staff="${escapeText(user.id)}"><fieldset><label>Role<select name="role"><option value="agent" ${user.role === 'agent' ? 'selected' : ''}>Agent</option><option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option></select></label><button class="secondary-button" type="submit">Save role</button><button class="secondary-button staff-delete" type="button">Delete account</button></fieldset><p class="staff-error" role="alert"></p></form>`}</article>`).join('') || '<p>No additional staff registered.</p>';
}
function bindAgentManagement() {
  const staffTabs = [...document.querySelectorAll('[data-staff-tab]')];
  function selectStaffTab(tab) {
    if (pendingRequests) return;
    staffTab = tab.dataset.staffTab;
    staffTabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-staff-panel]').forEach((panel) => { panel.hidden = panel.dataset.staffPanel !== staffTab; });
    tab.focus();
  }
  staffTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectStaffTab(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % staffTabs.length;
      if (event.key === 'ArrowLeft') next = (index + staffTabs.length - 1) % staffTabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = staffTabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectStaffTab(staffTabs[next]); }
    });
  });
  document.querySelectorAll('.staff-role-form').forEach((form) => {
    const user = staffRecords.find((item) => item.id === form.dataset.staff);
    if (!user) return;
    async function updateStaff(deleting) {
      const role = form.elements.role.value;
      if (!deleting && role === user.role) return;
      if (deleting && !confirm(`Delete ${user.name}'s account? They will lose login access. Voucher and payment history will be kept.`)) return;
      form.querySelector('fieldset').disabled = true;
      try {
        const path = `/api/admin/staff/${encodeURIComponent(user.id)}`;
        const result = await apiRequest(deleting ? path : `${path}/role`, deleting ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify({ role }) });
        staffRecords = deleting ? staffRecords.filter((item) => item.id !== user.id) : staffRecords.map((item) => item.id === user.id ? result.user : item);
        staffMessage = deleting ? 'Account deleted. Voucher and payment history has been kept.' : 'Role updated. This person must sign in again.';
        if (authenticated && activeView === 'agents') render();
      } catch (error) { form.querySelector('.staff-error').textContent = error.message; }
      finally { form.querySelector('fieldset').disabled = false; }
    }
    form.addEventListener('submit', (event) => { event.preventDefault(); updateStaff(false); });
    form.querySelector('.staff-delete').addEventListener('click', () => updateStaff(true));
  });
  document.querySelectorAll('.agent-payment-void-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.querySelector('fieldset').disabled = true;
    try {
      await apiRequest(`/api/admin/agent-payments/${encodeURIComponent(form.dataset.payment)}/void`, { method: 'POST', body: JSON.stringify({ reason: form.elements.reason.value.trim() }) });
      staffMessage = 'Payment record reversed. The balance now excludes that payment.';
      await loadAgentManagement();
      render();
    } catch (error) { form.querySelector('.staff-error').textContent = error.message; }
    finally { form.querySelector('fieldset').disabled = false; }
  }));
  document.querySelector('[data-view="agents"]')?.addEventListener('click', async () => {
    try { await loadAgentManagement(); staffMessage = ''; } catch (error) { staffMessage = error.message; }
    if (authenticated && activeView === 'agents') render();
  });
  document.querySelector('#staff-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = Object.fromEntries(new FormData(form));
    form.querySelector('fieldset').disabled = true;
    try {
      const result = await apiRequest('/api/admin/staff', { method: 'POST', body: JSON.stringify(body) });
      staffRecords.push(result.user);
      staffMessage = 'Account registered. This person can now sign in.';
      render();
    } catch (error) { form.querySelector('.staff-error').textContent = error.message; }
    finally { form.querySelector('fieldset').disabled = false; }
  });
  document.querySelectorAll('.agent-payment-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(form.elements.amount.value);
    if (form.dataset.paymentAmount !== String(amount)) { form.dataset.requestId = crypto.randomUUID(); form.dataset.paymentAmount = String(amount); }
    const body = { agentId: form.dataset.agent, amount, requestId: form.dataset.requestId };
    form.querySelector('fieldset').disabled = true;
    try {
      await apiRequest('/api/admin/agent-payments', { method: 'POST', body: JSON.stringify(body) });
      staffMessage = 'Payment recorded.';
      await loadAgentManagement();
      render();
    } catch (error) { form.querySelector('.staff-error').textContent = error.message; }
    finally { form.querySelector('fieldset').disabled = false; }
  }));
}

function renderBackupSchedule() {
  const s = backupSchedule;
  return `<section class="panel settings-panel"><h2>Automatic encrypted backups</h2><p>Saved on this server. Download copies regularly to keep an off-server backup. The scheduling password is stored privately on the server; retain your own copy for restore.</p><p>${s ? `Status: ${s.enabled ? 'Enabled' : 'Disabled'} · Last success: ${s.lastSuccessAt ? escapeText(formatDate(s.lastSuccessAt)) : 'None yet'} · Next attempt: ${s.enabled && s.nextAt ? escapeText(formatDate(s.nextAt)) : 'Not scheduled'}` : 'Loading schedule…'}</p><p role="alert">${escapeText(scheduleError || s?.error || '')}</p><form id="backup-schedule-form"><fieldset ${scheduleLoading || backupBusy || !s ? 'disabled' : ''}><label>Automatic backups<select name="enabled"><option value="false" ${!s?.enabled ? 'selected' : ''}>Disabled</option><option value="true" ${s?.enabled ? 'selected' : ''}>Enabled</option></select></label><label>Every (hours)<input name="hours" type="number" min="1" max="168" value="${s?.hours || 24}" required /></label><label>Keep latest copies<input name="retention" type="number" min="1" max="90" value="${s?.retention || 7}" required /></label><label>Encryption password (required when first enabling)<input name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" /></label><label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" /></label><button class="primary-button">Save schedule</button></fieldset></form><button id="schedule-refresh" class="secondary-button">Refresh schedule status</button></section>`;
}
async function loadBackupSchedule() {
  if (scheduleLoading) return;
  scheduleLoading = true; const generation = authGeneration;
  try { const result = await apiRequest('/api/admin/backup/schedule'); if (generation === authGeneration) { backupSchedule = result.schedule; scheduleError = ''; } }
  catch (e) { if (generation === authGeneration) scheduleError = e.message; }
  finally { if (generation === authGeneration) { scheduleLoading = false; if (activeView === 'backup') render(); } }
}
function bindBackupSchedule() {
  if (activeView !== 'backup') return;
  document.querySelector('#schedule-refresh')?.addEventListener('click', loadBackupSchedule);
  document.querySelector('#backup-schedule-form')?.addEventListener('submit', async e => {
    e.preventDefault(); if (scheduleLoading || backupBusy) return;
    const f = e.target.elements;
    if (f.password.value !== f.confirm.value) { scheduleError = 'The new backup passwords do not match.'; render(); return; }
    const body = { enabled: f.enabled.value === 'true', hours: Number(f.hours.value), retention: Number(f.retention.value), password: f.password.value };
    const generation = authGeneration; scheduleLoading = true;
    try { const result = await apiRequest('/api/admin/backup/schedule', { method: 'POST', body: JSON.stringify(body) }); if (generation === authGeneration) { backupSchedule = result.schedule; scheduleError = ''; } }
    catch (error) { if (generation === authGeneration) scheduleError = error.message; }
    finally { if (generation === authGeneration) { scheduleLoading = false; if (activeView === 'backup') render(); } }
  });
  if (!backupSchedule && !scheduleLoading && !scheduleError) loadBackupSchedule();
}

function renderBackup() {
  return `${renderBackupSchedule()}<div class="heading-row"><div><p class="eyebrow">WORKSPACE RECOVERY</p><h1>Backup & restore</h1><p class="subhead">Protect your manager records across every town.</p></div></div>
    <section class="panel backup-scope"><h2>One backup for all your records</h2><p>Includes manager and agent accounts, plans, voucher credentials, sales, payments, usage history, and report corrections for every configured town.</p><p>Server keys and MikroTik configuration stay unchanged. Restore requires the same town IDs and replaces all current records, including account passwords and balances. Router-only changes are not restored.</p></section>
    ${backupMessage ? `<p class="staff-notice" role="status">${escapeText(backupMessage)}</p>` : ''}
    <div class="backup-grid"><section class="panel settings-panel"><div><p class="eyebrow">SAVE A COPY</p><h2>Create backup</h2><p>The downloaded file is encrypted. Keep its password somewhere safe; it is required to restore.</p></div><form id="backup-export-form"><fieldset ${backupBusy ? 'disabled' : ''}><label>Backup password<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password" /></label><label>Confirm backup password<input name="confirmPassword" type="password" required minlength="12" maxlength="256" autocomplete="new-password" /></label><button class="primary-button">${icon('Download', 16)} Download full backup</button></fieldset><p class="backup-error" role="alert"></p></form></section>
    <section class="panel settings-panel"><div><p class="eyebrow">RECOVER YOUR WORKSPACE</p><h2>Restore backup</h2><p>Choose an encrypted EA-Soft backup to check its contents before restoring. Older screen-only exports cannot restore the server.</p></div><form id="backup-preview-form"><fieldset ${backupBusy ? 'disabled' : ''}><label>Backup file<input id="restore-backup-file" name="file" type="file" accept="application/json,.json" required /></label><label>Backup password<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="off" /></label><button class="secondary-button">${icon('Upload', 16)} Preview backup</button></fieldset><p class="backup-error" role="alert"></p></form></section></div>
    <section class="panel backup-preview"><h2>Safety backups</h2><p>Copies saved automatically before each restore. Each uses the password entered for that restore.</p><button id="load-safety-backups" class="secondary-button">Show safety backups</button><div id="safety-backup-list" role="status"></div></section>
    ${backupPreview ? `<section class="panel backup-preview"><h2>Review before restoring</h2><p>Created ${escapeText(formatDate(backupPreview.createdAt))}. Owner: ${escapeText(backupPreview.ownerEmail)}. ${backupPreview.staff} registered staff accounts.</p><div class="table-scroll"><table><thead><tr><th>Town</th><th>Plans</th><th>Vouchers</th><th>Sales</th><th>Payments</th><th>Usage days</th></tr></thead><tbody>${backupPreview.towns.map((town) => `<tr><td>${escapeText(town.name)}</td><td>${town.plans}</td><td>${town.vouchers}</td><td>${town.sales}</td><td>${town.payments}</td><td>${town.usageDays}</td></tr>`).join('')}</tbody></table></div><p>Your current records will be replaced. A safety backup is saved on the server using the backup password you entered. The server restarts to finish restoring, and everyone must sign in again using credentials from the backup.</p><form id="backup-restore-form" class="settings-panel"><fieldset ${backupBusy ? 'disabled' : ''}><label>Your current manager password<input name="currentPassword" type="password" required maxlength="256" autocomplete="current-password" /></label><label>Type RESTORE to confirm<input name="confirmation" required pattern="RESTORE" autocomplete="off" /></label><button class="primary-button">Restore all manager records</button></fieldset><p class="backup-error" role="alert"></p></form></section>` : ''}`;
}
function bindBackup() {
  document.querySelector('#load-safety-backups')?.addEventListener('click', async () => {
    const list = document.querySelector('#safety-backup-list');
    try {
      const result = await apiRequest('/api/admin/backup/safety');
      list.innerHTML = result.backups.map((item) => `<p>${escapeText(formatDate(item.createdAt))} <button class="secondary-button" data-safety-backup="${escapeText(item.name)}">Download safety backup</button></p>`).join('') || '<p>No safety backups yet.</p>';
      list.querySelectorAll('[data-safety-backup]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await apiRequest(`/api/admin/backup/safety/${encodeURIComponent(button.dataset.safetyBackup)}`);
          await saveExportFile(button.dataset.safetyBackup, JSON.stringify(result.backup), 'application/json');
        } catch (error) { alert(error.message); }
        finally { button.disabled = false; }
      }));
    } catch (error) { list.textContent = error.message; }
  });
  async function run(form, operation) {
    if (backupBusy) return;
    backupBusy = true;
    document.querySelectorAll('#backup-export-form fieldset, #backup-preview-form fieldset, #backup-restore-form fieldset').forEach((item) => { item.disabled = true; });
    form.querySelector('.backup-error').textContent = '';
    try { await operation(); }
    catch (error) { form.querySelector('.backup-error').textContent = error.message; }
    finally {
      backupBusy = false;
      document.querySelectorAll('#backup-export-form fieldset, #backup-preview-form fieldset, #backup-restore-form fieldset').forEach((item) => { item.disabled = false; });
    }
  }
  document.querySelector('#backup-export-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    return run(form, async () => {
      if (form.elements.password.value !== form.elements.confirmPassword.value) throw new Error('Backup passwords do not match.');
      const result = await apiRequest('/api/admin/backup/export', { method: 'POST', body: JSON.stringify({ password: form.elements.password.value }) });
      await saveExportFile(`ea-soft-full-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(result.backup), 'application/json');
      form.reset();
      backupMessage = 'Backup prepared for download. Keep the file and its password safe.';
      if (authenticated && activeView === 'backup') render();
    });
  });
  document.querySelector('#backup-preview-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    return run(form, async () => {
      backupPreview = null;
      const file = form.elements.file.files[0];
      if (!file || file.size > 29 * 1024 * 1024) throw new Error('Choose a backup file smaller than 29 MB.');
      let backup;
      try { backup = JSON.parse(await file.text()); } catch { throw new Error('This is not a valid JSON backup file.'); }
      const result = await apiRequest('/api/admin/backup/preview', { method: 'POST', body: JSON.stringify({ backup, password: form.elements.password.value }) });
      backupPreview = result;
      backupMessage = 'Backup checked. Review the contents below. Nothing has been restored yet.';
      if (authenticated && activeView === 'backup') render();
    });
  });
  document.querySelector('#backup-restore-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    return run(form, async () => {
      if (!backupPreview) throw new Error('Preview your backup again before restoring.');
      const result = await apiRequest('/api/admin/backup/restore', { method: 'POST', body: JSON.stringify({ previewId: backupPreview.previewId,
        currentPassword: form.elements.currentPassword.value, confirmation: form.elements.confirmation.value }) });
      signOut();
      document.querySelector('#login-error').textContent = `${result.message} Safety copy: ${result.safetyBackup}.${result.restarting ? '' : ' On the server, run: pm2 restart ea-soft-api --update-env'}`;
    });
  });
}

function renderOperations() {
  const d = operationsData;
  const text = value => escapeText(String(value ?? 'Unavailable'));
  const stamp = value => value ? text(formatDate(value)) : 'Not recorded';
  const selected = d?.customers.find(c => c.id === operationCustomer);
  const disabled = operationsBusy ? 'disabled' : '';
  const reason = '<label>Reason / note<input name="reason" required maxlength="300" /></label>';
  return `<div class="heading-row"><div><p class="eyebrow">BUSINESS OPERATIONS</p><h1>Customers, router & profit</h1><p>Updates are saved with your account and reason. Voucher time continues during suspension.</p></div><button id="operations-refresh" class="secondary-button" ${disabled}>Refresh checks</button></div>
    ${operationsError ? `<p class="panel" role="alert">${text(operationsError)}</p>` : ''}
    <form id="operations-search" class="toolbar"><label>Username or phone<input name="query" value="${text(operationsQuery)}" maxlength="100" /></label><button class="primary-button" ${disabled}>Search</button></form>
    ${!d ? '<p class="panel">Loading business operations…</p>' : `
    <section class="panel"><h2>Router health</h2><p>${d.router.error ? text(d.router.error) : `${d.router.sessions ?? 'Unknown'} connected sessions · CPU ${text(d.router.resources['cpu-load'])}% · RouterOS ${text(d.router.resources.version)}`}</p><p>Last successful check: ${stamp(d.router.lastSuccessAt)} · Timezone: ${text(d.router.clock['time-zone-name'])}</p></section>
    <section class="panel"><h2>Alerts</h2>${d.alerts.length ? `<ul>${d.alerts.map(a => `<li>${text(a.username || '')} ${text(a.message)}</li>`).join('')}</ul>` : '<p>No issues detected by the latest checks.</p>'}</section>
    <section class="panel"><h2>Customer troubleshooting</h2><p>Showing up to 100 matching vouchers. Select a customer for history and actions.</p><div class="table-scroll"><table><thead><tr><th>Customer</th><th>Status</th><th>Connected</th><th>First login</th><th>Expiry</th><th>Data used</th></tr></thead><tbody>${d.customers.map(c => `<tr><td><button class="text-button" data-operation-customer="${text(c.id)}">${text(c.username)}</button><small>${text(c.phone || '')}</small></td><td>${text(c.status)}</td><td>${c.connected === null ? 'Unknown' : c.connected ? 'Yes' : 'No'}</td><td>${stamp(c.activatedAt)}</td><td>${stamp(c.expiresAt)}</td><td>${formatDataUsage(c.dataConsumedBytes)} / ${c.dataLimit} GB</td></tr>`).join('')}</tbody></table></div>
    ${selected ? `<h3>Voucher ${text(selected.username)}</h3><p>Payment: ${text(selected.paymentReference || 'Manual sale')} · Activation source: ${text(selected.activationSource || 'Not recorded')}</p><p>Remaining allowance: ${formatDataUsage(selected.remainingBytes)} · Usage updated: ${stamp(selected.dataUsageUpdatedAt)}</p>
    <ul>${selected.sales.map(s => `<li>${stamp(s.createdAt)} · ${money(s.amount)} ${s.cleared ? '(cleared from reports)' : ''}</li>`).join('')}</ul>
    <h4>Recent router events</h4><pre class="operation-events">${text(selected.events.map(e => `${e.time} ${e.message}`).join('\n') || 'No retained events for this voucher.')}</pre>
    <form data-operation-form><input type="hidden" name="voucherId" value="${text(selected.id)}" /><label>Action<select name="action">${d.localActions ? '<option value="extend">Extend validity (hours)</option><option value="add-data">Add allowance (GB)</option><option value="suspend">Suspend</option><option value="resume">Resume</option><option value="replace-credentials">Replace password (keep time and allowance)</option>' : ''}<option value="resend">Resend credentials to saved phone</option></select></label><label>Additional hours / GB (for extension or data only)<input name="value" type="number" min="0.01" step="0.01" /></label>${reason}<button class="primary-button" ${disabled}>Apply action</button></form><p>Extensions start from the later of current expiry or now. Unused vouchers retain first-login activation. Resending uses the configured SMS provider.</p>` : ''}</section>
    <section class="panel"><h2>Payment reconciliation</h2><p>Verifies the transaction with Paystack before issuing or recovering its voucher. Repeated references do not create duplicate sales.</p><form data-operation-form><input type="hidden" name="action" value="reconcile" /><label>Payment reference<input name="reference" required maxlength="200" /></label>${reason}<button class="primary-button" ${disabled}>Verify payment</button></form><details><summary>${d.payments.length} references awaiting verification</summary><ul>${d.payments.map(p => `<li>${text(p.reference)} · ${text(p.username || '')}</li>`).join('')}</ul></details></section>
    <section class="panel"><h2>Expenses & profit</h2><p>All-time reported revenue: <strong>${money(d.profit.revenue)}</strong> · Expenses: <strong>${money(d.profit.expenses)}</strong> · Net: <strong>${money(d.profit.net)}</strong></p><p>Net equals reported sales less recorded expenses. Enter commissions and equipment costs as expenses.</p><form data-operation-form><input type="hidden" name="action" value="expense" /><label>Category<select name="category"><option>Internet</option><option>Electricity</option><option>Equipment</option><option>Agent commission</option><option>Other</option></select></label><label>Amount<input type="number" name="amount" min="0.01" step="0.01" required /></label>${reason}<button class="primary-button" ${disabled}>Record expense</button></form><ul>${d.expenses.map(e => `<li>${stamp(e.createdAt)} · ${text(e.category)} · ${money(e.cents / 100)} · ${text(e.note)} ${e.voidedAt ? '(voided)' : `<button class="text-button" data-void-expense="${text(e.id)}" ${disabled}>Void</button>`}</li>`).join('')}</ul></section>
    <section class="panel"><h2>Recent operations</h2><ul>${d.requests.map(r => `<li>${text(r.action)} · ${text(r.state)} · ${text(r.reason)} ${r.error ? '— ' + text(r.error) : ''}</li>`).join('')}</ul><h3>Audit history</h3><ul>${d.audit.map(a => `<li>${stamp(a.at)} · ${text(a.actor)} · ${text(a.action)} · ${text(a.reason || '')}</li>`).join('')}</ul></section>`}`;
}
async function loadOperations() {
  if (operationsBusy || !authenticated || selectedTown === 'all') return;
  operationsBusy = true;
  const town = selectedTown, generation = authGeneration;
  try {
    // apiRequest routes the base endpoint to the selected town; query goes in a separate URL suffix.
    const result = await apiRequest('/api/admin/operations?q=' + encodeURIComponent(operationsQuery));
    if (town !== selectedTown || generation !== authGeneration) return;
    operationsData = result; operationsError = '';
  } catch (e) { if (town === selectedTown && generation === authGeneration) operationsError = e.message; }
  finally { if (generation === authGeneration) { operationsBusy = false; if (activeView === 'operations' && town === selectedTown) render(); } }
}
async function submitOperation(body) {
  if (operationsBusy) return;
  operationsBusy = true;
  const generation = authGeneration, town = selectedTown;
  const key = JSON.stringify({ town, body });
  if (pendingOperation?.key !== key) pendingOperation = { key, requestId: crypto.randomUUID() };
  try {
    await apiRequest('/api/admin/operations', { method: 'POST', body: JSON.stringify({ ...body, requestId: pendingOperation.requestId }) });
    if (generation !== authGeneration || town !== selectedTown) return;
    pendingOperation = null;
    operationsError = ''; operationsData = null;
  } catch (e) { if (generation === authGeneration && town === selectedTown) operationsError = e.message; }
  finally { if (generation === authGeneration) { operationsBusy = false; if (activeView === 'operations' && town === selectedTown) render(); } }
}
function bindOperations() {
  if (activeView !== 'operations' || selectedTown === 'all') return;
  document.querySelector('#operations-refresh')?.addEventListener('click', loadOperations);
  document.querySelector('#operations-search')?.addEventListener('submit', e => { e.preventDefault(); operationsQuery = e.target.elements.query.value.trim(); loadOperations(); });
  document.querySelectorAll('[data-operation-customer]').forEach(b => b.onclick = () => { operationCustomer = b.dataset.operationCustomer; render(); });
  document.querySelectorAll('[data-operation-form]').forEach(f => f.onsubmit = e => {
    e.preventDefault(); const body = Object.fromEntries(new FormData(f));
    if (confirm('Apply ' + body.action + '? ' + body.reason)) submitOperation(body);
  });
  document.querySelectorAll('[data-void-expense]').forEach(b => b.onclick = () => {
    const reason = prompt('Reason for voiding this expense:');
    if (reason?.trim()) submitOperation({ action: 'void-expense', expenseId: b.dataset.voidExpense, reason });
  });
  if (!operationsData && !operationsError && !operationsBusy) loadOperations();
}

function renderNetwork() {
  if (selectedTown === 'all') return '<section class="panel"><h1>EA-SOFT WIFI NETWORK</h1><p>Select a town to monitor its management VLAN.</p></section>';
  const d = networkData;
  const text = value => escapeText(String(value ?? 'Unknown'));
  const status = value => `<span class="network-status ${value === 'online' ? 'online' : value === 'no-reply' ? 'no-reply' : ''}">${value === 'online' ? '🟢 ONLINE' : value === 'no-reply' ? '🔴 NO REPLY' : '⚪ UNKNOWN'}</span>`;
  const rate = value => value == null ? 'Unavailable' : `${Number(value).toFixed(1)} Mbps`;
  const stations = d?.stations || [];
  const layout = [...stations.map(station => [station.name, station.type === 'main' ? 'Main station' : 'Substation']), ['Other', 'Newly discovered and unassigned devices']];
  return `<div class="heading-row"><div><p class="eyebrow">MANAGEMENT VLAN · 192.168.10.0/24</p><h1>EA-SOFT WIFI NETWORK</h1><p>All 254 host addresses are checked through your MikroTik. Previously discovered devices remain visible.</p></div><button id="network-refresh" class="secondary-button" ${networkBusy || d?.scanning ? 'disabled' : ''}>${d?.scanning ? `Scanning ${d.progress}/254…` : 'Refresh network'}</button></div>
    ${networkError || d?.error ? `<p class="panel" role="alert">${text(networkError || d.error)}</p>` : ''}
    <p role="status">${d?.checkedAt ? `Last finished check: ${text(formatDate(d.checkedAt))}.` : 'No finished check yet.'} ${d?.scanning ? 'A scan is running; previous results stay visible until each device is checked again.' : 'A new scan starts one minute after the previous check finishes while this page is open.'} ${d?.checkedAt && Date.now() - d.checkedAt > 120000 ? 'Readings are stale.' : ''}</p>
    <section class="panel network-summary"><div>Internet ${status(d?.health.internet)}<small>${text(d?.health.internetMessage || 'Internet has not been checked yet.')}</small>${d?.health.internetCheckedAt ? `<small>Checked ${text(formatDate(d.health.internetCheckedAt))}</small>` : ''}<button id="network-internet-check" class="secondary-button" ${networkBusy || d?.health.internetChecking ? 'disabled' : ''}>Check Internet</button></div><div>MikroTik ${status(d?.health.router)}</div><div>Download <strong>${rate(d?.health.downloadMbps)}</strong></div><div>Upload <strong>${rate(d?.health.uploadMbps)}</strong></div><div>Hotspot active users <strong>${text(d?.health.activeUsers)}</strong></div></section>
    <section class="panel"><h2>Manage stations</h2><p>Create your main station and substations here, then use Assign station / edit on each device to place it in a station.</p>${!stations.length ? '<p>No stations created yet. Your discovered devices are listed under Other.</p>' : ''}
    <form id="network-station-form" class="network-device-form"><input name="previousName" type="hidden" value="" /><label>Station name<input name="name" required maxlength="80" placeholder="Main station or Substation 1" /></label><label>Station type<select name="type"><option value="main">Main station</option><option value="substation">Substation</option></select></label><button id="network-station-save" class="primary-button" ${networkBusy ? 'disabled' : ''}>Create station</button><button id="network-station-cancel" type="button" class="secondary-button" hidden>Cancel edit</button></form></section>
    <div class="network-stations">${layout.map(([group, expected]) => {
      const groupDevices = (d?.devices || []).filter(device => device.group === group);
      const devices = groupDevices.filter(device => group !== 'Other' || networkOtherStatus === 'all' || device.status === networkOtherStatus);
      const statusFilter = group === 'Other' ? `<label>Status <select id="network-other-status">${[['all', 'All statuses'], ['online', 'Online'], ['no-reply', 'No reply'], ['unknown', 'Unknown']].map(([value, label]) => `<option value="${value}" ${networkOtherStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p>${devices.length} of ${groupDevices.length} unassigned devices</p>` : '';
      return `<section class="panel"><p class="eyebrow">${text(group.toUpperCase())}</p><p>${text(expected)}</p>${statusFilter}${group !== 'Other' ? `<button class="text-button" data-network-station-edit="${text(group)}">Edit station</button>` : ''}${devices.length ? `<div class="table-scroll"><table><thead><tr><th>Device / IP</th><th>Status</th><th>Last seen</th></tr></thead><tbody>${devices.map(device => `<tr><td><strong>${text(device.name || device.detectedName || 'Unassigned device')}</strong><small>${text(device.ip)}${device.mac ? ` · ${text(device.mac)}` : ''}</small><button class="text-button" data-network-edit="${text(device.ip)}">Assign station / edit</button></td><td>${status(device.status)}${device.checkError ? `<small>${text(device.checkError)}</small>` : ''}<small>${device.checkedAt ? `Checked ${text(formatDate(device.checkedAt))}` : 'Not checked yet'}</small></td><td>${device.lastSeenAt ? text(formatDate(device.lastSeenAt)) : 'Not seen replying'}</td></tr>`).join('')}</tbody></table></div>` : group === 'Other' && groupDevices.length ? '<p>No unassigned devices match this status.</p>' : '<p>No device IP assigned yet.</p>'}</section>`;
    }).join('')}</div>
    <section class="panel"><h2>Add or label a device</h2><p>Enter the actual IP and model to place a device in its station. You can add an existing device that is currently unreachable. A new address appears automatically after discovery.</p>
    <form id="network-device-form" class="network-device-form"><label>Management IP<input name="ip" required placeholder="192.168.10.2" list="network-ips" /><datalist id="network-ips">${(d?.devices || []).map(device => `<option value="${text(device.ip)}">${text(device.name || device.detectedName || '')}</option>`).join('')}</datalist></label><label>Device name / model<input name="name" required maxlength="80" placeholder="CPE610" /></label><label>Station<select name="group">${layout.map(([group]) => `<option>${text(group)}</option>`).join('')}</select></label><button class="primary-button" ${networkBusy ? 'disabled' : ''}>Save device</button></form>
    <p>No reply means the device did not answer ICMP; it may be offline or block ping. Internet status checks 1.1.1.1 and 8.8.8.8 from the router. Traffic is measured on ${text(d?.health.wan || 'the configured WAN interface')}. Devices are tracked by IP; update labels when addresses are reassigned.</p></section>`;
}

async function refreshNetwork(path = '/api/admin/network/scan', options = { method: 'POST' }) {
  if (!authenticated || selectedTown === 'all' || networkBusy) return;
  const generation = authGeneration, town = selectedTown;
  networkBusy = true;
  try {
    const result = await apiRequest(path, options);
    if (generation !== authGeneration || town !== selectedTown) return;
    networkData = result; networkError = '';
  } catch (error) {
    if (generation === authGeneration && town === selectedTown) networkError = error.message;
  } finally {
    if (generation === authGeneration && town === selectedTown) {
      networkBusy = false;
      if (authenticated && activeView === 'network') render();
    }
  }
}

function bindNetwork() {
  if (activeView !== 'network' || selectedTown === 'all') return;
  document.querySelector('#network-other-status')?.addEventListener('change', event => {
    networkOtherStatus = event.target.value;
    render();
    document.querySelector('#network-other-status')?.focus();
  });
  document.querySelector('#network-refresh')?.addEventListener('click', () => refreshNetwork());
  document.querySelector('#network-internet-check')?.addEventListener('click', () => refreshNetwork('/api/admin/network/internet'));
  const stationForm = document.querySelector('#network-station-form');
  stationForm?.addEventListener('submit', event => {
    event.preventDefault();
    const previousName = stationForm.elements.previousName.value;
    void refreshNetwork('/api/admin/network/stations', { method: previousName ? 'PUT' : 'POST', body: JSON.stringify({
      previousName, name: stationForm.elements.name.value.trim(), type: stationForm.elements.type.value
    }) });
  });
  document.querySelector('#network-station-cancel')?.addEventListener('click', () => {
    stationForm.reset();
    document.querySelector('#network-station-save').textContent = 'Create station';
    document.querySelector('#network-station-cancel').hidden = true;
  });
  document.querySelectorAll('[data-network-station-edit]').forEach(button => button.addEventListener('click', () => {
    const station = networkData?.stations.find(s => s.name === button.dataset.networkStationEdit);
    if (!station || !stationForm) return;
    stationForm.elements.previousName.value = station.name;
    stationForm.elements.name.value = station.name;
    stationForm.elements.type.value = station.type;
    document.querySelector('#network-station-save').textContent = 'Save station';
    document.querySelector('#network-station-cancel').hidden = false;
    stationForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    stationForm.elements.name.focus();
  }));
  document.querySelectorAll('[data-network-edit]').forEach(button => button.addEventListener('click', () => {
    const device = networkData?.devices.find(d => d.ip === button.dataset.networkEdit);
    const form = document.querySelector('#network-device-form');
    if (!device || !form) return;
    form.elements.ip.value = device.ip;
    form.elements.name.value = device.name || device.detectedName || '';
    form.elements.group.value = device.group || 'Other';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.name.focus();
  }));
  document.querySelector('#network-device-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    void refreshNetwork('/api/admin/network/device', { method: 'PUT', body: JSON.stringify({ ip: form.elements.ip.value.trim(), name: form.elements.name.value.trim(), group: form.elements.group.value }) });
  });
  if (!networkData && !networkError) void refreshNetwork();
}

setInterval(() => {
  if (authenticated && activeView === 'network' && !document.hidden && !document.activeElement?.matches('input, select, textarea')) void refreshNetwork();
}, 5000);

function renderTerminal() {
  return `<div class="heading-row"><div><p class="eyebrow">ROUTER MANAGEMENT</p><h1>MikroTik Terminal</h1></div></div>
    <section class="panel terminal-panel"><p>Run one complete RouterOS command at a time. Paste commands separately; do not join them with spaces or commas. Each run starts at the root menu. Interactive prompts are not supported; use a count or duration for continuous commands.</p>
    <pre id="terminal-output" class="terminal-output" tabindex="0" aria-label="Terminal output">${escapeText(terminalOutput || 'Ready. Try /system resource print')}</pre>
    <form id="terminal-form"><label for="terminal-command">RouterOS command</label><textarea id="terminal-command" name="command" rows="3" required maxlength="4096" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="/system resource print" ${terminalBusy ? 'disabled' : ''}>${escapeText(terminalDraft)}</textarea><p>Enter to run · Shift+Enter for a new line. Only one line can be submitted.</p><div class="terminal-actions"><button type="submit" class="primary-button" ${terminalBusy ? 'disabled' : ''}>${terminalBusy ? 'Running…' : 'Run command'}</button><button id="terminal-recall" class="secondary-button" type="button" ${terminalBusy || !terminalLastCommand ? 'disabled' : ''}>Edit last command</button><button id="terminal-copy" class="secondary-button" type="button" ${!terminalOutput ? 'disabled' : ''}>Copy output</button><button id="terminal-clear" class="secondary-button" type="button" ${terminalBusy ? 'disabled' : ''}>Clear output</button></div></form>
    <p id="terminal-status" role="status">${terminalBusy ? 'Waiting for router output…' : 'Commands run with the configured router account permissions. Changes take effect immediately.'}</p></section>`;
}
function bindTerminal() {
  const form = document.querySelector('#terminal-form');
  if (!form) return;
  const input = document.querySelector('#terminal-command');
  input.addEventListener('input', () => { terminalDraft = input.value; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) runTerminalCommand(event);
  });
  document.querySelector('#terminal-recall').onclick = () => {
    terminalDraft = terminalLastCommand;
    input.value = terminalDraft;
    input.focus();
  };
  document.querySelector('#terminal-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(terminalOutput);
      document.querySelector('#terminal-status').textContent = 'Output copied.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(output);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector('#terminal-status').textContent = 'Output selected. Use your device’s Copy command.';
    }
  };
  document.querySelector('#terminal-clear').onclick = () => { terminalOutput = ''; render(); };
  form.addEventListener('submit', runTerminalCommand);
  const output = document.querySelector('#terminal-output');
  output.scrollTop = output.scrollHeight;
}
async function runTerminalCommand(event) {
  event.preventDefault();
  if (!authenticated || terminalBusy || !terminalDraft.trim()) return;
  const generation = authGeneration;
  const command = terminalDraft.trim();
  if (/[\r\n]/.test(command)) {
    terminalOutput = `${terminalOutput}\nNot sent: paste and run one command at a time. Multiple lines were kept in the editor.\n`.slice(-300000);
    render();
    return;
  }
  terminalLastCommand = command;
  terminalBusy = true;
  terminalOutput = `${terminalOutput}\n> ${command}\n`.slice(-300000);
  terminalDraft = '';
  render();
  try {
    const result = await apiRequest('/api/admin/terminal', { method: 'POST', body: JSON.stringify({ command }) });
    if (generation !== authGeneration) return;
    terminalOutput = `${terminalOutput}${result.output || '[No output returned by router]'}\n${result.message || 'Router command finished. Review the output above.'}\n`.slice(-300000);
  } catch (error) {
    if (generation !== authGeneration) return;
    terminalOutput += `Error: ${error.message}\n`;
  } finally {
    if (generation === authGeneration) {
      terminalBusy = false;
      if (authenticated && activeView === 'terminal') { render(); document.querySelector('#terminal-command')?.focus(); }
    }
  }
}
function navItem(view, iconName, label) { return `<button class="nav-item ${activeView === view ? 'active' : ''}" data-view="${view}">${icon(iconName)}<span>${label}</span></button>`; }
function renderView(stats) {
  if (activeView === 'network') return renderNetwork();
  if (activeView === 'operations') return selectedTown === 'all' ? '<section class="panel"><h1>Business operations</h1><p>Select a town to troubleshoot customers, review payments and manage expenses.</p></section>' : renderOperations();
  if (activeView === 'backup') return renderBackup();
  if (activeView === 'agents') return renderAgentManagement();
  if (activeView === 'consumption') return renderDataConsumption();
  if (selectedTown === 'all') {
    if (activeView === 'finances' && townsComplete) return renderFinances();
    if (activeView === 'settings') return renderSettings();
    return renderAllTowns();
  }
  if (activeView === 'users') return renderUsers();
  if (activeView === 'plans') return renderPlans();
  if (activeView === 'finances') return renderFinances();
  if (activeView === 'settings') return renderSettings();
  if (activeView === 'terminal') return renderTerminal();
  return renderOverview(stats);
}
function startOfDay(date = new Date()) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek(date = new Date()) { const d = new Date(date); const offset = (d.getDay() + 6) % 7; d.setDate(d.getDate() - offset); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfMonth(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), 1).getTime(); }
function startOfYear(date = new Date()) { return new Date(date.getFullYear(), 0, 1).getTime(); }
function usersInRange(from, to) { return state.sales.filter((user) => !user.reportDeletedAt && user.createdAt >= from && user.createdAt < to); }
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
function usagePeriodStart(range, value = Date.now()) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  if (range === 'weekly') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  if (range === 'monthly') date.setUTCDate(1);
  if (range === 'yearly') date.setUTCMonth(0, 1);
  return date;
}
function moveUsagePeriod(date, range, offset) {
  const result = new Date(date);
  if (range === 'yearly') result.setUTCFullYear(result.getUTCFullYear() + offset);
  else if (range === 'monthly') result.setUTCMonth(result.getUTCMonth() + offset);
  else result.setUTCDate(result.getUTCDate() + offset * (range === 'weekly' ? 7 : 1));
  return result;
}
function usageTotal(from, to) {
  return dataUsage.days.reduce((total, day) => {
    const timestamp = Date.parse(`${day.date}T00:00:00Z`);
    return total + (timestamp >= from && timestamp < to ? Math.max(0, day.bytes - (day.reportDeletedBytes || 0)) : 0);
  }, 0);
}
function reportHistoryControls(kind, from, to) {
  if (selectedTown === 'all') return '<small>Select a town to manage history</small>';
  let visible, deleted;
  if (kind === 'finance') {
    const sales = state.sales.filter((sale) => sale.createdAt >= from && sale.createdAt < to);
    visible = sales.some((sale) => !sale.reportDeletedAt);
    deleted = sales.some((sale) => sale.reportDeletedAt);
  } else {
    const days = dataUsage.days.filter((day) => { const date = Date.parse(`${day.date}T00:00:00Z`); return date >= from && date < to; });
    visible = days.some((day) => day.bytes > (day.reportDeletedBytes || 0));
    deleted = days.some((day) => day.reportDeletedBytes > 0);
  }
  const button = (action, label) => `<button class="secondary-button" data-report-action="${action}" data-report-kind="${kind}" data-from="${from}" data-to="${to}">${label}</button>`;
  return `<div class="report-actions">${visible ? button('delete', 'Delete from report') : ''}${deleted ? button('restore', 'Restore') : ''}${!visible && !deleted ? '<small>No records</small>' : ''}</div>`;
}
function bindReportHistory() {
  document.querySelectorAll('[data-report-action]').forEach((button) => button.addEventListener('click', async () => {
    if (pendingRequests || accountRole !== 'manager') return;
    const { reportAction: action, reportKind: kind } = button.dataset;
    const from = Number(button.dataset.from), to = Number(button.dataset.to);
    const zone = kind === 'usage' ? { timeZone: 'UTC' } : {};
    const range = `${new Date(from).toLocaleDateString(undefined, zone)} – ${new Date(to - 1).toLocaleDateString(undefined, zone)}`;
    const scope = towns.find((town) => town.id === selectedTown)?.name || selectedTown;
    const explanation = kind === 'finance' ? 'Voucher access, agent balances and payment history stay unchanged.' : 'Customer data allowances stay unchanged. New usage continues to be recorded.';
    if (!confirm(`${action === 'delete' ? 'Delete from' : 'Restore to'} the ${kind === 'finance' ? 'finance' : 'data consumption'} report for ${scope}, ${range}? ${explanation} Deleted report entries can be restored.`)) return;
    const key = JSON.stringify([selectedTown, kind, action, from, to]);
    if (!reportRequests.has(key)) reportRequests.set(key, crypto.randomUUID());
    button.disabled = true;
    try {
      await apiRequest('/api/admin/report-history', { method: 'POST', body: JSON.stringify({ kind, action, from, to, requestId: reportRequests.get(key) }) });
      await syncRemoteState();
      reportRequests.delete(key);
      render();
    } catch (error) { alert(error.message); }
    finally { button.disabled = false; }
  }));
}
function renderDataConsumption() {
  if (!dataUsage || !Array.isArray(dataUsage.days)) return '<section class="panel"><h1>Data consumption unavailable</h1><p>Update the backend and refresh to load usage history. All town records must be available for combined totals.</p><button class="secondary-button" data-action="sync">Refresh</button></section>';
  const periods = [['daily', 'Daily', 'Today'], ['weekly', 'Weekly', 'This week'], ['monthly', 'Monthly', 'This month'], ['yearly', 'Yearly', 'This year']];
  const colors = ['mint', 'sun', 'sky', 'coral'];
  const start = usagePeriodStart(usageRange);
  const count = { daily: 7, weekly: 8, monthly: 12, yearly: 5 }[usageRange];
  const buckets = Array.from({ length: count }, (_, index) => {
    const from = moveUsagePeriod(start, usageRange, index - count + 1);
    const to = moveUsagePeriod(from, usageRange, 1);
    const options = usageRange === 'yearly' ? { year: 'numeric' } : usageRange === 'monthly' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' };
    const label = `${usageRange === 'weekly' ? 'Week of ' : ''}${new Intl.DateTimeFormat('en-GH', { ...options, timeZone: 'UTC' }).format(from)}`;
    return { from, to, label, bytes: usageTotal(from, to) };
  });
  const coverageStart = dataUsage.coverageStartedAt || dataUsage.startedAt;
  const display = (from, to, bytes) => to <= dataUsage.startedAt ? 'Not tracked' : `${formatDataUsage(bytes)}${from < coverageStart ? ' (partial)' : ''}`;
  return `<div class="heading-row"><div><p class="eyebrow">USAGE STATISTICS</p><h1>Data consumption</h1><p class="subhead">Upload + download, recorded in UTC. Weeks start on Monday.</p></div><button class="secondary-button" data-action="sync">Refresh</button></div>
    <div class="stat-grid">${periods.map(([range, , label], index) => {
      const from = usagePeriodStart(range); const to = moveUsagePeriod(from, range, 1);
      return `<div class="stat-card ${colors[index]}"><span class="stat-icon">${icon('Database')}</span><p>${label}</p><strong>${formatDataUsage(usageTotal(from, to))}</strong><small>${from < coverageStart ? 'Partial tracking period' : 'Recorded consumption'}</small></div>`;
    }).join('')}</div>
    <section class="panel table-panel"><div class="panel-head"><div><p class="eyebrow">BREAKDOWN</p><h2>Consumption by period</h2></div><div class="toolbar">${periods.map(([range, label]) => `<button class="${usageRange === range ? 'primary-button' : 'secondary-button'}" data-action="usage-range" data-id="${range}" aria-pressed="${usageRange === range}">${label}</button>`).join('')}</div></div><div class="table-scroll"><table><thead><tr><th>Period</th><th>Data consumed</th><th>Report actions</th></tr></thead><tbody>${buckets.map((bucket) => `<tr><td>${bucket.label}</td><td>${display(bucket.from, bucket.to, bucket.bytes)}</td><td>${reportHistoryControls('usage', bucket.from.getTime(), bucket.to.getTime())}</td></tr>`).join('')}</tbody></table></div></section>
    <p class="subhead">Tracking since ${escapeText(new Date(dataUsage.startedAt).toISOString().slice(0, 10))}. Earlier usage cannot be reconstructed. Usage is assigned to the day it is reported; gaps in router reporting can shift totals. Deleted report usage is excluded from totals and can be restored. New usage continues to accumulate; customer quotas are unchanged. ${sharedVoucherMode ? 'Town totals follow the town where the voucher was issued.' : 'The first router reading establishes a baseline.'} Units use 1024 bytes per KB.</p>`;
}
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
  return `<div class="heading-row"><div><p class="eyebrow">FINANCES</p><h1>Revenue statistics</h1><p class="subhead">Sales remain after voucher deletion. Delete from report hides a period from these totals; Restore brings it back. Agent balances and payment records are kept.</p></div></div>
    <div class="stat-grid">${summary.map((item) => `<div class="stat-card ${item.color}"><span class="stat-icon">${icon('Database')}</span><p>${item.label}</p><strong>${money(item.revenue)}</strong><small>${item.count} voucher${item.count === 1 ? '' : 's'}</small></div>`).join('')}</div>
    <section class="panel table-panel"><div class="panel-head"><div><p class="eyebrow">BREAKDOWN</p><h2>Revenue by period</h2></div><div class="toolbar">${financeRangeTab('daily', 'Daily')}${financeRangeTab('weekly', 'Weekly')}${financeRangeTab('monthly', 'Monthly')}${financeRangeTab('yearly', 'Yearly')}</div></div><div class="table-scroll"><table><thead><tr><th>Period</th><th>Vouchers</th><th>Revenue</th><th>Report actions</th></tr></thead><tbody>${buckets.map((bucket) => `<tr><td>${bucket.label}</td><td>${bucket.count}</td><td>${money(bucket.revenue)}</td><td>${reportHistoryControls('finance', bucket.from, bucket.to)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function renderOverview({ activeUsers, waitingUsers, revenue, expiring }) {
  const recent = [...state.users].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const revenueByStatus = overviewRevenueByStatus();
  return `<div class="heading-row"><div><p class="eyebrow">CONTROL ROOM</p><h1>Good morning, EA-Soft.</h1><p class="subhead">A clear view of your hotspot business, vouchers, and plan performance.</p></div><button class="primary-button" data-action="new-user">${icon('Plus')} New voucher</button></div>
    <div class="stat-grid"><div class="stat-card mint"><span class="stat-icon">${icon('Wifi')}</span><p>Active vouchers</p><strong>${activeUsers + waitingUsers}</strong><small class="voucher-count-breakdown"><span>${activeUsers} active</span><span>${waitingUsers} waiting for first login</span>${state.users.some(u => voucherDisplayStatus(u) === 'used') ? `<span>${state.users.filter(u => voucherDisplayStatus(u) === 'used').length} used ? expiry unavailable (excluded)</span>` : ''}</small></div><div class="stat-card sun"><span class="stat-icon">${icon('Database')}</span><p>Total revenue</p><strong>${revenue === null ? 'Unavailable' : money(revenue)}</strong><small class="voucher-count-breakdown">${revenue === null ? "" : `<span>${money(revenueByStatus.active)} from active vouchers</span><span>${money(revenueByStatus.awaiting)} from waiting for first login</span>`}<span>All reported sales; cleared entries excluded</span></small></div><div class="stat-card sky"><span class="stat-icon">${icon('Clock3')}</span><p>Expiring soon</p><strong>${expiring}</strong><small>Within 24 hours</small></div><div class="stat-card coral"><span class="stat-icon">${icon('Users')}</span><p>All customers</p><strong>${state.users.length}</strong><small>Voucher records</small></div></div>
    <div class="content-grid"><section class="panel wide-panel"><div class="panel-head"><div><p class="eyebrow">LATEST ACTIVITY</p><h2>Recent vouchers</h2></div><button class="text-button" data-view="users">View all ${icon('ChevronDown')}</button></div>${userTable(recent)}</section><section class="panel"><div class="panel-head"><div><p class="eyebrow">YOUR CATALOG</p><h2>Plans</h2></div><button class="icon-button small" data-action="new-plan">${icon('Plus')}</button></div><div class="mini-plans">${state.plans.slice(0, 5).map(planMini).join('')}</div></section></div>`;
}
function voucherDisplayStatus(user) {
  if (user.suspended) return 'suspended';
  if (user.status === 'expired' || (user.expiresAt != null && user.expiresAt <= Date.now())) return 'expired';
  if (user.provisioning === 'pending') return 'pending';
  if (!user.activatedAt && !user.expiresAt && (user.hasLoggedIn || Number(user.dataConsumedBytes) > 0)) return 'used';
  if (!user.activatedAt && !user.expiresAt) return 'awaiting';
  return 'active';
}
function overviewRevenueByStatus() {
  const vouchers = new Map(state.users.map((user) => [user.id, user]));
  const totals = { active: 0, awaiting: 0 };
  for (const sale of state.sales) {
    if (sale.reportDeletedAt) continue;
    const voucher = vouchers.get(sale.voucherId || sale.id);
    if (!voucher) continue;
    const status = voucherDisplayStatus(voucher);
    if (status === 'active' || status === 'awaiting') totals[status] += Number(sale.amount || 0);
  }
  return totals;
}
function voucherStatusBadge(user) {
  const status = voucherDisplayStatus(user);
  const labels = { used: 'Used — expiry unavailable', suspended: 'Suspended', active: 'Active', expired: 'Expired', awaiting: 'Awaiting first login', pending: 'Paid — activation pending' };
  return `<span class="pill ${status}">${labels[status]}</span>`;
}
function renderUsers() {
  const filtered = state.users.filter((user) => `${user.username} ${user.phone} ${getPlan(user.planId)?.name || ''}`.toLowerCase().includes(searchTerm.toLowerCase()) && (statusFilter === 'all' || voucherDisplayStatus(user) === statusFilter));
  return `<div class="heading-row"><div><p class="eyebrow">CUSTOMER LEDGER</p><h1>Vouchers & users</h1><p class="subhead">Every credential, payment, limit, and expiry in one place.</p></div><button class="primary-button" data-action="new-user">${icon('Plus')} New voucher</button></div><div class="toolbar"><label class="search-box">${icon('Search')}<input id="user-search" value="${searchTerm}" placeholder="Search username, phone, or plan" /></label><select id="status-filter"><option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All statuses</option><option value="awaiting" ${statusFilter === 'awaiting' ? 'selected' : ''}>Awaiting first login</option><option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option><option value="used" ${statusFilter === 'used' ? 'selected' : ''}>Used ? expiry unavailable</option><option value="expired" ${statusFilter === 'expired' ? 'selected' : ''}>Expired</option></select><button class="secondary-button" data-action="bulk-users">${icon('Plus')} Bulk vouchers</button><button class="secondary-button" data-action="bulk-delete" ${selectedVoucherIds.size && !bulkDeleting ? '' : 'disabled'}>${icon('Trash2')} ${bulkDeleting ? 'Deleting…' : 'Delete selected (' + selectedVoucherIds.size + ')'}</button><button class="secondary-button" data-action="export">${icon('Download')} Export</button></div><section class="panel table-panel">${userTable(filtered, true)}</section>`;
}
function userTable(users, full = false) {
  if (!users.length) return '<div class="empty-state">No voucher records match this view.</div>';
  return `<div class="table-scroll"><table><thead><tr>${full ? '<th><input type="checkbox" id="select-all-vouchers" aria-label="Select all visible vouchers" ' + (users.every((user) => selectedVoucherIds.has(user.id)) ? 'checked' : '') + (bulkDeleting ? ' disabled' : '') + '></th>' : ''}<th>Customer</th><th>Plan</th><th>Data consumed</th><th>Amount</th><th>Expiry</th><th>Status</th><th></th></tr></thead><tbody>${users.map((user) => `<tr>${full ? '<td><input type="checkbox" data-select-voucher="' + user.id + '" aria-label="Select ' + user.username + '" ' + (selectedVoucherIds.has(user.id) ? 'checked' : '') + (bulkDeleting ? ' disabled' : '') + '></td>' : ''}<td><div class="user-cell"><span class="user-badge">${user.username.slice(-2)}</span><div><strong>${user.username}</strong><small>${user.phone || 'No phone saved'} · ${user.password}</small></div></div></td><td>${getPlan(user.planId)?.name || 'Custom'}<small class="table-note">${user.dataLimit} GB</small></td>${dataUsageCell(user)}<td>${money(user.amount)}</td><td>${!user.expiresAt && (user.activatedAt || user.hasLoggedIn || Number(user.dataConsumedBytes) > 0) ? 'Expiry unavailable' : formatDate(user.expiresAt)}</td><td>${voucherStatusBadge(user)}</td><td><div class="row-actions"><button class="icon-button small" data-action="edit-user" data-id="${user.id}" title="Edit voucher">${icon('Pencil', 16)}</button><button class="icon-button small" data-action="delete-user" data-id="${user.id}" title="Delete voucher">${icon('Trash2', 16)}</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
function planMini(plan) { return `<div class="mini-plan"><span class="plan-color ${plan.color}"></span><div><strong>${plan.name}</strong><small>${plan.dataLimit} GB · ${plan.duration} ${plan.period}</small></div><b>${money(plan.price)}</b></div>`; }
function renderPlans() { return `<div class="heading-row"><div><p class="eyebrow">PRODUCT CATALOG</p><h1>Plans & pricing</h1><p class="subhead">Change price, data limit, and time limit without touching the hotspot portal.</p></div><button class="primary-button" data-action="new-plan">${icon('Plus')} Add plan</button></div><div class="plan-grid">${state.plans.map((plan) => `<article class="plan-card ${plan.color}"><div class="plan-card-top"><span class="plan-color"></span><div class="row-actions"><button class="icon-button small" data-action="edit-plan" data-id="${plan.id}" title="Edit plan">${icon('Pencil', 16)}</button><button class="icon-button small" data-action="delete-plan" data-id="${plan.id}" title="Delete plan">${icon('Trash2', 16)}</button></div></div><h2>${plan.name}</h2><p class="plan-price">${money(plan.price)}</p><div class="plan-meta"><span>${icon('Database', 15)} ${plan.dataLimit} GB</span><span>${icon('Clock3', 15)} ${plan.duration} ${plan.period}</span><span>Shared: ${plan.sharedUsers || 1}</span><span>${plan.rateLimit || 'No rate limit'}</span></div></article>`).join('')}</div>`; }
function renderSettings() { return renderAccountSettings() + renderTownSettings(); }
function renderTownSettings() {
  const heading = '<h2>Towns &amp; MikroTik routers</h2><p>Add each town and its router connection here. Use the router’s VPN/private address reachable from your server.</p>';
  if (!townSettings) return `<section class="panel settings-panel town-settings">${heading}<p role="status">${escapeText(townSettingsError || 'Loading towns…')}</p>${townSettingsError ? '<button class="secondary-button" id="retry-town-settings">Retry</button>' : ''}</section>`;
  return `<section class="panel settings-panel town-settings">${heading}
    <div class="town-settings-list">${townSettings.map((town) => `<article><strong>${escapeText(town.name)}</strong><small>${escapeText(town.host)}:${escapeText(town.port)} · ${escapeText(town.username)}</small></article>`).join('')}</div>
    <form id="add-town-form" autocomplete="off"><fieldset ${savingTown ? 'disabled' : ''}>
      <h3>Add town</h3>
      <label>Town name<input name="name" required maxlength="80" placeholder="e.g. Kumasi" /></label>
      <div class="form-row"><label>MikroTik address<input name="host" required maxlength="253" placeholder="e.g. 10.200.0.3" spellcheck="false" /></label><label>API port<input name="port" type="number" min="1" max="65535" value="8728" required /></label></div>
      <div class="form-row"><label>MikroTik username<input name="username" required maxlength="128" autocomplete="off" spellcheck="false" /></label><label>MikroTik password<input name="password" type="password" required maxlength="256" autocomplete="new-password" /></label></div>
      <details><summary>Optional Terminal connection</summary><p>Terminal uses the same router username and password.</p><label>SSH port<input name="sshPort" type="number" min="1" max="65535" value="22" /></label><label>Trusted SSH fingerprint<input name="sshFingerprint" maxlength="64" pattern="[a-fA-F0-9]{64}" placeholder="64 hexadecimal characters" spellcheck="false" /></label></details>
      <button class="primary-button" type="submit">${savingTown ? 'Saving…' : 'Add town'}</button>
    </fieldset><p id="town-save-message" role="status" aria-live="polite">${escapeText(townSaveMessage)}</p></form>
  </section>`;
}
async function loadTownSettings() {
  if (townSettingsLoading || !authenticated) return;
  const generation = authGeneration;
  townSettingsLoading = true;
  townSettingsError = '';
  try {
    const result = await apiRequest('/api/admin/towns/settings');
    if (generation !== authGeneration) return;
    if (!Array.isArray(result.towns)) throw new Error('Could not load town settings.');
    townSettings = result.towns;
    towns = result.towns.map(({ id, name }) => ({ id, name }));
  } catch (error) { if (generation === authGeneration) townSettingsError = error.message; }
  finally {
    if (generation === authGeneration) {
      townSettingsLoading = false;
      if (authenticated && activeView === 'settings') refreshTownSettingsSection();
    }
  }
}
function bindTownSettings() {
  if (activeView !== 'settings' || !authenticated) return;
  document.querySelector('#add-town-form')?.addEventListener('submit', saveTown);
  document.querySelector('#retry-town-settings')?.addEventListener('click', loadTownSettings);
  if (!townSettings && !townSettingsLoading && !townSettingsError) loadTownSettings();
}
function refreshTownSettingsSection() {
  const section = document.querySelector('.town-settings');
  if (section) section.outerHTML = renderTownSettings();
  const picker = document.querySelector('#town-select');
  if (picker) picker.innerHTML = `<option value="all" ${selectedTown === 'all' ? 'selected' : ''}>All towns</option>` + towns.map((town) => `<option value="${escapeText(town.id)}" ${selectedTown === town.id ? 'selected' : ''}>${escapeText(town.name)}</option>`).join('');
  bindTownSettings();
}
async function saveTown(event) {
  event.preventDefault();
  if (savingTown || !authenticated) return;
  const generation = authGeneration;
  const form = event.target;
  const fields = Object.fromEntries(new FormData(form));
  savingTown = true;
  form.querySelector('fieldset').disabled = true;
  form.querySelector('#town-save-message').textContent = 'Saving town…';
  try {
    const result = await apiRequest('/api/admin/towns', { method: 'POST', body: JSON.stringify(fields) });
    if (generation !== authGeneration) return;
    townSettings.push(result.town);
    towns.push({ id: result.town.id, name: result.town.name });
    townSaveMessage = 'Town added. It is now available in the Town selector.';
    form.reset();
  } catch (error) {
    if (generation !== authGeneration) return;
    townSaveMessage = error.message;
    form.querySelector('#town-save-message').textContent = error.message;
    return;
  } finally {
    if (generation === authGeneration) {
      savingTown = false;
      form.querySelector('fieldset').disabled = false;
    }
  }
  if (authenticated && activeView === 'settings') refreshTownSettingsSection();
}
function renderAccountSettings() {
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
function bindEvents() { document.querySelector('#town-select')?.addEventListener('change', (event) => { const id = event.target.value; event.target.value = selectedTown; switchTown(id); }); document.querySelectorAll('[data-town]').forEach((el) => el.onclick = () => switchTown(el.dataset.town)); bindTerminal(); bindNetwork(); const accountForm = document.querySelector('#account-form'); if (accountForm) { accountForm.elements.email.value = accountEmail; accountForm.addEventListener('submit', saveAccount); document.querySelector('#currency-input').value = state.settings.currency; } document.querySelectorAll('[data-view]').forEach((el) => el.onclick = () => { if (bulkCreating || bulkDeleting) return; activeView = el.dataset.view; render(); }); document.querySelectorAll('[data-action]').forEach((el) => el.onclick = () => handleAction(el.dataset.action, el.dataset.id)); document.querySelector('#user-search')?.addEventListener('input', (e) => { searchTerm = e.target.value; render(); document.querySelector('#user-search')?.focus(); }); document.querySelector('#status-filter')?.addEventListener('change', (e) => { statusFilter = e.target.value; render(); }); document.querySelector('#plan-form')?.addEventListener('submit', savePlan); document.querySelector('#user-form')?.addEventListener('submit', saveUser); document.querySelector('#bulk-user-form')?.addEventListener('submit', saveBulkUsers); bindVoucherSelection(); }
async function handleAction(action, id) { if (!authenticated) return; if (selectedTown === 'all' && !['sign-out', 'sync', 'finance-range', 'usage-range', 'save-settings', 'disable-fingerprint', 'export', 'import'].includes(action)) { alert('Select a town first.'); return; } if (action === 'disable-fingerprint') { try { await BiometricLogin.clear(); alert('Fingerprint sign-in disabled on this phone.'); } catch (error) { alert(error.message); } return; } if (action === 'recover-payment') { const reference = document.querySelector('#payment-reference').value.trim(); if (!reference) return; try { await apiRequest('/api/admin/reconcile-payment', { method: 'POST', body: JSON.stringify({ reference }) }); await syncRemoteState(); alert('Payment verified and recorded.'); } catch (error) { alert(error.message); } render(); return; } if (action === 'sign-out') { if (!bulkCreating && !bulkDeleting) signOut(); return; } if (bulkCreating || bulkDeleting) return; if (action === 'bulk-delete') { await deleteSelectedVouchers(); return; } if (action === 'bulk-users') editingUser = { bulk: true }; if (action === 'new-plan') editingPlan = { name: '', price: 0, dataLimit: 1, duration: 1, period: 'days', sharedUsers: 1, rateLimit: '', color: 'mint' }; if (action === 'edit-plan') editingPlan = { ...getPlan(id) }; if (action === 'new-user') editingUser = { username: `EA-${Math.floor(100000 + Math.random() * 900000)}`, password: Math.random().toString(36).slice(2, 8).toUpperCase(), planId: state.plans[0]?.id, amount: state.plans[0]?.price || 0 }; if (action === 'edit-user') editingUser = { ...state.users.find((user) => user.id === id) }; if (action === 'close-modal') { editingPlan = null; editingUser = null; } if (action === 'delete-plan' && confirm('Delete this plan?')) { const plans = state.plans.filter((plan) => plan.id !== id); if (hasRemoteApi()) await apiRequest('/api/admin/plans', { method: 'PUT', body: JSON.stringify({ plans }) }); state.plans = plans; persist(); } if (action === 'delete-user') { await deleteVoucher(id); return; } if (action === 'usage-range') usageRange = id; if (action === 'finance-range') financeRange = id; if (action === 'export') await exportBackup(); if (action === 'import') importBackup(); if (action === 'save-settings') await saveSettings(); if (action === 'sync') { try { await syncRemoteState(); alert('Backend connected and data synchronized.'); } catch (error) { alert(error.message); } } render(); }
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
async function exportBackup() { activeView = 'backup'; render(); }
function importBackup() { activeView = 'backup'; render(); document.querySelector('#restore-backup-file')?.click(); }

function voucherRandomNumber(limit) {
  const randomValue = new Uint32Array(1);
  const ceiling = Math.floor(4294967296 / limit) * limit;
  do { crypto.getRandomValues(randomValue); } while (randomValue[0] >= ceiling);
  return randomValue[0] % limit;
}
function generateShortVoucherCredentials() {
  const existingUsernames = new Set(state.users.map((user) => String(user.username)));
  const availableUsernames = Array.from({ length: 900 }, (_, index) => String(100 + index))
    .filter((username) => !existingUsernames.has(username));
  if (!availableUsernames.length) {
    throw new Error('All three-digit voucher codes (100–999) are in use. Delete unused vouchers before creating more.');
  }
  return {
    username: availableUsernames[voucherRandomNumber(availableUsernames.length)],
    password: String(100 + voucherRandomNumber(900))
  };
}
function renderAllTowns() {
  const total = townSummaries.reduce((sum, town) => sum + (town.revenue || 0), 0);
  return `<div class="heading-row"><div><p class="eyebrow">ALL TOWNS</p><h1>Your Wi-Fi locations</h1><p class="subhead">${sharedVoucherMode ? 'One voucher works in every town with one expiry and one total data allowance. Records and sales are listed under the town that sold the voucher.' : 'Saved records across your towns. Open a town to refresh its router and manage vouchers, plans, or terminal commands.'}</p></div></div>
    <section class="panel"><h2>Combined revenue</h2><p class="plan-price">${townsComplete ? money(total) : 'Unavailable'}</p><p>All recorded sales across every town.</p></section>
    <div class="plan-grid">${townSummaries.map((town) => `<article class="panel"><h2>${escapeText(town.name)}</h2><p>${town.available ? `${town.vouchers} vouchers · ${town.active} active` : 'Records unavailable'}</p><p>${town.available ? money(town.revenue) : 'Revenue unavailable'}</p><button class="primary-button" data-town="${escapeText(town.id)}">Open town</button></article>`).join('')}</div>`;
}
async function switchTown(id) {
  if (id === selectedTown || pendingRequests || bulkCreating || bulkDeleting || terminalBusy || editingUser || editingPlan) return;
  if (id !== 'all' && !towns.some((town) => town.id === id)) return;
  selectedTown = id;
  networkOtherStatus = 'all';
  networkData = null; networkError = ''; networkBusy = false;
  operationsData = null; operationsError = ''; operationsQuery = ''; operationCustomer = '';
  hasLoadedState = false;
  financeAvailable = false;
  dataUsage = null;
  townsComplete = false;
  townSummaries = [];
  state.users = []; state.plans = []; state.sales = []; dataUsage = null;
  agentLedger = { sales: [], payments: [], amountDue: 0 };
  terminalDraft = ''; terminalOutput = '';
  terminalLastCommand = '';
  searchTerm = ''; statusFilter = 'all';
  selectedVoucherIds.clear();
  syncError = '';
  activeView = 'overview';
  render();
  try { await syncRemoteState(); } catch (error) { syncError = error.message; }
  render();
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
  const pendingVoucher = pendingBulkVouchers.get(selectedTown);
  if (pendingVoucher && (pendingVoucher.planId !== plan.id || pendingVoucher.amount !== amount || pendingVoucher.phone !== String(data.phone || '').trim())) {
    alert('Voucher ' + pendingVoucher.username + ' still needs confirmation. Retry with the same package, amount and phone before starting a different batch.');
    return;
  }
  if (!remote && (!Number.isFinite(durationMs) || durationMs <= 0)) {
    alert('This package needs a valid duration.');
    return;
  }
  bulkCreating = true;
  form.querySelectorAll('input, select, button').forEach((control) => { control.disabled = true; });
  const created = [];
  let failure = '';
  let attemptedUsername = '';
  try {
    for (let index = 0; index < quantity; index += 1) {
      form.querySelector('#bulk-progress').textContent = 'Creating voucher ' + (index + 1) + ' of ' + quantity + '…';
      const credentials = pendingBulkVouchers.get(selectedTown) || { ...generateShortVoucherCredentials(), phone: String(data.phone || '').trim(), planId: plan.id, amount, requestId: crypto.randomUUID() };
      attemptedUsername = credentials.username;
      let user;
      if (remote) {
        pendingBulkVouchers.set(selectedTown, credentials);
        const result = await apiRequest('/api/admin/vouchers', { method: 'POST', body: JSON.stringify(credentials) });
        user = result.user;
        pendingBulkVouchers.delete(selectedTown);
        if (Array.isArray(result.sales)) state.sales = result.sales;
      } else {
        const now = Date.now();
        user = { ...credentials, id: crypto.randomUUID(), dataLimit: plan.dataLimit, createdAt: now, expiresAt: now + durationMs, status: 'active' };
      }
      created.push(user);
      state.users = [user, ...state.users.filter(existing => existing.id !== user.id && existing.username !== user.username)];
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
  alert(failure ? 'Confirmed ' + created.length + ' of ' + quantity + ' vouchers. Stopped at username ' + attemptedUsername + ': ' + failure + ' Retry only the remaining ' + (quantity - created.length) + ' with the same package, amount and phone. This page keeps the unconfirmed voucher for a safe retry; do not reload until it is resolved.' : 'Created ' + created.length + ' vouchers for ' + plan.name + '.');
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
  if (!authenticated || backupBusy || pendingRequests || agentBusy || statusRefreshRunning || bulkDeleting || document.hidden || editingUser || editingPlan || document.activeElement?.matches('input, select, textarea')) return;
  statusRefreshRunning = true;
  try {
    if (hasRemoteApi()) await syncRemoteState();
    if (!editingUser && !editingPlan && activeView !== 'settings' && activeView !== 'terminal' && activeView !== 'backup' && !document.activeElement?.matches('input, select, textarea')) render();
  } catch (error) {
    syncError = error.message;
    console.error('Voucher status refresh failed:', error.message);
    if (authenticated && !editingUser && !editingPlan && activeView !== 'terminal' && activeView !== 'backup') render();
  } finally {
    statusRefreshRunning = false;
  }
}
render();
refreshVoucherStatus();
setInterval(refreshVoucherStatus, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshVoucherStatus(); });
