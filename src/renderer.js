'use strict';
/* Limon Launcher arayüzü. Kullanıcıdan gelen metinler asla innerHTML ile basılmaz. */

const api = window.limon;
const $ = (sel, root = document) => root.querySelector(sel);
const HAS3D = !!(window.Skin3D && window.Skin3D.supported());

/* ---------- Küçük yardımcılar ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // yalnızca bu dosyadaki sabit SVG'ler için
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function toast(msg, kind) {
  const t = h('div', { class: 'toast ' + (kind || '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 4000);
}

function modal(title, body, actions) {
  const back = h(
    'div',
    { class: 'backdrop', onclick: (e) => e.target === back && back.remove() },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, title), body,
      actions ? h('div', { class: 'modal-actions' }, actions) : null)
  );
  document.body.append(back);
  return back;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const all = document.querySelectorAll('.backdrop');
    if (all.length) all[all.length - 1].remove();
  }
});

const fmtVer = (v) => String(v || '').replace(/\.0$/, '');
const gb = (mb) => (mb / 1024).toFixed(mb % 1024 ? 1 : 0);

/* ---------- İkonlar ---------- */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  versions: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  skins: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  market: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
};
const icon = (name) => h('span', { html: `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>` });

const LOGO =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 29c0-9 8-17 19-17 3 0 6 1 8 2l4-3 1 5c1 2 1 4 1 6 0 9-8 16-19 16-8 0-14-4-14-9z" fill="#ffd93b"/><path d="M33 12c2-5 8-7 12-5-1 5-6 8-12 5z" fill="#7cc35a"/></svg>';

/* ---------- Durum ---------- */
const S = {
  page: 'home',
  contentFor: null, // Sürümler sayfasında içerik yönetimi açık olan sürümün id'si
  accounts: [],
  activeAccount: null,
  profiles: [],
  activeProfile: null,
  settings: {},
  skins: [],
  versions: null,
  installed: [],
  sys: { totalMemMB: 8192, version: '', platform: '' },
  stage: null, // skin sayfası önizlemesi {id, dataUrl, slim, label}
  previewCape: undefined, // undefined: aktif pelerin, null: pelerin yok, string: pelerin id
  mc: { for: null, skin: null, capes: [], loading: false, loaded: false, error: null },
  snap: new Map(),
  game: { state: 'idle', task: '', percent: null, log: [] }
};

const activeAccount = () => S.accounts.find((a) => a.id === S.activeAccount) || null;
const activeProfile = () => S.profiles.find((p) => p.id === S.activeProfile) || S.profiles[0] || null;
const use3D = () => HAS3D && S.settings.viewer3d !== false;

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = S.settings.theme || 'lemon';
  root.dataset.motion = S.settings.animations === false ? 'off' : 'on';
}
async function setSetting(patch) {
  const r = await api.settings.set(patch);
  if (r.ok) {
    S.settings = r.settings;
    applySettings();
  }
  return r;
}

async function loadVersions() {
  const r = await api.versions();
  S.versions = r.ok ? r.versions : [];
  if (!r.ok) toast('Sürüm listesi alınamadı: ' + r.error, 'error');
  return S.versions;
}
async function loadInstalled() {
  const r = await api.installedVersions();
  if (r.ok) S.installed = r.ids;
}

function applyAccountState(r) {
  if (!r || !r.ok) return false;
  S.accounts = r.accounts;
  S.activeAccount = r.activeAccount;
  return true;
}
function applyProfileState(r) {
  if (!r || !r.ok) return false;
  S.profiles = r.profiles;
  S.activeProfile = r.activeProfile;
  return true;
}

/* ---------- Microsoft hesabının skini ve pelerinleri ---------- */
async function ensureMcProfile(force) {
  const acc = activeAccount();
  if (!acc || acc.type !== 'microsoft') {
    S.mc = { for: null, skin: null, capes: [], loading: false, loaded: false, error: null };
    return;
  }
  if (!force && S.mc.for === acc.id && (S.mc.loading || S.mc.loaded)) return;
  S.mc = { for: acc.id, skin: null, capes: [], loading: true, loaded: false, error: null };
  const r = await api.skins.current();
  if (S.mc.for !== acc.id) return;
  S.mc.loading = false;
  if (r.ok) {
    S.mc.skin = r.skin;
    S.mc.capes = r.capes || [];
    S.mc.loaded = true;
  } else {
    S.mc.error = r.error;
  }
  if (S.page === 'home' || S.page === 'skins') render();
}

const accountSkin = () => (S.mc.skin ? { dataUrl: S.mc.skin.dataUrl, slim: S.mc.skin.variant === 'slim', label: 'Hesabındaki skin', id: null } : null);
const activeCapeUrl = () => {
  const c = (S.mc.capes || []).find((x) => x.active);
  return c ? c.dataUrl : null;
};

/* ---------- Avatar ---------- */
function avatar(acc) {
  const el = h('div', { class: 'avatar' }, acc ? acc.name.charAt(0).toUpperCase() : '?');
  if (acc && acc.type === 'microsoft') {
    const img = h('img', { src: `https://mc-heads.net/avatar/${acc.uuid}/64`, alt: '' });
    img.addEventListener('load', () => {
      el.textContent = '';
      el.append(img);
    });
  }
  return el;
}

