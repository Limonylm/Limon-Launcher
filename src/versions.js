'use strict';
/* Sürümler sayfası: sürüm ekleme sihirbazı, ayarlama, klasör açma, temiz kurulum. */

const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt' };
const sep = () => (S.sys.platform === 'win32' ? '\\' : '/');

function loaderChips(current, onPick) {
  const box = h('div', { class: 'chips' });
  const draw = () => {
    box.textContent = '';
    for (const [id, label] of Object.entries(LOADER_NAMES)) {
      box.append(h('button', { class: 'chip' + (current() === id ? ' on' : ''), onclick: () => { onPick(id); draw(); } }, label));
    }
    box.append(h('button', { class: 'chip', disabled: true, title: 'Yakında' }, 'Forge (yakında)'), h('button', { class: 'chip', disabled: true, title: 'Yakında' }, 'NeoForge (yakında)'));
  };
  draw();
  return box;
}

/* ---------- Sürümler sayfası ---------- */
function renderVersions() {
  if (S.contentFor) {
    const cp = S.profiles.find((x) => x.id === S.contentFor);
    if (cp) return renderVersionDetail(cp);
    S.contentFor = null;
  }
  loadInstalled().then(() => {
    if (S.page === 'versions') {
      document.querySelectorAll('[data-ver]').forEach((el) => { el.hidden = !S.installed.includes(el.dataset.ver); });
    }
  });

  const select = async (p) => { if (p.id !== S.activeProfile) { applyProfileState(await api.profiles.select(p.id)); render(); } };

  const tiles = S.profiles.map((p) => {
    const active = p.id === S.activeProfile;
    return h('div', {
      class: 'ver-tile' + (active ? ' active' : ''), tabindex: '0', role: 'button',
      onclick: () => select(p),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p); } }
    },
      h('div', { class: 'ver-top' },
        h('span', { class: 'ver-num' }, p.version),
        h('span', { class: 'tag', 'data-ver': p.version, hidden: !S.installed.includes(p.version) }, 'İndirildi')),
      h('div', { class: 'ver-name' }, p.name),
      h('div', { class: 'chips' },
        p.loader && p.loader !== 'vanilla' ? h('span', { class: 'chip loader' }, LOADER_NAMES[p.loader]) : null,
        h('span', { class: 'chip' }, gb(p.maxRam) + ' GB'),
        p.dirMode === 'own' ? h('span', { class: 'chip', title: 'Bu sürümün kendi klasörü var' }, 'Özel klasör') : null,
        active ? h('span', { class: 'tag accent' }, 'Seçili') : null),
      h('div', { class: 'ver-actions' },
        h('button', { class: 'btn small primary', onclick: (e) => { e.stopPropagation(); S.contentFor = p.id; render(); } }, 'Mod ve paketler'),
        h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); openProfileModal(p); } }, 'Ayarla'),
        h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); api.profiles.openDir(p.id); } }, 'Klasör'),
        h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); openCleanInstall(p); } }, 'Temiz kurulum'),
        h('button', { class: 'btn small danger', onclick: async (e) => {
          e.stopPropagation();
          const r = await api.profiles.remove(p.id);
          if (applyProfileState(r)) render(); else toast(r.error, 'error');
        } }, 'Sil')));
  });

  tiles.push(
    h('div', { class: 'ver-tile add', tabindex: '0', role: 'button', onclick: openVersionPicker,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVersionPicker(); } } },
      h('div', { class: 'plus' }, '+'), h('div', {}, 'Sürüm ekle'))
  );

  return h('section', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Sürümler'),
        h('p', { class: 'page-sub' }, 'Oynamak istediğin Minecraft sürümlerini ekle. Her sürümün belleği, mod yükleyicisi ve klasörü ayrı tutulur. Mod, texture ve shader yüklemek için kartındaki “Mod ve paketler” düğmesini kullan.')),
      h('button', { class: 'btn primary', onclick: openVersionPicker }, 'Sürüm ekle')),
    h('div', { class: 'ver-grid' }, tiles)
  );
}

