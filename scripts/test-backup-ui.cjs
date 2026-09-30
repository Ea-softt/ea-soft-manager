const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

async function main() {
  const controls = new Map();
  const control = (id) => {
    if (!controls.has(id)) controls.set(id, { innerHTML: '', textContent: '', handlers: {}, elements: {},
      addEventListener(event, handler) { this.handlers[event] = handler; }, querySelector: control, reset() {} });
    return controls.get(id);
  };
  control('#admin-login-form').elements = { email:{value:''}, password:{value:''} };
  const context = vm.createContext({ crypto, URL, console, setInterval() {}, setTimeout() {},
    window: { location: { protocol: 'https:', host: 'example.test', hostname: 'example.test' } },
    document: { hidden: false, querySelector: (id) => /^#(app$|admin-login-form$|login-|backup-|load-safety-backups$|safety-backup-list$)/.test(id) ? control(id) : null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}), createIcons() {},
    requests: [], downloads: [] });
  const source = fs.readFileSync('src/main.js', 'utf8');
  for (const name of source.match(/import \{ (.*?) \} from 'lucide'/)[1].split(', ')) if (name !== 'createIcons') context[name] = {};
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  vm.runInContext(`authenticated = true; accountRole = 'manager'; selectedTown = 'all'; activeView = 'backup';
    apiRequest = async (url, options) => {
      requests.push({url, body: JSON.parse(options.body)});
      if (url.endsWith('/export')) return {backup: {format:'ea-soft-backup'}};
      if (url.endsWith('/preview')) return {previewId:'preview', createdAt:Date.now(), ownerEmail:'owner@example.test', staff:2,
        towns:[{name:'<Town>', plans:1, vouchers:2, sales:3, payments:4, usageDays:5}]};
      return {message:'Restore scheduled', safetyBackup:'before-restore.json', restarting:true};
    };
    saveExportFile = async (...args) => downloads.push(args);
    render();`, context);
  assert.match(control('#app').innerHTML, /Create backup/);
  assert.match(control('#app').innerHTML, /Restore backup/);
  const submit = (id) => control(id).handlers.submit({ target: control(id), preventDefault() {} });
  const exportForm = control('#backup-export-form');
  exportForm.elements = { password: {value:'backup-password'}, confirmPassword: {value:'wrong'} };
  await submit('#backup-export-form');
  assert.match(control('.backup-error').textContent, /do not match/);
  assert.equal(context.requests.length, 0);
  exportForm.elements.confirmPassword.value = 'backup-password';
  await submit('#backup-export-form');
  assert.equal(context.requests[0].url, '/api/admin/backup/export');
  assert.equal(context.downloads.length, 1);
  assert.equal(JSON.parse(context.downloads[0][1]).format, 'ea-soft-backup');
  const previewForm = control('#backup-preview-form');
  previewForm.elements = { password: {value:'backup-password'}, file: {files:[{size:10, text:async () => '{invalid'}]} };
  await submit('#backup-preview-form');
  assert.match(control('.backup-error').textContent, /valid JSON/);
  assert.equal(context.requests.length, 1);
  previewForm.elements.file.files[0].text = async () => '{"format":"ea-soft-backup"}';
  await submit('#backup-preview-form');
  assert.match(control('#app').innerHTML, /Review before restoring/);
  assert.match(control('#app').innerHTML, /&lt;Town&gt;/);
  assert.equal(context.requests.some((request) => request.url.endsWith('/restore')), false);
  control('#backup-restore-form').elements = { currentPassword:{value:'manager-password'}, confirmation:{value:'RESTORE'} };
  await submit('#backup-restore-form');
  const restore = context.requests.at(-1);
  assert.equal(restore.url, '/api/admin/backup/restore');
  assert.equal(restore.body.previewId, 'preview');
  assert.equal(restore.body.currentPassword, 'manager-password');
  assert.equal(vm.runInContext('authenticated', context), false);
  assert.equal(vm.runInContext('backupPreview', context), null);
  assert.equal(vm.runInContext('backupBusy', context), false);
  assert.match(control('#login-error').textContent, /Restore scheduled/);
  console.log('Backup UI passed: export, password mismatch, invalid file, preview, confirmation, sign-out.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