/* ---------- 2D skin çizimi ---------- */
function drawSkin2D(canvas, dataUrl, slim, back) {
  const img = new Image();
  img.onload = () => {
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 16, 32);
    const legacy = img.height * 2 === img.width;
    const aw = slim ? 3 : 4;
    const blit = (sx, sy, sw, sh, dx, dy, mirror) => {
      if (mirror) {
        c.save();
        c.translate(dx + sw, dy);
        c.scale(-1, 1);
        c.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        c.restore();
      } else {
        c.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
      }
    };
    if (!back) {
      // ön yüz
      blit(8, 8, 8, 8, 4, 0);
      blit(20, 20, 8, 12, 4, 8);
      blit(44, 20, aw, 12, slim ? 1 : 0, 8);
      if (legacy) blit(44, 20, aw, 12, 12, 8, true); else blit(36, 52, aw, 12, 12, 8);
      blit(4, 20, 4, 12, 4, 20);
      if (legacy) blit(4, 20, 4, 12, 8, 20, true); else blit(20, 52, 4, 12, 8, 20);
      blit(40, 8, 8, 8, 4, 0);
      if (!legacy) {
        blit(20, 36, 8, 12, 4, 8);
        blit(44, 36, aw, 12, slim ? 1 : 0, 8);
        blit(52, 52, aw, 12, 12, 8);
        blit(4, 36, 4, 12, 4, 20);
        blit(4, 52, 4, 12, 8, 20);
      }
    } else {
      // arka yüz: sağ/sol yer değiştirir
      blit(24, 8, 8, 8, 4, 0);
      blit(32, 20, 8, 12, 4, 8);
      blit(52, 20, aw, 12, 12, 8);                       // sağ kol (arkadan sağda görünür)
      if (legacy) blit(52, 20, aw, 12, slim ? 1 : 0, 8, true); else blit(44, 52, aw, 12, slim ? 1 : 0, 8);
      blit(12, 20, 4, 12, 8, 20);
      if (legacy) blit(12, 20, 4, 12, 4, 20, true); else blit(28, 52, 4, 12, 4, 20);
      blit(56, 8, 8, 8, 4, 0);
      if (!legacy) {
        blit(32, 36, 8, 12, 4, 8);
        blit(52, 36, aw, 12, 12, 8);
        blit(60, 52, aw, 12, slim ? 1 : 0, 8);
        blit(12, 36, 4, 12, 8, 20);
        blit(12, 52, 4, 12, 4, 20);
      }
    }
  };
  img.src = dataUrl;
}

/** Pelerinin dışarıdan görünen yüzünü küçük bir tuvale çizer. */
function drawCapeThumb(canvas, dataUrl) {
  const img = new Image();
  img.onload = () => {
    const s = img.width % 64 === 0 ? img.width / 64 : 1;
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(img, 1 * s, 1 * s, 10 * s, 16 * s, 0, 0, 10, 16);
  };
  img.src = dataUrl;
}

/* ---------- 3D anlık görüntü (kart önizlemeleri için tek WebGL bağlamı) ---------- */
let snapViewer = null;
let snapQueue = Promise.resolve();
function snapshot3D(dataUrl, slim) {
  const key = (slim ? '1|' : '0|') + dataUrl;
  if (S.snap.has(key)) return Promise.resolve(S.snap.get(key));
  const job = snapQueue.then(async () => {
    if (!snapViewer) {
      const c = document.createElement('canvas');
      c.width = 240; c.height = 300;
      snapViewer = new window.Skin3D(c, { detached: true, autoStart: false, preserve: true, dpr: 1, animated: false, yaw: 0.5 });
    }
    await snapViewer.setSkin(dataUrl, slim);
    const url = snapViewer.snapshot();
    S.snap.set(key, url);
    return url;
  });
  snapQueue = job.catch(() => {});
  return job;
}

/* ---------- Kabuk ---------- */
const NAV = [
  ['home', 'Ana sayfa'],
  ['versions', 'Sürümler'],
  ['skins', 'Skinler'],
  ['market', 'Market'],
  ['settings', 'Ayarlar']
];

function renderShell() {
  const brand = $('#brand');
  brand.textContent = '';
  brand.append(h('span', { html: LOGO }), 'Limon Launcher');

  const acc = activeAccount();
  const side = $('#sidebar');
  side.textContent = '';
  for (const [id, label] of NAV) {
    side.append(
      h('button', { class: 'nav-item' + (S.page === id ? ' active' : ''), onclick: () => go(id), title: label },
        icon(id), h('span', {}, label))
    );
  }
  side.append(
    h('div', { class: 'nav-spacer' }),
    h('button', { class: 'account-chip', onclick: openAccounts, title: 'Hesaplar' },
      avatar(acc),
      h('div', { class: 'who' },
        h('b', {}, acc ? acc.name : 'Hesap ekle'),
        h('small', {}, acc ? (acc.type === 'microsoft' ? 'Microsoft' : 'Çevrimdışı') : 'Giriş yapılmadı')))
  );
}

function go(page) {
  S.page = page;
  S.contentFor = null;
  render();
}

function render() {
  renderShell();
  const main = $('#main');
  const keep = main.scrollTop;
  main.textContent = '';
  const pages = { home: renderHome, versions: renderVersions, skins: renderSkins, market: renderMarket, settings: renderSettings };
  main.append(pages[S.page]());
  main.scrollTop = keep;
  if (S.page === 'home') updateGameUI();
}

