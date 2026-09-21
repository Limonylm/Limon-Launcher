// Limon Launcher - ana süreç (Electron main process)
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, session } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const extract = require('extract-zip');

let win = null;
let store = null;
let storeFile = null;
let skinDir = null;
let running = null; // çalışan oyun süreci

// Microsoft giriş penceresi ve Chromium arayüzü Türkçe açılsın
app.commandLine.appendSwitch('lang', 'tr');

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

/* ------------------------------------------------------------------ */
/* Veri deposu                                                         */
/* ------------------------------------------------------------------ */
function defaultStore() {
  return {
    accounts: [],
    activeAccount: null,
    profiles: [
      {
        id: 'default',
        name: 'Varsayılan',
        version: '1.21.1',
        type: 'release',
        minRam: 1024,
        maxRam: 4096,
        jvmArgs: '',
        width: 854,
        height: 480
      }
    ],
    activeProfile: 'default',
    skins: [],
    settings: defaultSettings()
  };
}

function defaultSettings() {
  return {
    gameDir: path.join(app.getPath('appData'), '.limon'),
    javaPath: '',
    autoJava: true,
    defaultMaxRam: 4096,
    globalJvmArgs: '',
    fullscreen: false,
    minimizeOnLaunch: true,
    showLog: true,
    accent: 'emerald',
    animations: true,
    viewer3d: true,
    viewerAnimation: true
  };
}

function loadStore() {
  const d = defaultStore();
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    store = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
  } catch {
    store = d;
  }
}

function saveStore() {
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));
}

const enc = (s) =>
  safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(s).toString('base64')
    : 'raw:' + s;
const dec = (s) =>
  s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : s.slice(4);

const publicAccounts = () =>
  store.accounts.map(({ id, type, name, uuid }) => ({ id, type, name, uuid }));

const accountState = () => ({
  ok: true,
  accounts: publicAccounts(),
  activeAccount: store.activeAccount
});

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */
const handle = (channel, fn) =>
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(channel, err);
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

const send = (channel, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
};

const toDataUrl = (buf) => 'data:image/png;base64,' + buf.toString('base64');

function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function offlineAuth(account) {
  return {
    access_token: account.uuid,
    client_token: account.uuid,
    uuid: account.uuid,
    name: account.name,
    user_properties: '{}',
    meta: { type: 'mojang', demo: false }
  };
}

/** Hesap için oyuna verilecek yetkilendirme nesnesini üretir (Microsoft için tokeni yeniler). */
async function getAuthFor(account) {
  if (account.type === 'offline') return offlineAuth(account);
  try {
    const authManager = new Auth('select_account');
    const xbox = await authManager.refresh(dec(account.refresh));
    const mc = await xbox.getMinecraft();
    account.refresh = enc(xbox.save());
    saveStore();
    return mc.mclc();
  } catch (err) {
    throw new Error(
      'Microsoft oturumu yenilenemedi. Hesabı kaldırıp yeniden giriş yapmayı dene. (' +
        (err && err.message ? err.message : err) +
        ')'
    );
  }
}

/* ------------------------------------------------------------------ */
/* Sürümler                                                            */
/* ------------------------------------------------------------------ */
let manifestCache = null;
async function getManifest() {
  if (manifestCache && Date.now() - manifestCache.t < 10 * 60 * 1000) return manifestCache.d;
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error('Sürüm listesi alınamadı (' + res.status + ')');
  const d = await res.json();
  manifestCache = { t: Date.now(), d };
  return d;
}

function installedVersions() {
  const dir = path.join(store.settings.gameDir, 'versions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, e.name + '.json')))
    .map((e) => ({ id: e.name, type: 'release', releaseTime: '' }));
}

handle('versions:list', async () => {
  try {
    const m = await getManifest();
    return {
      ok: true,
      versions: m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }))
    };
  } catch (err) {
    const local = installedVersions();
    if (local.length) return { ok: true, versions: local, offline: true };
    throw err;
  }
});