/* ---------- Temiz kurulum ---------- */
function openCleanInstall(p) {
  const wipe = h('input', { type: 'checkbox' });
  const own = p.dirMode === 'own';
  const body = h('div', {},
    h('p', { class: 'note' }, `Minecraft ${p.version} dosyaları silinir ve bir sonraki başlatmada yeniden indirilir. Oyun bozulduysa ya da takıldıysa işe yarar. Dünyaların, ayarların ve modların dokunulmaz.`),
    own
      ? h('label', { class: 'check' }, wipe, h('span', {}, 'Bu sürümün oyun verilerini de sil: dünyalar, modlar, kaynak paketleri ve ayarlar. Bu geri alınamaz.'))
      : h('p', { class: 'wiz-note' }, 'Bu sürüm ortak klasörü kullandığı için oyun verileri hiçbir zaman silinmez.'));
  const m = modal('Temiz kurulum', body, [
    h('button', { class: 'btn', onclick: () => m.remove() }, 'Vazgeç'),
    h('button', { class: 'btn primary', onclick: async () => {
      const r = await api.profiles.cleanInstall({ id: p.id, wipeData: own && wipe.checked });
      m.remove();
      if (r.ok) { toast('Temiz kurulum hazır. Oyunu başlatınca dosyalar yeniden indirilir.', 'ok'); loadInstalled().then(() => S.page === 'versions' && render()); }
      else toast(r.error, 'error');
    } }, 'Temiz kurulum yap')
  ]);
}