/* ---------- Ana sayfa ---------- */
function renderHome() {
  ensureMcProfile();
  const p = activeProfile();
  const acc = activeAccount();

  const sel = h('select', {
    class: 'hero-select',
    'aria-label': 'Sürüm seç',
    onchange: async (e) => {
      applyProfileState(await api.profiles.select(e.target.value));
      render();
    }
  }, S.profiles.map((x) => h('option', { value: x.id, selected: x.id === S.activeProfile }, `${x.name} (${x.version})`)));

  const launch = h('button', {
    class: 'launch', id: 'play', onclick: play_,
    html: '<svg class="i-play" viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>' +
      '<svg class="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>' +
      '<svg class="i-busy" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke-dasharray="32 20"/></svg>' +
      '<span id="play-label">Oyunu başlat</span>'
  });

  const skinBox = h('div', { class: 'hero-skin' });
  const hs = accountSkin() || (S.skins[0] && { dataUrl: S.skins[0].dataUrl, slim: S.skins[0].variant === 'slim' });
  if (hs && HAS3D) {
    const canvas = h('canvas', { 'aria-label': 'Karakter önizlemesi' });
    skinBox.append(canvas);
    const v = new window.Skin3D(canvas, { animated: S.settings.viewerAnimation !== false });
    v.setSkin(hs.dataUrl, hs.slim).then(() => v.setCape(activeCapeUrl())).catch(() => {});
  } else if (hs) {
    const c = h('canvas', { width: '16', height: '32', style: 'width:110px;height:220px;image-rendering:pixelated' });
    skinBox.append(c);
    drawSkin2D(c, hs.dataUrl, hs.slim);
  } else {
    skinBox.append(h('div', { class: 'hero-empty' }, h('span', { html: LOGO }), 'Skinlerim sayfasından bir skin ekle, karakterin burada görünsün.'));
  }

  return h('section', {},
    h('div', { class: 'hero-card' },
      h('div', { class: 'hero-main' },
        h('h1', {}, p ? 'Minecraft ' + p.version : 'Sürüm yok'),
        h('div', { class: 'hero-name' }, p ? p.name : 'Sürümler sayfasından bir sürüm ekle.'),
        h('div', { class: 'chips' },
          p ? h('span', { class: 'chip' }, gb(p.maxRam) + ' GB bellek') : null,
          acc
            ? h('span', { class: 'chip' }, acc.name + (acc.type === 'microsoft' ? ' (Microsoft)' : ' (çevrimdışı)'))
            : h('button', { class: 'chip', onclick: openAccounts }, 'Hesap ekle')),
        h('div', { class: 'hero-actions' }, launch, S.profiles.length > 1 ? sel : null),
        h('div', { class: 'status' },
          h('div', { class: 'status-text', id: 'status-text' }),
          h('div', { class: 'bar', id: 'bar' }, h('i', { id: 'bar-fill' })))),
      skinBox),
    h('pre', { class: 'log', id: 'log', hidden: !S.settings.showLog })
  );
}

async function play_() {
  const st = S.game.state;
  if (st === 'running') return api.game.stop();
  if (st === 'preparing') return;
  if (!S.activeAccount) return openAccounts();
  S.game.log = [];
  setGame({ state: 'preparing', task: 'Hazırlanıyor', percent: null });
  const r = await api.game.launch(S.activeProfile);
  if (!r.ok) {
    setGame({ state: 'idle', task: '', percent: null });
    toast(r.error, 'error');
  }
}

function setGame(patch) {
  Object.assign(S.game, patch);
  updateGameUI();
}

function updateGameUI() {
  const btn = $('#play');
  if (!btn) return;
  const { state, task, percent } = S.game;
  btn.classList.toggle('busy', state === 'preparing');
  btn.classList.toggle('running', state === 'running');
  $('#play-label').textContent = state === 'running' ? 'Oyunu durdur' : state === 'preparing' ? 'Hazırlanıyor' : 'Oyunu başlat';

  const text = $('#status-text');
  const bar = $('#bar');
  const fill = $('#bar-fill');
  if (state === 'running') {
    text.textContent = 'Minecraft çalışıyor.';
    bar.style.visibility = 'hidden';
  } else if (state === 'preparing') {
    text.textContent = task || 'Hazırlanıyor';
    bar.style.visibility = 'visible';
    bar.classList.toggle('indeterminate', percent == null);
    fill.style.width = percent == null ? '' : percent + '%';
  } else {
    text.textContent = '';
    bar.style.visibility = 'hidden';
  }

  const log = $('#log');
  if (log) {
    log.textContent = S.game.log.join('\n');
    log.scrollTop = log.scrollHeight;
  }
}

function bindGameEvents() {
  api.game.onState(({ state, code }) => {
    setGame({ state, task: '', percent: null });
    if (state === 'idle' && code != null && code !== 0) {
      toast('Oyun beklenmedik şekilde kapandı (kod ' + code + '). Günlüğe bak.', 'error');
    }
    if (state === 'idle') loadInstalled();
  });
  api.game.onProgress(({ task, percent }) => {
    if (S.game.state === 'preparing') setGame({ task, percent });
  });
  api.game.onLog((line) => {
    S.game.log.push(...String(line).split(/\r?\n/).filter(Boolean));
    if (S.game.log.length > 400) S.game.log.splice(0, S.game.log.length - 400);
    if (S.page === 'home') updateGameUI();
  });
}