/* ------------------------------------------------------------------ */
/* Java                                                                */
/* ------------------------------------------------------------------ */
async function requiredJava(versionId) {
  try {
    const local = path.join(store.settings.gameDir, 'versions', versionId, versionId + '.json');
    if (fs.existsSync(local)) {
      const j = JSON.parse(fs.readFileSync(local, 'utf8'));
      if (j.javaVersion) return normalizeJava(j.javaVersion.majorVersion);
    }
    const m = await getManifest();
    const v = m.versions.find((x) => x.id === versionId);
    if (v) {
      const j = await (await fetch(v.url)).json();
      if (j.javaVersion) return normalizeJava(j.javaVersion.majorVersion);
    }
  } catch {
    /* varsayılana düş */
  }
  return 17;
}
const normalizeJava = (n) => (n === 16 ? 17 : n || 8);

function javaBinIn(dir) {
  const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name, 'bin', exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function download(url, file, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('İndirme hatası (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  const out = fs.createWriteStream(file);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (total) onProgress(Math.round((got / total) * 100));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
}

async function ensureJava(major) {
  if (store.settings.javaPath) return store.settings.javaPath;
  if (process.platform !== 'win32' || store.settings.autoJava === false) return 'java';

  const dest = path.join(store.settings.gameDir, 'runtime', 'java-' + major);
  let bin = javaBinIn(dest);
  if (bin) return bin;

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const zip = path.join(dest, 'download.zip');
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  try {
    await download(url, zip, (p) =>
      send('game:progress', { task: `Java ${major} indiriliyor`, percent: p })
    );
    send('game:progress', { task: `Java ${major} kuruluyor`, percent: null });
    await extract(zip, { dir: dest });
    fs.rmSync(zip, { force: true });
  } catch (err) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error('Java indirilemedi: ' + err.message);
  }
  bin = javaBinIn(dest);
  if (!bin) throw new Error('Java kurulumu tamamlanamadı.');
  return bin;
}

/* ------------------------------------------------------------------ */
/* Hesaplar                                                            */
/* ------------------------------------------------------------------ */
handle('accounts:list', async () => accountState());

handle('accounts:add-offline', async (name) => {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    return { ok: false, error: 'Kullanıcı adı 3-16 karakter olmalı; harf, rakam ve _ kullanılabilir.' };
  }
  if (store.accounts.some((a) => a.type === 'offline' && a.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'Bu isimde bir çevrimdışı hesap zaten var.' };
  }
  const acc = { id: crypto.randomUUID(), type: 'offline', name, uuid: offlineUuid(name) };
  store.accounts.push(acc);
  store.activeAccount = acc.id;
  saveStore();
  return accountState();
});

// Microsoft giriş penceresi kapanınca Electron bazen ana pencerenin yazı alanlarına odağı geri vermez.
function restoreFocus() {
  const fix = () => {
    if (!win || win.isDestroyed()) return;
    win.show();
    win.focus();
    win.webContents.focus();
  };
  fix();
  setTimeout(fix, 250);
}

handle('accounts:login-ms', async () => {
  try {
    return await loginMicrosoft();
  } finally {
    restoreFocus();
  }
});

async function loginMicrosoft() {
  let xbox;
  try {
    const authManager = new Auth('select_account');
    xbox = await authManager.launch('electron');
  } catch (err) {
    return { ok: false, error: 'Giriş iptal edildi veya tamamlanamadı.' };
  }
  let mc;
  try {
    mc = await xbox.getMinecraft();
  } catch (err) {
    return {
      ok: false,
      error: 'Bu Microsoft hesabında Minecraft: Java Edition bulunamadı. (' + (err && err.message ? err.message : err) + ')'
    };
  }
  const auth = mc.mclc();
  const existing = store.accounts.find((a) => a.type === 'microsoft' && a.uuid === auth.uuid);
  const refresh = enc(xbox.save());
  if (existing) {
    existing.name = auth.name;
    existing.refresh = refresh;
    store.activeAccount = existing.id;
  } else {
    const acc = { id: crypto.randomUUID(), type: 'microsoft', name: auth.name, uuid: auth.uuid, refresh };
    store.accounts.push(acc);
    store.activeAccount = acc.id;
  }
  saveStore();
  return accountState();
}

