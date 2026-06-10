/**
 * Higgs TTS — Electron main process
 *
 * Responsibilities:
 *   1. Create the BrowserWindow (the "native" app window).
 *   2. Build a system tray with Show/Hide, Open Output Folder, Quit.
 *   3. Spawn and manage two background subprocesses:
 *        - SGLang-Omni server (in WSL2)  →  http://127.0.0.1:8000
 *        - Python Flask proxy            →  http://127.0.0.1:7861
 *   4. Health-poll the Flask proxy before showing the window.
 *   5. Expose a secure IPC bridge (preload) to the renderer.
 *   6. Enforce single-instance lock.
 *   7. On first launch, create Desktop + Start Menu .lnk shortcuts.
 *
 * Architecture follows the Koko / Koko-Omni pattern (proven in this user's
 * GitHub) extended with a real desktop shell.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ── Paths ─────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const OUTPUT_DIR = path.join(ROOT, 'output');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray-icon.png');
const RENDERER_INDEX = path.join(ROOT, 'renderer', 'index.html');

// ── Port allocation ──────────────────────────────────────────────────
// SGLang-Omni:  8000  (OpenAI-compatible /v1/audio/speech)
// Flask proxy:  7861  (bridges to SGLang, serves /api/*, /audio/*, /health)
const SGLANG_PORT = 8000;
const FLASK_PORT = 7861;
const FLASK_URL = `http://127.0.0.1:${FLASK_PORT}`;
const SGLANG_URL = `http://127.0.0.1:${SGLANG_PORT}`;

// ── State ────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let trayMenu = null;
let sglangProcess = null;
let flaskProcess = null;
let isQuitting = false;
const isDev = process.argv.includes('--dev');

// ── Single-instance lock ─────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

// ── Window creation ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Higgs TTS',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    backgroundColor: '#0d1117',
    show: false, // wait for ready-to-show
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs require()
      devTools: isDev,
    },
  });

  mainWindow.loadFile(RENDERER_INDEX);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Confirm-before-quit behaviour: hide to tray instead of killing
  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
      // Optional: show balloon notification on first hide
      return false;
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Tray ─────────────────────────────────────────────────────────────
function createTray() {
  let trayIcon;
  if (fs.existsSync(TRAY_ICON_PATH)) {
    trayIcon = nativeImage.createFromPath(TRAY_ICON_PATH);
  } else if (fs.existsSync(ICON_PATH)) {
    trayIcon = nativeImage.createFromPath(ICON_PATH);
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createFromDataURL(buildFallbackPng()) : trayIcon);
  tray.setToolTip('Higgs TTS');
  const ctx = Menu.buildFromTemplate([
    { label: 'Show Higgs TTS', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else { createWindow(); } } },
    { label: 'Open output folder', click: () => { shell.openPath(OUTPUT_DIR); } },
    { type: 'separator' },
    { label: 'Server status', enabled: false },
    { label: '  Flask:    checking…', id: 'status-flask' },
    { label: '  SGLang:   checking…', id: 'status-sglang' },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  trayMenu = ctx;
  tray.setContextMenu(ctx);
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

function updateTrayStatus(flask, sglang) {
  if (!trayMenu) return;
  const f = trayMenu.getMenuItemById('status-flask');
  const s = trayMenu.getMenuItemById('status-sglang');
  if (f) f.label = `  Flask:    ${flask ? '✓ ready' : '✗ not ready'}`;
  if (s) s.label = `  SGLang:   ${sglang ? '✓ ready' : '✗ not ready'}`;
}

// Tiny inline PNG fallback (16x16 transparent) so the tray always has SOMETHING.
function buildFallbackPng() {
  return 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNkYGD4z0AswK4SAA' +
         'oYggJgYGBgAAB4wA8BAQEsAv8AAAAASUVORK5CYII=';
}

// ── Subprocess orchestration ─────────────────────────────────────────
function startSglangOmni() {
  if (sglangProcess) {
    try { sglangProcess.kill(); } catch {}
    sglangProcess = null;
  }
  const bat = path.join(SCRIPTS_DIR, 'start-sglang.bat');
  if (!fs.existsSync(bat)) {
    console.error('[higgs] start-sglang.bat missing at', bat);
    return;
  }
  console.log('[higgs] launching SGLang-Omni via', bat);
  sglangProcess = spawn(bat, [], {
    cwd: ROOT,
    windowsHide: true,
    shell: true,
  });
  sglangProcess.on('exit', (code) => {
    console.log(`[higgs] SGLang-Omni exited with code ${code}`);
    sglangProcess = null;
  });
}

function startFlaskProxy() {
  if (flaskProcess) {
    try { flaskProcess.kill(); } catch {}
    flaskProcess = null;
  }
  const venvPy = process.platform === 'win32'
    ? path.join(SERVER_DIR, '.venv', 'Scripts', 'python.exe')
    : path.join(SERVER_DIR, '.venv', 'bin', 'python');
  if (!fs.existsSync(venvPy)) {
    console.error('[higgs] venv missing at', venvPy, '— run scripts/install.bat first');
    return;
  }
  console.log('[higgs] launching Flask proxy:', venvPy, 'server.py');
  flaskProcess = spawn(venvPy, ['server.py', '--port', String(FLASK_PORT), '--sglang-url', SGLANG_URL], {
    cwd: SERVER_DIR,
    env: { ...process.env, HIGGS_OUTPUT_DIR: OUTPUT_DIR },
    windowsHide: true,
  });
  flaskProcess.stdout.on('data', (d) => process.stdout.write(`[flask] ${d}`));
  flaskProcess.stderr.on('data', (d) => process.stderr.write(`[flask] ${d}`));
  flaskProcess.on('exit', (code) => {
    console.log(`[higgs] Flask exited with code ${code}`);
    flaskProcess = null;
  });
}

// ── Health polling ───────────────────────────────────────────────────
function httpGetJson(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode === 200, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, body }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: null }); });
    req.on('error', () => resolve({ ok: false, status: 0, body: null }));
  });
}

async function pollHealth() {
  const flask = await httpGetJson(`${FLASK_URL}/api/health`);
  const sglang = await httpGetJson(`${SGLANG_URL}/v1/models`);
  const flaskReady = flask.ok && flask.body && flask.body.flask_ready !== false;
  const sglangReady = sglang.ok;
  updateTrayStatus(flaskReady, sglangReady);
  if (mainWindow) {
    mainWindow.webContents.send('higgs:health', { flask: flaskReady, sglang: sglangReady, flaskBody: flask.body });
  }
  return { flaskReady, sglangReady };
}

async function waitForFlask(maxSec = 90) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxSec) {
    const { flaskReady } = await pollHealth();
    if (flaskReady) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// ── IPC: renderer → main ─────────────────────────────────────────────
ipcMain.handle('higgs:get-status', async () => pollHealth());
ipcMain.handle('higgs:get-config', async () => ({
  flaskUrl: FLASK_URL,
  sglangUrl: SGLANG_URL,
  outputDir: OUTPUT_DIR,
  version: app.getVersion(),
  isDev,
}));
ipcMain.handle('higgs:open-output', async () => shell.openPath(OUTPUT_DIR));
ipcMain.handle('higgs:restart-servers', async () => {
  if (flaskProcess) flaskProcess.kill();
  if (sglangProcess) sglangProcess.kill();
  await new Promise((r) => setTimeout(r, 2000));
  startSglangOmni();
  startFlaskProxy();
  return { ok: true, message: 'Servers restarting…' };
});
ipcMain.handle('higgs:show-error', async (_e, title, body) => {
  dialog.showErrorBox(title, body);
});

// ── First-run shortcut creation ──────────────────────────────────────
function createShortcutsIfFirstRun() {
  const marker = path.join(ROOT, '.shortcuts-created');
  if (fs.existsSync(marker)) return;

  // The shortcut target is wscript.exe running launch-higgs.vbs.
  // vbs wrapper handles cwd resolution, so we don't need to pass it.
  // (Previously passed process.execPath — wrong in dev where it's node.exe.)
  const targetVbs = path.join(SCRIPTS_DIR, 'launch-higgs.vbs');
  if (!fs.existsSync(targetVbs)) {
    console.warn('[higgs] launch-higgs.vbs missing, skipping shortcut creation');
    return;
  }
  try {
    const ps = path.join(SCRIPTS_DIR, 'create-shortcut.ps1');
    if (!fs.existsSync(ps)) return;
    exec(
      `powershell -ExecutionPolicy Bypass -File "${ps}" -Target "${targetVbs}" -Workdir "${ROOT}" -IconPath "${ICON_PATH}"`,
      { windowsHide: true },
      (err) => {
        if (!err) {
          try { fs.writeFileSync(marker, new Date().toISOString()); } catch {}
        } else {
          console.warn('[higgs] shortcut creation warning:', err.message);
        }
      }
    );
  } catch (e) {
    console.warn('[higgs] shortcut creation failed:', e.message);
  }
}

// ── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // 1. Ensure output dirs exist
  for (const d of [OUTPUT_DIR, path.join(OUTPUT_DIR, 'voices'), path.join(OUTPUT_DIR, 'history')]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // 2. Create tray (visible immediately, shows "checking…" until servers respond)
  createTray();

  // 3. Start background processes
  startSglangOmni();
  startFlaskProxy();

  // 4. Create the window (hidden until Flask responds)
  createWindow();

  // 5. Poll health; once Flask is up, the renderer can begin its own flow
  waitForFlask().then((ok) => {
    if (!ok) {
      console.warn('[higgs] Flask did not become ready in 90s — check Python venv and SGLang-Omni install');
      if (mainWindow) {
        mainWindow.webContents.send('higgs:startup-failed', {
          message: 'Flask proxy did not respond. Check that scripts\\install.bat has been run, then use the tray menu to restart servers.',
        });
      }
    }
  });

  // 6. Create desktop / start-menu shortcuts on first run only
  createShortcutsIfFirstRun();

  // 7. Periodic health refresh so the tray stays accurate
  setInterval(() => pollHealth(), 10_000);
});

app.on('window-all-closed', (e) => {
  // Keep the app running in the tray on Windows/Linux
  if (process.platform === 'darwin' || !tray) {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  // Kill the .bat/cmd wrapper (which kills its children)
  if (sglangProcess) { try { sglangProcess.kill(); } catch {} }
  if (flaskProcess)  { try { flaskProcess.kill();  } catch {} }
  // Also kill the SGLang-Omni process inside WSL directly
  // (the .bat's cmd.exe kill may not propagate through wsl.exe)
  const { execSync } = require('child_process');
  try { execSync('wsl -d Ubuntu -- bash -c "pkill -f sgl-omni 2>/dev/null; echo done"', { timeout: 3000, windowsHide: true }); } catch {}
});

app.on('will-quit', () => {
  if (sglangProcess) { try { sglangProcess.kill(); } catch {} }
  if (flaskProcess)  { try { flaskProcess.kill();  } catch {} }
  const { execSync } = require('child_process');
  try { execSync('wsl -d Ubuntu -- bash -c "pkill -f sgl-omni 2>/dev/null"', { timeout: 2000, windowsHide: true }); } catch {}
});
