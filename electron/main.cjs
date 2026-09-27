const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('node:path');

const smokeTest = process.argv.includes('--smoke-test');
let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'EA-Soft Manager',
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#f7f3e9',
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => { if (!smokeTest) mainWindow.show(); });
  await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  if (smokeTest) {
    const result = await mainWindow.webContents.executeJavaScript(`({
      login: Boolean(document.querySelector('#admin-login-form')),
      styles: document.styleSheets.length > 0,
      nodeDisabled: typeof require === 'undefined',
      secureContext: window.isSecureContext
    })`);
    console.log('Desktop smoke test:', JSON.stringify(result));
    app.exit(Object.values(result).every(Boolean) ? 0 : 1);
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.easoft.manager');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Save export', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(fail);
  });
}).catch(fail);

function fail(error) {
  console.error(error);
  if (!smokeTest) dialog.showErrorBox('EA-Soft Manager could not start', error.message);
  app.exit(1);
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
if (smokeTest) setTimeout(() => app.exit(1), 30000).unref();