/* ---------- Sürüm ekleme sihirbazı ---------- */
async function openVersionPicker() {
  if (!S.versions || !S.versions.length) await loadVersions();
  let mode = 'release';
  let query = '';
  const MODES = [['release', 'Sürümler'], ['snapshot', 'Snapshot'], ['old', 'Eski sürümler'], ['modpack', 'Modpack (Modrinth)']];
  const matches = (v) => mode === 'release' ? v.type === 'release' : mode === 'snapshot' ? v.type === 'snapshot' : v.type.startsWith('old');

  const body = h('div');
  const m = modal('Sürüm ekle', body);
  const finishAdd = async (r, msg) => {
    if (!applyProfileState(r)) return toast(r.error, 'error');
    const added = S.profiles[S.profiles.length - 1];
    applyProfileState(await api.profiles.select(added.id));
    m.remove();
    render();
    toast(msg, 'ok');
  };

  /* Adım 1: sürüm ya da modpack seç */
  const drawPick = () => {
    body.textContent = '';
    const search = h('input', { type: 'text', value: query, autocomplete: 'off', placeholder: mode === 'modpack' ? 'Modpack ara' : 'Sürüm ara, örneğin 1.20', 'aria-label': 'Ara' });
    const chips = h('div', { class: 'chips' }, MODES.map(([id, label]) =>
      h('button', { class: 'chip' + (mode === id ? ' on' : ''), onclick: () => { mode = id; query = ''; drawPick(); } }, label)));
    const list = h('div', { class: 'vp-list' });
    body.append(h('div', { class: 'vp-tools' }, search, chips), list,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.remove() }, 'Kapat')));

    const drawVersions = () => {
      list.textContent = '';
      const rows = (S.versions || []).filter((v) => matches(v) && v.id.toLowerCase().includes(query)).slice(0, 150);
      if (!rows.length) list.append(h('div', { class: 'vp-empty' }, 'Bu aramayla eşleşen sürüm yok.'));
      for (const v of rows) {
        list.append(h('div', { class: 'vp-row' },
          h('b', {}, v.id), h('small', {}, v.releaseTime ? v.releaseTime.slice(0, 10) : ''),
          S.installed.includes(v.id) ? h('span', { class: 'tag' }, 'İndirildi') : null,
          h('button', { class: 'btn small primary', onclick: () => drawSetup(v) }, 'Seç')));
      }
    };

    let timer = null;
    let seq = 0;
    const drawPacks = async () => {
      const my = ++seq;
      list.textContent = '';
      list.append(h('div', { class: 'vp-empty' }, 'Modrinth’ten yükleniyor…'));
      const r = await api.modrinth.search({ query, type: 'modpack', index: query ? 'relevance' : 'downloads', limit: 20 });
      if (my !== seq) return;
      list.textContent = '';
      if (!r.ok) return list.append(h('div', { class: 'vp-empty' }, 'Modrinth’e bağlanılamadı: ' + r.error));
      if (!r.hits.length) return list.append(h('div', { class: 'vp-empty' }, 'Sonuç bulunamadı.'));
      for (const hit of r.hits) {
        const btn = h('button', { class: 'btn small primary', onclick: async () => {
          btn.disabled = true; btn.textContent = 'Kuruluyor…';
          const res = await api.modrinth.installModpack({ projectId: hit.id });
          if (res.ok) finishAdd(res, hit.title + ' kuruldu ve seçildi.');
          else { btn.disabled = false; btn.textContent = 'Kur'; toast(res.error, 'error'); }
        } }, 'Kur');
        list.append(h('div', { class: 'mp-row' },
          hit.icon ? h('img', { src: hit.icon, alt: '' }) : h('div', { class: 'mk-icon' }),
          h('div', { class: 'info' }, h('b', { title: hit.title }, hit.title), h('small', {}, `${hit.author} · ${new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(hit.downloads)} indirme`)),
          btn));
      }
    };

    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      if (mode === 'modpack') { clearTimeout(timer); timer = setTimeout(drawPacks, 350); } else drawVersions();
    });
    if (mode === 'modpack') drawPacks(); else drawVersions();
    setTimeout(() => search.focus(), 60);
  };

  /* Adım 2: kurulum ayarları */
  const drawSetup = (v) => {
    let loader = 'vanilla';
    let dirMode = 'own';
    body.textContent = '';
    const name = h('input', { type: 'text', value: 'Minecraft ' + v.id, maxlength: '32', 'aria-label': 'Ad' });
    const note = h('p', { class: 'wiz-note' });
    const pathEl = h('div', { class: 'wiz-path' });
    const seg = h('div', { class: 'seg wide' });
    const drawDir = () => {
      seg.textContent = '';
      seg.append(
        h('button', { class: dirMode === 'own' ? 'on' : '', onclick: () => { dirMode = 'own'; drawDir(); } }, 'Bu sürüme özel klasör'),
        h('button', { class: dirMode === 'shared' ? 'on' : '', onclick: () => { dirMode = 'shared'; drawDir(); } }, 'Ortak klasör'));
      note.textContent = dirMode === 'own'
        ? 'Önerilen. Modlar, dünyalar ve ayarlar yalnızca bu sürüme ait olur, temiz bir başlangıç yaparsın.'
        : 'Tüm ortak klasörlü sürümler aynı dünyaları, modları ve ayarları paylaşır.';
      pathEl.textContent = dirMode === 'own' ? `${S.settings.gameDir}${sep()}instances${sep()}${(name.value || 'surum').trim().toLowerCase().replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'surum'}-xxxxxx` : S.settings.gameDir;
    };
    name.addEventListener('input', drawDir);
    drawDir();

    body.append(
      h('div', { class: 'field' }, h('label', {}, 'Ad'), name),
      h('div', { class: 'field' }, h('label', {}, 'Mod yükleyici'), loaderChips(() => loader, (id) => { loader = id; })),
      h('div', { class: 'field' }, h('label', {}, 'Kurulum yeri'), seg, note, pathEl),
      h('p', { class: 'wiz-note' }, `Minecraft ${v.id}. Oyun dosyaları ilk başlatmada indirilir. Belleği sonra “Ayarla”dan değiştirebilirsin.`),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: drawPick }, 'Geri'),
        h('button', { class: 'btn primary', onclick: async () => {
          const r = await api.profiles.save({
            name: name.value, version: v.id, type: v.type, loader, loaderVersion: '', dirMode,
            minRam: 1024, maxRam: S.settings.defaultMaxRam || 4096, jvmArgs: '', width: 854, height: 480
          });
          finishAdd(r, v.id + ' eklendi ve seçildi.');
        } }, 'Ekle')));
    setTimeout(() => name.select(), 60);
  };

  drawPick();
}

