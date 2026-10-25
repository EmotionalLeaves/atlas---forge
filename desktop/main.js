// Atlas Forge for Windows: the same app as the Android version, in its own window.
// The web app is served from a private app:// address so its modules, data files and saved maps all work offline.
const { app, BrowserWindow, protocol, net, shell, Menu, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const WWW = app.isPackaged ? path.join(process.resourcesPath, 'www') : path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www');

// computers without a working graphics driver still get the map (software WebGL; the content is our own)
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (!app.requestSingleInstanceLock()) app.quit();
let win = null;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(WWW, p));
    if (!file.startsWith(WWW)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // exports and saved plans: ask where to save
  session.defaultSession.on('will-download', (_e, item) => { item.setSaveDialogOptions({ title: 'Save', defaultPath: item.getFilename() }); });
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 720, minHeight: 520, backgroundColor: '#0d1720', title: 'Atlas Forge', show: false,
    icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => { // F11 full screen, Ctrl+Shift+I developer tools
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });
  // --smoke: open the app, check it started, write smoke.txt and quit (used by the build to test the Windows app)
  if (process.argv.includes('--smoke')) {
    const logs = [];
    win.webContents.on('console-message', (_e, level, message) => { logs.push(`[${level}] ${message}`); });
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      let ok; try { ok = await win.webContents.executeJavaScript("!!(window.app && app.W && !document.getElementById('loading')) || (document.querySelector('#loading .msg') || {}).textContent"); } catch (e) { ok = 'ERR ' + e.message; }
      require('fs').writeFileSync(path.join(process.cwd(), 'smoke.txt'), JSON.stringify({ ok, logs: logs.slice(-40) }, null, 1));
      app.exit(ok === true ? 0 : 1);
    }, 25000));
  }
  win.loadURL('app://atlas/index.html');
});
app.on('window-all-closed', () => app.quit());