/* ---------- Hesaplar ---------- */
function openAccounts() {
  const box = h('div');
  const m = modal('Hesaplar', box, [h('button', { class: 'btn', onclick: () => m.remove() }, 'Kapat')]);

  const nameInput = h('input', { type: 'text', placeholder: 'Oyuncu adı', maxlength: '16', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Çevrimdışı oyuncu adı' });
  nameInput.addEventListener('mousedown', () => setTimeout(() => nameInput.focus(), 0));

  const draw = () => {
    box.textContent = '';
    if (!S.accounts.length) box.append(h('p', { class: 'note' }, 'Henüz hesap yok. Microsoft ile giriş yap ya da çevrimdışı bir oyuncu adı ekle.'));
    for (const a of S.accounts) {
      const isActive = a.id === S.activeAccount;
      box.append(
        h('div', { class: 'acc-row' },
          avatar(a),
          h('div', { class: 'info' }, h('b', {}, a.name), h('small', {}, a.type === 'microsoft' ? 'Microsoft hesabı' : 'Çevrimdışı hesap')),
          isActive
            ? h('span', { class: 'tag accent' }, 'Aktif')
            : h('button', { class: 'btn small', onclick: async () => { applyAccountState(await api.accounts.select(a.id)); draw(); render(); } }, 'Seç'),
          h('button', { class: 'btn small danger', onclick: async () => { applyAccountState(await api.accounts.remove(a.id)); draw(); render(); } }, 'Kaldır'))
      );
    }

    const msBtn = h('button', { class: 'btn primary', onclick: async () => {
      msBtn.disabled = true;
      msBtn.textContent = 'Giriş penceresi açık…';
      const r = await api.accounts.loginMs();
      if (applyAccountState(r)) { toast('Microsoft hesabı eklendi.', 'ok'); render(); }
      else toast(r.error, 'error');
      draw();
      window.focus();
    } }, 'Microsoft ile giriş yap');

    const addOffline = async () => {
      const r = await api.accounts.addOffline(nameInput.value);
      if (applyAccountState(r)) { nameInput.value = ''; render(); draw(); }
      else toast(r.error, 'error');
    };
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') addOffline(); };

    box.append(
      h('div', { class: 'section-label' }, 'Hesap ekle'),
      msBtn,
      h('div', { class: 'section-label' }, 'Çevrimdışı (korsan) hesap: sadece oyuncu adı gerekir'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, nameInput), h('button', { class: 'btn', onclick: addOffline }, 'Ekle'))
    );
  };
  draw();
  setTimeout(() => nameInput.focus(), 80);
}

/* ---------- Skinler ---------- */
function renderSkins() {
  ensureMcProfile();
  let viewer = null;
  let backView = false;

  if (!S.stage) S.stage = accountSkin() || (S.skins[0] && { id: S.skins[0].id, dataUrl: S.skins[0].dataUrl, slim: S.skins[0].variant === 'slim', label: S.skins[0].name }) || null;

  const stageView = h('div', { class: 'stage-view' });
  const hint = h('p', { class: 'stage-hint' }, 'Sürükleyerek döndür, tekerlekle yaklaş.');
  const label = h('p', { class: 'stage-label' });
  const grid = h('div');
  const capeBox = h('div');
  const t3d = h('button', { class: 'tog', onclick: async () => {
    await setSetting({ viewer3d: !use3D() });
    syncTools(); drawStage(); drawGrid();
  } }, '3D görünüm');
  const tAnim = h('button', { class: 'tog', onclick: async () => {
    await setSetting({ viewerAnimation: S.settings.viewerAnimation === false });
    syncTools();
    if (viewer) viewer.setAnimated(S.settings.viewerAnimation !== false);
  } }, 'Animasyon');

  const tBack = h('button', { class: 'tog', onclick: () => { backView = !backView; syncTools(); drawStage(); } }, 'Arka yüz');

  const syncTools = () => {
    tBack.classList.toggle('on', backView && !use3D());
    tBack.disabled = use3D();
    t3d.classList.toggle('on', use3D());
    t3d.disabled = !HAS3D;
    if (!HAS3D) t3d.title = 'Bu bilgisayarda WebGL kullanılamıyor';
    tAnim.classList.toggle('on', S.settings.viewerAnimation !== false && use3D());
    tAnim.disabled = !use3D();
    hint.hidden = !use3D();
  };

  const currentCape = () => {
    const capes = S.mc.capes || [];
    if (S.previewCape === undefined) return activeCapeUrl();
    if (S.previewCape === null) return null;
    const c = capes.find((x) => x.id === S.previewCape);
    return c ? c.dataUrl : null;
  };

  const drawStage = () => {
    if (viewer) { viewer.dispose(); viewer = null; }
    stageView.textContent = '';
    const st = S.stage;
    if (!st) {
      label.textContent = '';
      stageView.append(h('div', { class: 'note' }, 'Bir skin ekle veya seç.'));
      return;
    }
    label.textContent = st.label;
    if (use3D()) {
      const canvas = h('canvas', { class: 's3d', 'aria-label': 'Skin önizlemesi' });
      stageView.append(canvas);
      viewer = new window.Skin3D(canvas, { animated: S.settings.viewerAnimation !== false });
      const v = viewer;
      v.setSkin(st.dataUrl, st.slim).then(() => v.setCape(currentCape())).catch(() => toast('3D önizleme başlatılamadı.', 'error'));
    } else {
      const c = h('canvas', { class: 's2d', width: '16', height: '32', 'aria-label': 'Skin önizlemesi' });
      stageView.append(c);
      drawSkin2D(c, st.dataUrl, st.slim, backView);
    }
  };

  const selectSkin = (s) => {
    S.stage = { id: s.id, dataUrl: s.dataUrl, slim: s.variant === 'slim', label: s.name };
    drawStage(); drawGrid();
  };

  const addSkins = async () => {
    const r = await api.skins.add();
    if (!r.ok) return toast(r.error, 'error');
    S.skins = r.skins;
    if (r.skipped && r.skipped.length) toast(r.skipped.join(', ') + ' atlandı. Skin 64x64 veya 64x32 PNG olmalı.', 'error');
    if (!S.stage && S.skins[0]) selectSkin(S.skins[0]); else drawGrid();
  };

  const drawGrid = () => {
    grid.textContent = '';
    if (!S.skins.length) {
      grid.append(h('div', { class: 'empty' }, 'Kütüphanen boş. Bir PNG skin dosyası ekleyerek başla.',
        h('div', {}, h('button', { class: 'btn primary', onclick: addSkins }, 'Skin ekle'))));
      return;
    }
    const cards = S.skins.map((s) => {
      const view = h('div', { class: 'view', title: 'Önizle', onclick: () => selectSkin(s) });
      if (use3D()) {
        snapshot3D(s.dataUrl, s.variant === 'slim').then((url) => {
          view.textContent = '';
          view.append(h('img', { src: url, alt: s.name, draggable: 'false' }));
        }).catch(() => {
          const c = h('canvas', { class: 's2d', width: '16', height: '32' });
          view.append(c); drawSkin2D(c, s.dataUrl, s.variant === 'slim');
        });
      } else {
        const c = h('canvas', { class: 's2d', width: '16', height: '32' });
        view.append(c);
        drawSkin2D(c, s.dataUrl, s.variant === 'slim');
      }
      const setVariant = async (v) => {
        const r = await api.skins.setVariant(s.id, v);
        S.skins = r.skins;
        if (S.stage && S.stage.id === s.id) S.stage.slim = v === 'slim';
        drawStage(); drawGrid();
      };
      return h('div', { class: 'skin-card' + (S.stage && S.stage.id === s.id ? ' selected' : '') },
        view,
        h('b', { title: s.name }, s.name),
        h('div', { class: 'seg' },
          h('button', { class: s.variant !== 'slim' ? 'on' : '', onclick: () => setVariant('classic') }, 'Klasik'),
          h('button', { class: s.variant === 'slim' ? 'on' : '', onclick: () => setVariant('slim') }, 'Slim')),
        h('div', { class: 'btns' },
          h('button', { class: 'btn small primary', onclick: async () => {
            const r = await api.skins.apply(s.id);
            if (r.ok) { toast('Skin hesabına yüklendi. Oyuna girince görünür.', 'ok'); ensureMcProfile(true); }
            else toast(r.error, 'error');
          } }, 'Hesaba uygula'),
          h('button', { class: 'btn small danger', onclick: async () => {
            const r = await api.skins.remove(s.id);
            S.skins = r.skins;
            if (S.stage && S.stage.id === s.id) S.stage = null;
            if (!S.stage) S.stage = accountSkin() || (S.skins[0] && { id: S.skins[0].id, dataUrl: S.skins[0].dataUrl, slim: S.skins[0].variant === 'slim', label: S.skins[0].name }) || null;
            drawStage(); drawGrid();
          } }, 'Sil')));
    });
    grid.append(h('div', { class: 'skin-grid' }, cards));
  };

  const drawCapes = () => {
    capeBox.textContent = '';
    const acc = activeAccount();
    if (!acc || acc.type !== 'microsoft') {
      capeBox.append(h('p', { class: 'note' }, 'Pelerinler yalnızca orijinal (Microsoft) hesaplarda kullanılabilir. Pelerinlerini görmek için Microsoft ile giriş yap.'));
      return;
    }
    if (S.mc.loading) return capeBox.append(h('p', { class: 'note' }, 'Pelerinler yükleniyor…'));
    if (S.mc.error) return capeBox.append(h('p', { class: 'note' }, 'Pelerinler alınamadı: ' + S.mc.error));
    const capes = S.mc.capes || [];
    if (!capes.length) return capeBox.append(h('p', { class: 'note' }, 'Bu hesapta pelerin yok.'));

    const selectedId = S.previewCape === undefined ? (capes.find((c) => c.active) || {}).id : S.previewCape;
    capeBox.append(
      h('div', { class: 'cape-grid' }, capes.map((c) => {
        const cv = h('canvas', { width: '10', height: '16', title: 'Önizle', onclick: () => { S.previewCape = c.id; drawStage(); drawCapes(); } });
        drawCapeThumb(cv, c.dataUrl);
        return h('div', { class: 'cape-card' + (selectedId === c.id ? ' selected' : '') },
          cv, h('b', { title: c.alias }, c.alias),
          h('div', { class: 'btns' },
            c.active
              ? h('span', { class: 'tag accent' }, 'Hesapta aktif')
              : h('button', { class: 'btn small primary', onclick: async () => {
                const r = await api.capes.set(c.id);
                if (r.ok) { toast('Pelerin değiştirildi.', 'ok'); S.previewCape = undefined; await ensureMcProfile(true); }
                else toast(r.error, 'error');
              } }, 'Hesapta kullan')));
      })),
      capes.some((c) => c.active)
        ? h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn small', onclick: async () => {
          const r = await api.capes.set(null);
          if (r.ok) { toast('Pelerin gizlendi.', 'ok'); S.previewCape = undefined; await ensureMcProfile(true); }
          else toast(r.error, 'error');
        } }, 'Pelerini gizle'))
        : null
    );
  };

  const showAccountSkin = async () => {
    const acc = activeAccount();
    if (!acc || acc.type !== 'microsoft') return toast('Hesabındaki skini görmek için Microsoft hesabıyla giriş yap.', 'error');
    await ensureMcProfile(true);
    const a = accountSkin();
    if (!a) return toast(S.mc.error || 'Hesabında özel bir skin görünmüyor.');
    S.stage = a;
    drawStage(); drawGrid();
  };

  const stage = h('div', { class: 'skin-stage' },
    h('div', { class: 'stage-tools' }, t3d, tAnim, tBack),
    stageView, label,
    h('button', { class: 'btn small', onclick: showAccountSkin }, 'Hesabımdaki skini göster'),
    hint);

  syncTools(); drawStage(); drawGrid(); drawCapes();

  return h('section', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Skinler'),
        h('p', { class: 'page-sub' }, 'Skinlerini kütüphanende sakla ve Microsoft hesabına tek tıkla yükle. Çevrimdışı hesaplarda skin sunucu tarafından belirlendiği için yükleme yapılamaz.')),
      h('button', { class: 'btn primary', onclick: addSkins }, 'Skin ekle')),
    h('div', { class: 'skin-layout' },
      stage,
      h('div', { class: 'skin-side' },
        h('div', { class: 'side-head' }, h('h2', {}, 'Kütüphane'), h('small', {}, S.skins.length + ' skin')),
        grid,
        h('div', { class: 'side-head' }, h('h2', {}, 'Pelerinler')),
        capeBox))
  );
}