handle('accounts:select', async (id) => {
  if (store.accounts.some((a) => a.id === id)) {
    store.activeAccount = id;
    saveStore();
  }
  return accountState();
});

handle('accounts:remove', async (id) => {
  store.accounts = store.accounts.filter((a) => a.id !== id);
  if (store.activeAccount === id) store.activeAccount = store.accounts[0] ? store.accounts[0].id : null;
  saveStore();
  return accountState();
});

/* ------------------------------------------------------------------ */
/* Profiller                                                           */
/* ------------------------------------------------------------------ */
const profileState = () => ({ ok: true, profiles: store.profiles, activeProfile: store.activeProfile });

handle('profiles:list', async () => profileState());

handle('profiles:save', async (p) => {
  const name = String(p.name || '').trim();
  if (!name) return { ok: false, error: 'Profil adı boş olamaz.' };
  if (!p.version) return { ok: false, error: 'Bir sürüm seç.' };
  const minRam = Math.max(512, Number(p.minRam) || 1024);
  const maxRam = Math.max(minRam, Number(p.maxRam) || store.settings.defaultMaxRam || 4096);
  const clean = {
    id: p.id || crypto.randomUUID(),
    name,
    version: String(p.version),
    type: p.type || 'release',
    minRam,
    maxRam,
    jvmArgs: String(p.jvmArgs || '').trim(),
    width: Math.max(320, Number(p.width) || 854),
    height: Math.max(240, Number(p.height) || 480)
  };
  const i = store.profiles.findIndex((x) => x.id === clean.id);
  if (i >= 0) store.profiles[i] = clean;
  else store.profiles.push(clean);
  if (!store.activeProfile) store.activeProfile = clean.id;
  saveStore();
  return profileState();
});

handle('profiles:remove', async (id) => {
  if (store.profiles.length <= 1) return { ok: false, error: 'En az bir profil kalmalı.' };
  store.profiles = store.profiles.filter((p) => p.id !== id);
  if (store.activeProfile === id) store.activeProfile = store.profiles[0].id;
  saveStore();
  return profileState();
});

handle('profiles:select', async (id) => {
  if (store.profiles.some((p) => p.id === id)) {
    store.activeProfile = id;
    saveStore();
  }
  return profileState();
});

/* ------------------------------------------------------------------ */
/* Ayarlar                                                             */
/* ------------------------------------------------------------------ */
handle('settings:get', async () => ({ ok: true, settings: store.settings }));

handle('settings:reset', async () => {
  const keepDir = store.settings.gameDir;
  store.settings = { ...defaultSettings(), gameDir: keepDir };
  saveStore();
  return { ok: true, settings: store.settings };
});

handle('settings:open-data-dir', async () => {
  await shell.openPath(app.getPath('userData'));
  return { ok: true };
});

handle('system:info', async () => ({
  ok: true,
  totalMemMB: Math.floor(os.totalmem() / 1048576),
  version: app.getVersion(),
  platform: process.platform
}));

handle('versions:installed', async () => ({ ok: true, ids: installedVersions().map((v) => v.id) }));

handle('settings:set', async (patch) => {
  const allowed = Object.keys(defaultSettings());
  for (const k of allowed) if (k in patch) store.settings[k] = patch[k];
  saveStore();
  return { ok: true, settings: store.settings };
});

handle('settings:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return { ok: true, path: r.canceled ? null : r.filePaths[0] };
});

handle('settings:pick-java', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Java', extensions: ['exe'] }]
  });
  return { ok: true, path: r.canceled ? null : r.filePaths[0] };
});

