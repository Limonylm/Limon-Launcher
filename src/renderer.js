'use strict';
/* Limon Launcher arayüzü. Kullanıcıdan gelen metinler asla innerHTML ile basılmaz. */

const api = window.limon;
const $ = (sel, root = document) => root.querySelector(sel);

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

/* ---------- İkonlar ---------- */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  profiles: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  skins: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  market: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
};
const icon = (name) => h('span', { html: `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>` });

const LOGO =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 29c0-9 8-17 19-17 3 0 6 1 8 2l4-3 1 5c1 2 1 4 1 6 0 9-8 16-19 16-8 0-14-4-14-9z" fill="#ffd93b"/><path d="M33 12c2-5 8-7 12-5-1 5-6 8-12 5z" fill="#7cc35a"/></svg>';

function sliceSvg() {
  const pt = (r, a) => [100 + r * Math.cos((a * Math.PI) / 180), 100 + r * Math.sin((a * Math.PI) / 180)];
  let wedges = '';
  for (let i = 0; i < 8; i++) {
    const a0 = i * 45 + 3 - 90;
    const a1 = (i + 1) * 45 - 3 - 90;
    const [x0, y0] = pt(80, a0);
    const [x1, y1] = pt(80, a1);
    const [x2, y2] = pt(36, a1);
    const [x3, y3] = pt(36, a0);
    wedges += `<path class="slice" d="M${x0} ${y0}A80 80 0 0 1 ${x1} ${y1}L${x2} ${y2}A36 36 0 0 0 ${x3} ${y3}Z"/>`;
  }
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="100" cy="100" r="98" fill="#e9b800"/>
    <circle cx="100" cy="100" r="89" fill="#fff7d1"/>
    ${wedges}
    <circle cx="100" cy="100" r="33" fill="#0a1f19"/>
    <path class="icon-play" d="M90 82v36l30-18z" fill="#ffd93b"/>
    <rect class="icon-stop" x="88" y="88" width="24" height="24" rx="4" fill="#ffd93b"/>
  </svg>`;
}

/* ---------- Durum ---------- */
const S = {
  page: 'home',
  accounts: [],
  activeAccount: null,
  profiles: [],
  activeProfile: null,
  settings: {},
  skins: [],
  versions: null,
  stage: null, // skin sayfasındaki önizleme {dataUrl, slim, label}
  game: { state: 'idle', task: '', percent: null, log: [] }
};

const activeAccount = () => S.accounts.find((a) => a.id === S.activeAccount) || null;
const activeProfile = () => S.profiles.find((p) => p.id === S.activeProfile) || S.profiles[0] || null;

async function loadVersions() {
  const r = await api.versions();
  S.versions = r.ok ? r.versions : [];
  if (!r.ok) toast('Sürüm listesi alınamadı: ' + r.error, 'error');
  return S.versions;
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

/* ---------- Kabuk: başlık çubuğu + yan menü ---------- */
const NAV = [
  ['home', 'Ana sayfa'],
  ['profiles', 'Profiller'],
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
  render();
}

function render() {
  renderShell();
  const main = $('#main');
  main.textContent = '';
  const pages = { home: renderHome, profiles: renderProfiles, skins: renderSkins, market: renderMarket, settings: renderSettings };
  main.append(pages[S.page]());
  if (S.page === 'home') updateGameUI();
}

/* ---------- Ana sayfa ---------- */
function renderHome() {
  const p = activeProfile();
  const acc = activeAccount();
  const sel = h('select', {
    class: 'hero-select',
    'aria-label': 'Profil seç',
    onchange: async (e) => {
      applyProfileState(await api.profiles.select(e.target.value));
      render();
    }
  }, S.profiles.map((x) => h('option', { value: x.id, selected: x.id === S.activeProfile }, x.name)));

  const play = h('button', { class: 'play', id: 'play', 'aria-label': 'Oyna', onclick: play_ , html: sliceSvg() });

  return h('section', {},
    h('div', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('h1', {}, p ? p.name : 'Profil yok'),
        h('div', { class: 'hero-meta' },
          h('div', {}, 'Minecraft ', h('b', {}, p ? p.version : '-')),
          h('div', {}, h('b', {}, p ? (p.maxRam / 1024).toFixed(p.maxRam % 1024 ? 1 : 0) + ' GB' : '-'), ' bellek'),
          h('div', {}, acc ? ['Oyuncu ', h('b', {}, acc.name)] : 'Oynamak için bir hesap ekle')),
        sel),
      play),
    h('div', { class: 'status' },
      h('div', { class: 'status-text', id: 'status-text' }),
      h('div', { class: 'bar', id: 'bar' }, h('i', { id: 'bar-fill' }))),
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
  btn.setAttribute('aria-label', state === 'running' ? 'Durdur' : 'Oyna');

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

  const nameInput = h('input', { type: 'text', placeholder: 'Oyuncu adı', maxlength: '16', 'aria-label': 'Çevrimdışı oyuncu adı' });

  const draw = () => {
    box.textContent = '';
    if (!S.accounts.length) box.append(h('p', { class: 'page-sub' }, 'Henüz hesap yok. Microsoft ile giriş yap ya da çevrimdışı bir oyuncu adı ekle.'));
    for (const a of S.accounts) {
      const isActive = a.id === S.activeAccount;
      box.append(
        h('div', { class: 'acc-row' },
          avatar(a),
          h('div', { class: 'info' }, h('b', {}, a.name), h('small', {}, a.type === 'microsoft' ? 'Microsoft hesabı' : 'Çevrimdışı hesap')),
          isActive
            ? h('span', { class: 'tag lemon' }, 'Aktif')
            : h('button', { class: 'btn small', onclick: async () => { applyAccountState(await api.accounts.select(a.id)); draw(); renderShell(); } }, 'Seç'),
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
    } }, 'Microsoft ile giriş yap');

    const addOffline = async () => {
      const r = await api.accounts.addOffline(nameInput.value);
      if (applyAccountState(r)) { render(); draw(); }
      else toast(r.error, 'error');
    };
    nameInput.onkeydown = (e) => e.key === 'Enter' && addOffline();

    box.append(
      h('div', { class: 'section-label' }, 'Hesap ekle'),
      msBtn,
      h('div', { class: 'section-label' }, 'Çevrimdışı (korsan) hesap: sadece oyuncu adı gerekir'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, nameInput), h('button', { class: 'btn', onclick: addOffline }, 'Ekle'))
    );
  };
  draw();
}

/* ---------- Profiller ---------- */
function renderProfiles() {
  return h('section', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Profiller'),
        h('p', { class: 'page-sub' }, 'Her profil kendi Minecraft sürümüne, belleğine ve pencere boyutuna sahip olur.')),
      h('button', { class: 'btn primary', onclick: () => openProfileModal(null) }, 'Yeni profil')),
    h('div', { class: 'cards' },
      S.profiles.map((p) =>
        h('div', { class: 'card' + (p.id === S.activeProfile ? ' active' : '') },
          h('div', { class: 'info' },
            h('b', {}, p.name, p.id === S.activeProfile ? h('span', { class: 'tag lemon' }, 'Seçili') : null),
            h('small', {}, `Minecraft ${p.version}, ${(p.maxRam / 1024).toFixed(p.maxRam % 1024 ? 1 : 0)} GB bellek`)),
          h('div', { class: 'actions' },
            p.id === S.activeProfile ? null : h('button', { class: 'btn small', onclick: async () => { applyProfileState(await api.profiles.select(p.id)); render(); } }, 'Seç'),
            h('button', { class: 'btn small', onclick: () => openProfileModal(p) }, 'Düzenle'),
            h('button', { class: 'btn small danger', onclick: async () => {
              const r = await api.profiles.remove(p.id);
              if (applyProfileState(r)) render(); else toast(r.error, 'error');
            } }, 'Sil')))))
  );
}

async function openProfileModal(existing) {
  if (!S.versions || !S.versions.length) await loadVersions();
  const p = existing
    ? { ...existing }
    : { name: 'Yeni profil', version: (S.versions.find((v) => v.type === 'release') || {}).id || '1.21.1', type: 'release', minRam: 1024, maxRam: 4096, jvmArgs: '', width: 854, height: 480 };

  const name = h('input', { type: 'text', value: p.name, maxlength: '32', 'aria-label': 'Profil adı' });
  const sel = h('select', { 'aria-label': 'Sürüm' });
  const showAll = h('input', { type: 'checkbox' });
  const fill = () => {
    sel.textContent = '';
    const list = (S.versions || []).filter((v) => showAll.checked || v.type === 'release' || v.id === p.version);
    if (!list.length) sel.append(h('option', { value: p.version }, p.version));
    for (const v of list) sel.append(h('option', { value: v.id }, v.type === 'release' ? v.id : `${v.id} (${v.type.replace('old_', 'eski ')})`));
    sel.value = p.version;
  };
  showAll.addEventListener('change', () => { p.version = sel.value; fill(); });
  fill();

  const minRam = h('input', { type: 'number', value: p.minRam, min: '512', step: '256', 'aria-label': 'Minimum bellek' });
  const maxRam = h('input', { type: 'number', value: p.maxRam, min: '1024', step: '256', 'aria-label': 'Maksimum bellek' });
  const jvm = h('input', { type: 'text', value: p.jvmArgs, placeholder: 'Örn: -XX:+UseG1GC', 'aria-label': 'JVM argümanları' });
  const width = h('input', { type: 'number', value: p.width, min: '320', 'aria-label': 'Genişlik' });
  const height = h('input', { type: 'number', value: p.height, min: '240', 'aria-label': 'Yükseklik' });

  const body = h('div', {},
    h('div', { class: 'field' }, h('label', {}, 'Profil adı'), name),
    h('div', { class: 'field' }, h('label', {}, 'Sürüm'), sel,
      h('label', { class: 'row' }, showAll, h('small', {}, 'Snapshot ve eski sürümleri de göster'))),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', {}, 'En az bellek (MB)'), minRam),
      h('div', { class: 'field' }, h('label', {}, 'En çok bellek (MB)'), maxRam)),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', {}, 'Pencere genişliği'), width),
      h('div', { class: 'field' }, h('label', {}, 'Pencere yüksekliği'), height)),
    h('div', { class: 'field' }, h('label', {}, 'Ek JVM argümanları'), jvm)
  );

  const m = modal(existing ? 'Profili düzenle' : 'Yeni profil', body, [
    h('button', { class: 'btn', onclick: () => m.remove() }, 'Vazgeç'),
    h('button', { class: 'btn primary', onclick: async () => {
      const v = (S.versions || []).find((x) => x.id === sel.value);
      const r = await api.profiles.save({
        ...p,
        name: name.value,
        version: sel.value,
        type: v ? v.type : 'release',
        minRam: Number(minRam.value),
        maxRam: Number(maxRam.value),
        jvmArgs: jvm.value,
        width: Number(width.value),
        height: Number(height.value)
      });
      if (applyProfileState(r)) { m.remove(); render(); toast('Profil kaydedildi.', 'ok'); }
      else toast(r.error, 'error');
    } }, 'Kaydet')
  ]);
}

/* ---------- Skinler ---------- */
function drawSkin(canvas, dataUrl, slim) {
  const img = new Image();
  img.onload = () => {
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 16, 32);
    const legacy = img.height === 32;
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
    // temel katman
    blit(8, 8, 8, 8, 4, 0);
    blit(20, 20, 8, 12, 4, 8);
    blit(44, 20, aw, 12, slim ? 1 : 0, 8);
    if (legacy) blit(44, 20, aw, 12, 12, 8, true); else blit(36, 52, aw, 12, 12, 8);
    blit(4, 20, 4, 12, 4, 20);
    if (legacy) blit(4, 20, 4, 12, 8, 20, true); else blit(20, 52, 4, 12, 8, 20);
    // üst katman
    blit(40, 8, 8, 8, 4, 0);
    if (!legacy) {
      blit(20, 36, 8, 12, 4, 8);
      blit(44, 36, aw, 12, slim ? 1 : 0, 8);
      blit(52, 52, aw, 12, 12, 8);
      blit(4, 36, 4, 12, 4, 20);
      blit(4, 52, 4, 12, 8, 20);
    }
  };
  img.src = dataUrl;
}

function renderSkins() {
  if (!S.stage && S.skins.length) {
    const s = S.skins[0];
    S.stage = { id: s.id, dataUrl: s.dataUrl, slim: s.variant === 'slim', label: s.name };
  }
  const canvas = h('canvas', { width: '16', height: '32', 'aria-label': 'Skin önizlemesi' });
  const note = h('p', {}, S.stage ? S.stage.label : 'Bir skin seç veya ekle.');
  if (S.stage) drawSkin(canvas, S.stage.dataUrl, S.stage.slim);

  const showCurrent = async () => {
    const r = await api.skins.current();
    if (!r.ok) return toast(r.error, 'error');
    if (!r.skin) return toast('Hesabında özel bir skin görünmüyor.');
    S.stage = { id: null, dataUrl: r.skin.dataUrl, slim: r.skin.variant === 'slim', label: 'Hesabındaki skin' };
    render();
  };

  const stage = h('div', { class: 'skin-stage' }, canvas, note,
    h('button', { class: 'btn small', onclick: showCurrent }, 'Hesabımdaki skini göster'));

  const addSkins = async () => {
    const r = await api.skins.add();
    if (!r.ok) return toast(r.error, 'error');
    S.skins = r.skins;
    if (r.skipped && r.skipped.length) toast(r.skipped.join(', ') + ' atlandı. Skin 64x64 veya 64x32 PNG olmalı.', 'error');
    render();
  };

  let grid;
  if (!S.skins.length) {
    grid = h('div', { class: 'empty' }, 'Kütüphanen boş. Bir PNG skin dosyası ekleyerek başla.',
      h('div', {}, h('button', { class: 'btn primary', onclick: addSkins }, 'Skin ekle')));
  } else {
    grid = h('div', { class: 'skin-grid' }, S.skins.map((s) => {
      const c = h('canvas', { width: '16', height: '32', title: 'Önizle', onclick: () => {
        S.stage = { id: s.id, dataUrl: s.dataUrl, slim: s.variant === 'slim', label: s.name };
        render();
      } });
      drawSkin(c, s.dataUrl, s.variant === 'slim');
      const setVariant = async (v) => {
        const r = await api.skins.setVariant(s.id, v);
        S.skins = r.skins;
        if (S.stage && S.stage.id === s.id) S.stage.slim = v === 'slim';
        render();
      };
      return h('div', { class: 'skin-card' + (S.stage && S.stage.id === s.id ? ' selected' : '') },
        c,
        h('b', { title: s.name }, s.name),
        h('div', { class: 'seg' },
          h('button', { class: s.variant !== 'slim' ? 'on' : '', onclick: () => setVariant('classic') }, 'Klasik'),
          h('button', { class: s.variant === 'slim' ? 'on' : '', onclick: () => setVariant('slim') }, 'Slim')),
        h('div', { class: 'btns' },
          h('button', { class: 'btn small primary', onclick: async () => {
            const r = await api.skins.apply(s.id);
            if (r.ok) toast('Skin hesabına yüklendi. Oyuna girince görünür.', 'ok'); else toast(r.error, 'error');
          } }, 'Hesaba uygula'),
          h('button', { class: 'btn small danger', onclick: async () => {
            const r = await api.skins.remove(s.id);
            S.skins = r.skins;
            if (S.stage && S.stage.id === s.id) S.stage = null;
            render();
          } }, 'Sil')));
    }));
  }

  return h('section', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Skinler'),
        h('p', { class: 'page-sub' }, 'Skinlerini kütüphanende sakla ve Microsoft hesabına tek tıkla yükle. Çevrimdışı hesaplar için skin sunucu tarafında belirlenir, bu yüzden yükleme yapılamaz.')),
      h('button', { class: 'btn primary', onclick: addSkins }, 'Skin ekle')),
    h('div', { class: 'skin-layout' }, stage, grid)
  );
}

/* ---------- Market ---------- */
function renderMarket() {
  return h('section', {},
    h('h1', { class: 'page-title' }, 'Market'),
    h('p', { class: 'page-sub' }, 'Market hazırlanıyor. Skin paketleri, mod paketleri ve kozmetikler burada yer alacak.'),
    h('div', { class: 'market-grid' }, ['Skin paketleri', 'Mod paketleri', 'Kozmetikler'].map((t) => h('div', { class: 'market-tile' }, t)))
  );
}

/* ---------- Ayarlar ---------- */
function renderSettings() {
  const st = S.settings;
  const set = async (patch) => {
    const r = await api.settings.set(patch);
    if (r.ok) S.settings = r.settings;
    return r;
  };

  const dirInput = h('input', { type: 'text', value: st.gameDir, readonly: true, 'aria-label': 'Oyun klasörü' });
  const javaInput = h('input', { type: 'text', value: st.javaPath, placeholder: 'Otomatik (gereken Java kendiliğinden indirilir)', readonly: true, 'aria-label': 'Java yolu' });

  const switchRow = (title, sub, key) =>
    h('div', { class: 'toggle' },
      h('div', {}, h('b', {}, title), h('small', {}, sub)),
      h('label', { class: 'switch' },
        h('input', { type: 'checkbox', checked: !!st[key], onchange: async (e) => { await set({ [key]: e.target.checked }); } }),
        h('span')));

  return h('section', { style: 'max-width: 640px' },
    h('h1', { class: 'page-title' }, 'Ayarlar'),
    h('p', { class: 'page-sub' }, 'Oyun dosyalarının nerede duracağını ve launcher’ın oyun sırasındaki davranışını buradan belirle.'),
    h('div', { class: 'field' }, h('label', {}, 'Oyun klasörü'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, dirInput),
        h('button', { class: 'btn', onclick: async () => {
          const r = await api.settings.pickFolder();
          if (r.path) { await set({ gameDir: r.path }); dirInput.value = r.path; }
        } }, 'Değiştir'),
        h('button', { class: 'btn', onclick: () => api.settings.openGameDir() }, 'Aç'))),
    h('div', { class: 'field' }, h('label', {}, 'Java yolu'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, javaInput),
        h('button', { class: 'btn', onclick: async () => {
          const r = await api.settings.pickJava();
          if (r.path) { await set({ javaPath: r.path }); javaInput.value = r.path; }
        } }, 'Seç'),
        h('button', { class: 'btn', onclick: async () => { await set({ javaPath: '' }); javaInput.value = ''; } }, 'Otomatik'))),
    switchRow('Oyun açılınca launcher’ı küçült', 'Oyun kapanınca launcher geri gelir.', 'minimizeOnLaunch'),
    switchRow('Oyun günlüğünü göster', 'Ana sayfada oyunun çıktısını gösterir.', 'showLog')
  );
}

/* ---------- Başlangıç ---------- */
async function boot() {
  $('#btn-min').onclick = () => api.win.min();
  $('#btn-max').onclick = () => api.win.max();
  $('#btn-close').onclick = () => api.win.close();

  const [a, p, s, k] = await Promise.all([api.accounts.list(), api.profiles.list(), api.settings.get(), api.skins.list()]);
  applyAccountState(a);
  applyProfileState(p);
  if (s.ok) S.settings = s.settings;
  if (k.ok) S.skins = k.skins;

  bindGameEvents();
  render();
  loadVersions();
}

boot();