/* ---------- Market ---------- */
function renderMarket() {
  return h('section', {},
    h('h1', { class: 'page-title' }, 'Market'),
    h('p', { class: 'page-sub' }, 'Market hazırlanıyor. Skin paketleri ve kozmetikler burada yer alacak.'),
    h('div', { class: 'market-grid' }, ['Skin paketleri', 'Kozmetikler', 'Yakında'].map((t) => h('div', { class: 'market-tile' }, t)))
  );
}

/* ---------- Ayarlar ---------- */
function renderSettings() {
  const st = S.settings;

  const row = (title, sub, ctl, cls) =>
    h('div', { class: 'set-row' + (cls ? ' ' + cls : '') },
      h('div', { class: 'set-text' }, h('b', {}, title), sub ? h('small', {}, sub) : null),
      ctl ? h('div', { class: 'set-ctl' }, ctl) : null);
  const sw = (key) =>
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: !!st[key], onchange: (e) => setSetting({ [key]: e.target.checked }) }),
      h('span'));
  const group = (title, sub, ...rows) =>
    h('div', { class: 'set-group' }, h('div', { class: 'set-title' }, h('h2', {}, title)), rows);

  const dirInput = h('input', { type: 'text', value: st.gameDir, readonly: true, 'aria-label': 'Oyun klasörü' });
  const javaInput = h('input', { type: 'text', value: st.javaPath, placeholder: 'Boş bırakırsan otomatik seçilir', readonly: true, 'aria-label': 'Java yolu' });
  const jvmInput = h('input', { type: 'text', value: st.globalJvmArgs || '', placeholder: 'Örn: -XX:+UseG1GC', 'aria-label': 'Genel JVM argümanları' });
  jvmInput.addEventListener('change', () => setSetting({ globalJvmArgs: jvmInput.value.trim() }));

  // Test mesajı sayfa yeniden çizilince kaybolmasın diye kalıcı durumda tutulur (asıl "gel-git" sorunu buydu).
  const discordMsg = h('small', {}, S.discordTestMsg || '');
  const discordTestBtn = h('button', { class: 'btn', onclick: async () => {
    discordTestBtn.disabled = true; S.discordTestMsg = 'Discord\u2019a bağlanılıyor…'; discordMsg.textContent = S.discordTestMsg;
    const r = await api.settings.testDiscord();
    discordTestBtn.disabled = false;
    if (!r.ok) { S.discordTestMsg = r.error; discordMsg.textContent = S.discordTestMsg; return; }
    if (r.settings) S.settings = r.settings; // teste basmak anahtarı da açtıysa arayüzü güncelle
    S.discordTestMsg = r.connected
      ? 'Bağlandı! Discord profiline bak, 20-25 saniyeye kadar sürebilir.'
      : (r.error || 'Bağlanılamadı.');
    render();
  } }, 'Bağlantıyı dene');

  const discordLogBox = h('pre', { class: 'log', style: 'height:110px;margin-top:8px' });
  const refreshDiscordLog = (r) => { discordLogBox.textContent = (r.log || []).join('\n'); discordLogBox.scrollTop = discordLogBox.scrollHeight; };
  api.discordLog.get().then(refreshDiscordLog);
  if (!S.discordLogBound) {
    S.discordLogBound = true;
    api.discordLog.onLine((line) => {
      const box = document.querySelector('.log[style*="110px"]');
      if (box) { box.textContent += (box.textContent ? '\n' : '') + line; box.scrollTop = box.scrollHeight; }
    });
  }

  const cap = Math.min(32768, Math.max(2048, Math.floor((S.sys.totalMemMB - 1024) / 512) * 512));
  const ramVal = h('b', {}, gb(st.defaultMaxRam || 4096) + ' GB');
  const ram = h('input', { type: 'range', min: '1024', max: String(cap), step: '256', value: String(Math.min(st.defaultMaxRam || 4096, cap)), 'aria-label': 'Varsayılan bellek' });
  ram.addEventListener('input', () => { ramVal.textContent = gb(Number(ram.value)) + ' GB'; });
  ram.addEventListener('change', () => setSetting({ defaultMaxRam: Number(ram.value) }));

  const THEMES = [['lemon', 'Limon (siyah-sarı)'], ['emerald', 'Zümrüt'], ['ocean', 'Okyanus'], ['violet', 'Menekşe']];
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Tema' },
    THEMES.map(([id, label]) => h('button', {
      class: 'swatch' + ((st.theme || 'lemon') === id ? ' on' : ''), 'data-c': id, title: label, 'aria-label': label,
      onclick: async () => { await setSetting({ theme: id }); render(); }
    })));
  const updateMsg = h('small', {}, '');
  const checkBtn = h('button', { class: 'btn', onclick: async () => {
    checkBtn.disabled = true; updateMsg.textContent = 'Denetleniyor…';
    const r = await api.update.check();
    checkBtn.disabled = false;
    if (!r.ok) { updateMsg.textContent = r.error; return; }
    if (r.available) { S.update = { info: r, percent: null }; renderBanner(); updateMsg.textContent = 'Yeni sürüm var: v' + fmtVer(r.version); }
    else if (r.reason === 'not-found') updateMsg.textContent = 'Sürüm bilgisi alınamadı. GitHub deposu gizliyse güncelleme denetlenemez.';
    else if (r.reason) updateMsg.textContent = 'Denetlenemedi, internet bağlantını kontrol et.';
    else updateMsg.textContent = 'Launcher güncel (v' + fmtVer(r.current) + ').';
  } }, 'Şimdi denetle');

  return h('section', { class: 'set-wrap' },
    h('h1', { class: 'page-title' }, 'Ayarlar'),
    h('p', { class: 'page-sub' }, 'Oyunun nasıl başlayacağını ve launcher’ın görünümünü buradan belirle. Değişiklikler anında kaydedilir.'),

    group('Oyun', '',
      h('div', { class: 'set-row stack' },
        h('div', { class: 'set-text' }, h('b', {}, 'Oyun klasörü'), h('small', {}, 'Sürümler, dünyalar ve modlar burada durur.')),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, dirInput),
          h('button', { class: 'btn', onclick: async () => {
            const r = await api.settings.pickFolder();
            if (r.path) { await setSetting({ gameDir: r.path }); dirInput.value = r.path; loadInstalled(); }
          } }, 'Değiştir'),
          h('button', { class: 'btn', onclick: () => api.settings.openGameDir() }, 'Aç'))),
      row('Java’yı otomatik indir', 'Sürümün ihtiyaç duyduğu Java kendiliğinden kurulur. Kapatırsan bilgisayardaki Java kullanılır.', sw('autoJava')),
      h('div', { class: 'set-row stack' },
        h('div', { class: 'set-text' }, h('b', {}, 'Özel Java yolu'), h('small', {}, 'Kendi Java kurulumunu kullanmak istersen javaw.exe dosyasını seç.')),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, javaInput),
          h('button', { class: 'btn', onclick: async () => {
            const r = await api.settings.pickJava();
            if (r.path) { await setSetting({ javaPath: r.path }); javaInput.value = r.path; }
          } }, 'Seç'),
          h('button', { class: 'btn', onclick: async () => { await setSetting({ javaPath: '' }); javaInput.value = ''; } }, 'Sıfırla'))),
      h('div', { class: 'set-row stack' },
        h('div', { class: 'set-text' }, h('b', {}, 'Yeni sürümler için varsayılan bellek'), h('small', {}, 'Sürüm eklerken bu değer kullanılır. Her sürümü ayrıca değiştirebilirsin.')),
        h('div', { class: 'ram-box' }, h('div', { class: 'ram-top' }, ramVal), ram)),
      h('div', { class: 'set-row stack' },
        h('div', { class: 'set-text' }, h('b', {}, 'Tüm sürümler için JVM argümanları'), h('small', {}, 'Ne yaptığını bilmiyorsan boş bırak.')),
        jvmInput),
      row('Tam ekran başlat', 'Oyun tam ekran açılır.', sw('fullscreen')),
      row('Oyun açılınca launcher’ı küçült', 'Oyun kapanınca launcher geri gelir.', sw('minimizeOnLaunch'))
    ),

    group('Görünüm', '',
      row('Tema', 'Launcher’ın renkleri. Varsayılan siyah ve sarı.', swatches),
      row('Arayüz animasyonları', 'Kapatırsan geçiş efektleri durur.', sw('animations')),
      row('Skinleri 3D göster', 'Skin sayfasında ve kartlarda 3D önizleme kullanılır.', sw('viewer3d')),
      row('3D karakter animasyonu', 'Karakter yürür ve yavaşça döner.', sw('viewerAnimation')),
      row('Oyun günlüğünü göster', 'Ana sayfada oyunun çıktısını gösterir.', h('label', { class: 'switch' },
        h('input', { type: 'checkbox', checked: !!st.showLog, onchange: (e) => setSetting({ showLog: e.target.checked }) }), h('span')))
    ),

    group('Launcher', '',
      row('Windows ile başlat', 'Bilgisayar açılınca Limon Launcher kendiliğinden çalışır.', sw('launchAtStartup')),
      row('Kapatınca sistem tepsisine küçült', 'Pencereyi kapatmak launcher\u2019ı tamamen kapatmaz, sistem tepsisinde bekletir. Tamamen kapatmak için tepsi simgesinden \u201cÇıkış\u201d\u2019a bas.', sw('minimizeToTray'))
    ),

    group('Discord', '',
      row('Discord\u2019da göster', 'Discord\u2019da neyle uğraştığın görünür: menüde ya da oynadığın Minecraft sürümü ve sunucusu.', sw('discordRpc')),
      row('Sunucu adresini göster', 'Kapatırsan yalnızca \u201cSunucuda oynuyor\u201d yazar, adres görünmez.', sw('discordShowServer')),
      h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('b', {}, 'Bağlantıyı dene'), discordMsg), h('div', { class: 'set-ctl' }, discordTestBtn)),
      h('div', { class: 'set-row stack' },
        h('div', { class: 'set-text' }, h('b', {}, 'Bağlantı günlüğü'), h('small', {}, 'Bağlandı/koptu zamanlarını gösterir, bir sorun olduğunda bunu bana gönder.')),
        discordLogBox)
    ),

    group('Güncelleme', '',
      row('Otomatik güncelle', 'Yeni sürüm çıkınca launcher açılışta kendini günceller.', sw('autoUpdate')),
      h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('b', {}, 'Güncellemeleri denetle'), updateMsg), h('div', { class: 'set-ctl' }, checkBtn))
    ),

    group('Bakım', '',
      row('Launcher verileri', 'Hesaplar, profiller ve skin kütüphanesi burada saklanır.', h('button', { class: 'btn', onclick: () => api.settings.openDataDir() }, 'Klasörü aç')),
      row('Ayarları sıfırla', 'Tüm ayarlar varsayılana döner. Hesapların, sürümlerin ve skinlerin silinmez.', h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('Tüm ayarlar varsayılana dönsün mü?')) return;
        const r = await api.settings.reset();
        if (r.ok) { S.settings = r.settings; applySettings(); render(); toast('Ayarlar sıfırlandı.', 'ok'); }
      } }, 'Sıfırla')),
      h('div', { class: 'about' }, `Limon Launcher v${fmtVer(S.sys.version)}`, h('br'), `Bu bilgisayarda ${gb(S.sys.totalMemMB)} GB RAM var.`, h('br'), HAS3D ? '3D önizleme kullanılabilir.' : '3D önizleme bu bilgisayarda kullanılamıyor.')
    )
  );
}