handle('settings:open-game-dir', async () => {
  fs.mkdirSync(store.settings.gameDir, { recursive: true });
  await shell.openPath(store.settings.gameDir);
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* Oyunu başlat                                                        */
/* ------------------------------------------------------------------ */
handle('game:launch', async (profileId) => {
  if (running) return { ok: false, error: 'Oyun zaten çalışıyor.' };

  const profile = store.profiles.find((p) => p.id === profileId);
  const account = store.accounts.find((a) => a.id === store.activeAccount);
  if (!profile) return { ok: false, error: 'Profil bulunamadı.' };
  if (!account) return { ok: false, error: 'Önce bir hesap ekle.' };

  send('game:state', { state: 'preparing' });
  send('game:progress', { task: 'Hesap doğrulanıyor', percent: null });
  const authorization = await getAuthFor(account);

  send('game:progress', { task: 'Java kontrol ediliyor', percent: null });
  const major = await requiredJava(profile.version);
  const javaPath = await ensureJava(major);

  fs.mkdirSync(store.settings.gameDir, { recursive: true });

  const launcher = new Client();
  launcher.on('debug', (m) => send('game:log', String(m)));
  launcher.on('data', (m) => send('game:log', String(m)));
  launcher.on('progress', (p) =>
    send('game:progress', {
      task: 'Dosyalar indiriliyor (' + p.type + ')',
      percent: p.total ? Math.round((p.task / p.total) * 100) : null
    })
  );
  launcher.on('close', (code) => {
    running = null;
    send('game:state', { state: 'idle', code });
    if (win && !win.isDestroyed() && store.settings.minimizeOnLaunch) {
      win.restore();
      win.focus();
    }
  });

  const proc = await launcher.launch({
    authorization,
    root: store.settings.gameDir,
    javaPath,
    version: { number: profile.version, type: profile.type || 'release' },
    memory: { min: profile.minRam + 'M', max: profile.maxRam + 'M' },
    customArgs: [
      ...(store.settings.globalJvmArgs || '').split(/\s+/).filter(Boolean),
      ...(profile.jvmArgs || '').split(/\s+/).filter(Boolean)
    ],
    window: { width: profile.width, height: profile.height, fullscreen: !!store.settings.fullscreen }
  });

  if (!proc) {
    send('game:state', { state: 'idle' });
    return { ok: false, error: 'Oyun başlatılamadı. Ayrıntı için günlüğe bak.' };
  }

  running = proc;
  send('game:state', { state: 'running' });
  if (store.settings.minimizeOnLaunch && win) win.minimize();
  return { ok: true };
});

handle('game:stop', async () => {
  if (running) running.kill();
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* Skinler                                                             */
/* ------------------------------------------------------------------ */
function pngSize(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function skinList() {
  return store.skins.map((s) => {
    const file = path.join(skinDir, s.id + '.png');
    return {
      ...s,
      dataUrl: fs.existsSync(file) ? toDataUrl(fs.readFileSync(file)) : null
    };
  });
}

handle('skins:list', async () => ({ ok: true, skins: skinList() }));

handle('skins:add', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Skin (PNG)', extensions: ['png'] }]
  });
  if (r.canceled) return { ok: true, skins: skinList() };
  fs.mkdirSync(skinDir, { recursive: true });
  const skipped = [];
  for (const file of r.filePaths) {
    const buf = fs.readFileSync(file);
    const size = pngSize(buf);
    if (!size || size.w !== 64 || (size.h !== 64 && size.h !== 32)) {
      skipped.push(path.basename(file));
      continue;
    }
    const id = crypto.randomUUID();
    fs.writeFileSync(path.join(skinDir, id + '.png'), buf);
    store.skins.push({ id, name: path.basename(file, path.extname(file)), variant: 'classic' });
  }
  saveStore();
  return { ok: true, skins: skinList(), skipped };
});

handle('skins:set-variant', async (id, variant) => {
  const s = store.skins.find((x) => x.id === id);
  if (s) {
    s.variant = variant === 'slim' ? 'slim' : 'classic';
    saveStore();
  }
  return { ok: true, skins: skinList() };
});

handle('skins:remove', async (id) => {
  store.skins = store.skins.filter((s) => s.id !== id);
  fs.rmSync(path.join(skinDir, id + '.png'), { force: true });
  saveStore();
  return { ok: true, skins: skinList() };
});

handle('skins:apply', async (id) => {
  const account = store.accounts.find((a) => a.id === store.activeAccount);
  if (!account || account.type !== 'microsoft') {
    return { ok: false, error: 'Skin yüklemek için Microsoft hesabıyla giriş yapmış olmalısın.' };
  }
  const skin = store.skins.find((s) => s.id === id);
  if (!skin) return { ok: false, error: 'Skin bulunamadı.' };
  const { access_token } = await getAuthFor(account);

  const fd = new FormData();
  fd.append('variant', skin.variant === 'slim' ? 'slim' : 'classic');
  fd.append(
    'file',
    new Blob([fs.readFileSync(path.join(skinDir, id + '.png'))], { type: 'image/png' }),
    'skin.png'
  );
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + access_token },
    body: fd
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* yoksay */
    }
    throw new Error('Skin yüklenemedi (' + res.status + '). ' + detail);
  }
  return { ok: true };
});

