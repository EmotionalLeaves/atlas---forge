// Screenshots of the Windows app (CI only): opens the app like main.js, walks through a few screens, saves PNGs.
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path'), fs = require('fs');
const { pathToFileURL } = require('url');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const WWW = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  protocol.handle('app', (req) => { let p = decodeURIComponent(new URL(req.url).pathname); if (p === '/') p = '/index.html'; return net.fetch(pathToFileURL(path.normalize(path.join(WWW, p))).toString()); });
  const win = new BrowserWindow({ width: 1360, height: 860, useContentSize: true, backgroundColor: '#0d1720', title: 'Atlas Forge', autoHideMenuBar: true, show: true });
  win.setMenu(null);
  const js = (code) => win.webContents.executeJavaScript(`(async()=>{${code}})()`).catch((e) => console.log('JS', e.message));
  const shot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); };
  await win.loadURL('app://atlas/index.html');
  for (let k = 0; k < 60; k++) { if (await js(`return !!(window.app && app.W && !document.getElementById('loading'))`)) break; await wait(1000); }
  await wait(4000); await shot('1-edit');
  await js(`app.R.flyTo(-77.6,40.9,5200); document.querySelector('#tabs button[data-mode=draw]').click();`); await wait(5000);
  await shot('2-new-plan');
  await js(`[...document.querySelectorAll('#sheetBody button')].find(b=>b.textContent.includes('Create plan')).click();`); await wait(15000);
  await js(`const P=await import('/js/plans.js'), A=await import('/js/app.js'), U=await import('/js/panels.js'); P.applyRealPlan ? P.applyRealPlan(app.W, app.W.plans[0], 0) : P.randomPlan(app.W, app.W.plans[0]); A.computePlanStats(); A.refresh(); U.refreshPanels();`); await wait(4000);
  await shot('3-districts');
  await js(`document.getElementById('themeBtn').click(); await new Promise(r=>setTimeout(r,800)); const b=[...document.querySelectorAll('#sheetBody .dchoose .titem')].find(x=>/Dem vs Rep/.test(x.textContent)); if(b) b.click();`); await wait(5000);
  await shot('4-districts-votes');
  await js(`[...document.querySelectorAll('#sheetBody .seg button')].find(b=>b.textContent==='Stats').click();`); await wait(2000); await shot('5-stats');
  await js(`document.querySelector('#tabs button[data-mode=explore]').click();`); await wait(5000); await shot('6-map');
  app.exit(0);
});