/* ---------- Güncelleme çubuğu & indirme kartı ---------- */
function renderBanner() {
  const b = $('#banner');
  const u = S.update;
  b.textContent = '';
  if (!u || u.dismissed) { b.hidden = true; return; }
  b.hidden = false;
  if (u.error) {
    b.append(h('span', {}, 'Güncelleme başarısız: ' + u.error), h('button', { class: 'btn ghost', onclick: () => { u.dismissed = true; renderBanner(); } }, 'Kapat'));
  } else if (u.percent != null) {
    b.append(h('span', {}, 'v' + fmtVer(u.info.version) + ' indiriliyor… %' + u.percent), h('div', { class: 'bar' }, h('i', { style: 'width:' + u.percent + '%' })));
  } else {
    b.append(
      h('span', {}, 'Yeni sürüm hazır: v' + fmtVer(u.info.version)),
      h('button', { class: 'btn', onclick: async () => {
        u.percent = 0; renderBanner();
        const r = await api.update.install();
        if (!r.ok) { u.error = r.error; u.percent = null; renderBanner(); }
      } }, 'Güncelle'),
      h('button', { class: 'btn ghost', onclick: () => { u.dismissed = true; renderBanner(); } }, 'Sonra'));
  }
}

function bindUpdateEvents() {
  api.update.onAvailable((info) => { S.update = { info, percent: null }; renderBanner(); });
  api.update.onProgress(({ percent, version }) => {
    if (!S.update) S.update = { info: { version }, percent };
    S.update.percent = percent;
    renderBanner();
  });
  api.update.onError(({ message }) => { if (S.update) { S.update.error = message; S.update.percent = null; renderBanner(); } });
}