async function fetchAsDataUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Görsel indirilemedi (' + r.status + ')');
  return toDataUrl(Buffer.from(await r.arrayBuffer()));
}

// Microsoft hesabının güncel skini ve pelerinleri
handle('skins:current', async () => {
  const account = store.accounts.find((a) => a.id === store.activeAccount);
  if (!account || account.type !== 'microsoft') {
    return { ok: false, error: 'Mevcut skini görmek için Microsoft hesabı gerekli.' };
  }
  const { access_token } = await getAuthFor(account);
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: 'Bearer ' + access_token }
  });
  if (!res.ok) throw new Error('Profil alınamadı (' + res.status + ')');
  const prof = await res.json();

  const skinInfo = (prof.skins || []).find((s) => s.state === 'ACTIVE') || (prof.skins || [])[0];
  let skin = null;
  if (skinInfo) {
    skin = {
      dataUrl: await fetchAsDataUrl(skinInfo.url),
      variant: String(skinInfo.variant || 'CLASSIC').toLowerCase() === 'slim' ? 'slim' : 'classic'
    };
  }
  const capes = [];
  for (const c of prof.capes || []) {
    try {
      capes.push({ id: c.id, alias: c.alias || 'Pelerin', active: c.state === 'ACTIVE', dataUrl: await fetchAsDataUrl(c.url) });
    } catch {
      /* bu pelerini atla */
    }
  }
  return { ok: true, skin, capes };
});

// capeId verilirse o pelerini kullanır, null verilirse pelerini gizler
handle('capes:set', async (capeId) => {
  const account = store.accounts.find((a) => a.id === store.activeAccount);
  if (!account || account.type !== 'microsoft') return { ok: false, error: 'Pelerin için Microsoft hesabı gerekli.' };
  const { access_token } = await getAuthFor(account);
  const url = 'https://api.minecraftservices.com/minecraft/profile/capes/active';
  const res = capeId
    ? await fetch(url, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ capeId })
      })
    : await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + access_token } });
  if (!res.ok) throw new Error('Pelerin değiştirilemedi (' + res.status + ')');
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* Pencere                                                             */
/* ------------------------------------------------------------------ */
ipcMain.on('win:min', () => win && win.minimize());
ipcMain.on('win:max', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('win:close', () => win && win.close());

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 920,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f2a22',
    title: 'Limon Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    storeFile = path.join(app.getPath('userData'), 'limon-data.json');
    skinDir = path.join(app.getPath('userData'), 'skins');
    loadStore();
    Menu.setApplicationMenu(null);
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
      details.requestHeaders['Accept-Language'] = 'tr-TR,tr;q=0.9,en;q=0.6';
      cb({ requestHeaders: details.requestHeaders });
    });
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