/* ---------- Sürümü ayarla ---------- */
async function openProfileModal(existing) {
  if (!S.versions || !S.versions.length) await loadVersions();
  const p = { ...existing };
  let loader = p.loader || 'vanilla';

  const name = h('input', { type: 'text', value: p.name, maxlength: '32', 'aria-label': 'Ad' });
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

  const cap = Math.min(32768, Math.max(2048, Math.floor((S.sys.totalMemMB - 1024) / 512) * 512));
  const ramLabel = h('b', {}, gb(p.maxRam) + ' GB');
  const slider = h('input', { type: 'range', min: '1024', max: String(cap), step: '256', value: String(Math.min(p.maxRam, cap)), 'aria-label': 'Bellek' });
  slider.addEventListener('input', () => { ramLabel.textContent = gb(Number(slider.value)) + ' GB'; });
  const presets = h('div', { class: 'chips' }, [2048, 4096, 6144, 8192].filter((v) => v <= cap).map((v) =>
    h('button', { class: 'chip', onclick: () => { slider.value = String(v); slider.dispatchEvent(new Event('input')); } }, gb(v) + ' GB')));

  const minRam = h('input', { type: 'number', value: p.minRam, min: '512', step: '256', 'aria-label': 'En az bellek' });
  const jvm = h('input', { type: 'text', value: p.jvmArgs, placeholder: 'Örn: -XX:+UseG1GC', 'aria-label': 'JVM argümanları' });
  const width = h('input', { type: 'number', value: p.width, min: '320', 'aria-label': 'Genişlik' });
  const height = h('input', { type: 'number', value: p.height, min: '240', 'aria-label': 'Yükseklik' });

  const body = h('div', {},
    h('div', { class: 'field' }, h('label', {}, 'Ad'), name),
    h('div', { class: 'field' }, h('label', {}, 'Minecraft sürümü'), sel,
      h('label', { class: 'row' }, showAll, h('small', {}, 'Snapshot ve eski sürümleri de göster'))),
    h('div', { class: 'field' }, h('label', {}, 'Mod yükleyici'), loaderChips(() => loader, (id) => { loader = id; })),
    h('div', { class: 'field ram-box' },
      h('div', { class: 'ram-top' }, ramLabel, h('small', {}, 'Bu bilgisayarda ' + gb(S.sys.totalMemMB) + ' GB RAM var')),
      slider, presets),
    h('div', { class: 'field' }, h('label', {}, 'Kurulum yeri'),
      h('div', { class: 'wiz-note' }, p.dirMode === 'own' ? 'Bu sürüme özel klasör' : 'Ortak klasör'),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => api.profiles.openDir(p.id) }, 'Klasörü aç'))),
    h('details', { class: 'adv' },
      h('summary', {}, 'Gelişmiş ayarlar'),
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', {}, 'Pencere genişliği'), width),
        h('div', { class: 'field' }, h('label', {}, 'Pencere yüksekliği'), height)),
      h('div', { class: 'field' }, h('label', {}, 'En az bellek (MB)'), minRam),
      h('div', { class: 'field' }, h('label', {}, 'Bu sürüme özel JVM argümanları'), jvm))
  );

  const m = modal('Sürümü ayarla', body, [
    h('button', { class: 'btn', onclick: () => m.remove() }, 'Vazgeç'),
    h('button', { class: 'btn primary', onclick: async () => {
      const v = (S.versions || []).find((x) => x.id === sel.value);
      const changed = loader !== (p.loader || 'vanilla') || sel.value !== existing.version;
      const r = await api.profiles.save({
        ...p,
        name: name.value,
        version: sel.value,
        type: v ? v.type : p.type,
        loader,
        loaderVersion: changed ? '' : p.loaderVersion,
        minRam: Math.min(Number(minRam.value) || 1024, Number(slider.value)),
        maxRam: Number(slider.value),
        jvmArgs: jvm.value,
        width: Number(width.value),
        height: Number(height.value)
      });
      if (applyProfileState(r)) { m.remove(); render(); toast('Kaydedildi.', 'ok'); }
      else toast(r.error, 'error');
    } }, 'Kaydet')
  ]);
}