let dlTimer = null;
function bindContentProgress() {
  api.content.onProgress((d) => {
    const card = $('#dl');
    if (d.done) {
      clearTimeout(dlTimer);
      dlTimer = setTimeout(() => { card.hidden = true; }, 600);
      return;
    }
    clearTimeout(dlTimer);
    card.hidden = false;
    $('#dl-text').textContent = d.task || 'İndiriliyor';
    const bar = $('#dl-bar');
    bar.classList.toggle('indeterminate', d.percent == null);
    $('#dl-fill').style.width = d.percent == null ? '' : d.percent + '%';
  });
}

/* ---------- Başlangıç ---------- */
async function boot() {
  $('#btn-min').onclick = () => api.win.min();
  $('#btn-max').onclick = () => api.win.max();
  $('#btn-close').onclick = () => api.win.close();

  const [a, p, s, k, sys] = await Promise.all([
    api.accounts.list(), api.profiles.list(), api.settings.get(), api.skins.list(), api.system()
  ]);
  applyAccountState(a);
  applyProfileState(p);
  if (s.ok) S.settings = s.settings;
  if (k.ok) S.skins = k.skins;
  if (sys.ok) S.sys = sys;
  applySettings();

  bindGameEvents();
  bindUpdateEvents();
  bindContentProgress();
  render();
  loadVersions();
  loadInstalled();
}

window.addEventListener('DOMContentLoaded', boot);
