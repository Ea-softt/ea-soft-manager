const { spawn } = require('node:child_process');
const path = require('node:path');

// IDE terminals may inherit Electron's Node-only mode. Launch the actual app.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
  cwd: path.join(__dirname, '..'), env, stdio: 'inherit', windowsHide: true
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
