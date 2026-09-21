'use strict';
/* Market: Modrinth üzerinden mod, kaynak paketi (texture), gölgelendirici (shader) ve modpack. */

S.market = { tab: 'mod', query: '', sort: 'downloads', compat: true, ctype: 'mod' };

const MK_TABS = [['mod', 'Modlar'], ['resourcepack', 'Kaynak paketleri'], ['shader', 'Gölgelendiriciler'], ['modpack', 'Modpack’ler'], ['installed', 'Yüklü']];
const MK_SORTS = [['downloads', 'En çok indirilen'], ['relevance', 'Alaka'], ['follows', 'En çok takip edilen'], ['newest', 'En yeni'], ['updated', 'Son güncellenen']];
const CONTENT_TYPES = [['mod', 'Modlar'], ['resourcepack', 'Kaynak paketleri'], ['shader', 'Gölgelendiriciler']];

function renderMarket() {
  const M = S.market;
  const p = activeProfile();
  if (!p) {
    return h('section', {}, h('h1', { class: 'page-title' }, 'Market'),
      h('p', { class: 'page-sub' }, 'Önce Sürümler sayfasından bir sürüm ekle.'));
  }

  const notes = h('div');
  const list = h('div', { class: 'mk-list' });
  const more = h('div', { class: 'mk-more' });
  let offset = 0;
  let total = 0;
  let seq = 0;

  const loaderName = p.loader && p.loader !== 'vanilla' ? LOADER_NAMES[p.loader] : null;
  const switchToFabric = async () => {
    const r = await api.profiles.save({ ...p, loader: 'fabric', loaderVersion: '' });
    if (applyProfileState(r)) { toast('Sürüm Fabric’e geçirildi.', 'ok'); render(); } else toast(r.error, 'error');
  };

  /* ---- üst kısım: hedef sürüm ve sekmeler ---- */
  const target = h('select', { 'aria-label': 'Yüklenecek sürüm', onchange: async (e) => {
    applyProfileState(await api.profiles.select(e.target.value));
    render();
  } }, S.profiles.map((x) => h('option', { value: x.id, selected: x.id === p.id }, `${x.name} (${x.version}${x.loader && x.loader !== 'vanilla' ? ', ' + LOADER_NAMES[x.loader] : ''})`)));

  const tabs = h('div', { class: 'mk-tabs', role: 'tablist' }, MK_TABS.map(([id, label]) =>
    h('button', { class: 'mk-tab' + (M.tab === id ? ' on' : ''), role: 'tab', onclick: () => { M.tab = id; render(); } }, label)));

  const head = h('div', { class: 'page-head' },
    h('div', {},
      h('h1', { class: 'page-title' }, 'Market'),
      h('p', { class: 'page-sub' }, 'Modrinth’ten mod, kaynak paketi, gölgelendirici ve modpack indir. İçerikler seçili sürümün klasörüne kurulur.')));

  const targetRow = h('div', { class: 'mk-head' },
    h('div', { class: 'mk-target' }, 'Yüklenecek sürüm', target),
    h('button', { class: 'btn small', onclick: () => api.profiles.openDir(p.id) }, 'Klasörü aç'));

  /* ---- notlar ---- */
  const drawNotes = () => {
    notes.textContent = '';
    if (M.tab === 'mod' && !loaderName) {
      notes.append(h('div', { class: 'mk-note' }, h('span', {}, 'Bu sürüm Vanilla. Modların çalışması için bir mod yükleyici gerekir.'),
        h('button', { class: 'btn small primary', onclick: switchToFabric }, 'Fabric’e geç')));
    }
    if (M.tab === 'shader') {
      if (!loaderName) {
        notes.append(h('div', { class: 'mk-note' }, h('span', {}, 'Gölgelendiriciler için Fabric ve Iris Shaders modu gerekir.'),
          h('button', { class: 'btn small primary', onclick: switchToFabric }, 'Fabric’e geç')));
      } else {
        const btn = h('button', { class: 'btn small primary', onclick: async () => {
          btn.disabled = true; btn.textContent = 'Kuruluyor…';
          const r = await api.modrinth.install({ profileId: p.id, projectId: 'iris', type: 'mod' });
          if (r.ok) { btn.textContent = 'Kuruldu ✓'; toast('Iris kuruldu (' + r.installed.join(', ') + ').', 'ok'); }
          else { btn.disabled = false; btn.textContent = 'Iris’i kur'; toast(r.error, 'error'); }
        } }, 'Iris’i kur');
        notes.append(h('div', { class: 'mk-note' }, h('span', {}, 'Gölgelendiriciler Iris Shaders modu ister. Kurulu değilse buradan kur.'), btn));
      }
    }
  };

  /* ---- keşfet ---- */
  const card = (hit) => {
    const isPack = hit.type === 'modpack';
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      btn.disabled = true;
      btn.textContent = isPack ? 'Kuruluyor…' : 'Yükleniyor…';
      const r = isPack
        ? await api.modrinth.installModpack({ projectId: hit.id })
        : await api.modrinth.install({ profileId: p.id, projectId: hit.id, type: M.tab });
      if (r.ok) {
        if (isPack) {
          applyProfileState(r);
          applyProfileState(await api.profiles.select(S.profiles[S.profiles.length - 1].id));
          toast(hit.title + ' kuruldu. Sürümler sayfasında seçili.', 'ok');
          go('versions');
          return;
        }
        btn.textContent = 'Yüklendi ✓';
        toast(hit.title + ' yüklendi' + (r.installed.length > 1 ? ` (${r.installed.length} dosya, bağımlılıklar dahil)` : '') + '.', 'ok');
      } else {
        btn.disabled = false;
        btn.textContent = isPack ? 'Kur' : 'Yükle';
        toast(r.error, 'error');
      }
    } }, isPack ? 'Kur' : 'Yükle');
    return h('div', { class: 'mk-card' },
      hit.icon ? h('img', { class: 'mk-icon', src: hit.icon, alt: '' }) : h('div', { class: 'mk-icon' }),
      h('div', { class: 'info' },
        h('div', {}, h('b', {}, hit.title), h('small', {}, hit.author)),
        h('p', {}, hit.description),
        h('div', { class: 'stat' }, new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(hit.downloads) + ' indirme')),
      btn);
  };

  const load = async (reset) => {
    const my = ++seq;
    if (reset) { offset = 0; list.textContent = ''; more.textContent = ''; list.append(h('p', { class: 'note' }, 'Yükleniyor…')); }
    const r = await api.modrinth.search({
      query: M.query, type: M.tab, index: M.sort, offset, limit: 20,
      mcVersion: M.compat && M.tab !== 'modpack' ? p.version : null,
      loader: M.tab === 'mod' && M.compat ? p.loader : null
    });
    if (my !== seq) return;
    if (reset) list.textContent = '';
    if (!r.ok) { list.append(h('p', { class: 'note' }, 'Modrinth’e bağlanılamadı: ' + r.error)); return; }
    total = r.total;
    r.hits.forEach((hit) => list.append(card(hit)));
    offset += r.hits.length;
    if (!r.hits.length && reset) list.append(h('p', { class: 'note' }, 'Sonuç bulunamadı. Uyumluluk filtresini kapatmayı dene.'));
    more.textContent = '';
    if (offset < total) more.append(h('button', { class: 'btn', onclick: () => load(false) }, 'Daha fazla göster'));
  };

  let timer = null;
  const search = h('input', { type: 'text', class: 'grow', value: M.query, placeholder: 'Ara…', autocomplete: 'off', 'aria-label': 'Ara' });
  search.addEventListener('input', () => { M.query = search.value.trim(); clearTimeout(timer); timer = setTimeout(() => load(true), 350); });
  const sort = h('select', { 'aria-label': 'Sırala', onchange: (e) => { M.sort = e.target.value; load(true); } },
    MK_SORTS.map(([id, label]) => h('option', { value: id, selected: M.sort === id }, label)));
  const compat = h('label', { class: 'check', style: 'margin:0' },
    h('input', { type: 'checkbox', checked: M.compat, onchange: (e) => { M.compat = e.target.checked; load(true); } }),
    h('span', {}, `Yalnızca ${p.version}${M.tab === 'mod' && loaderName ? ' ' + loaderName : ''} ile uyumlu olanlar`));

  const browse = () => h('div', {},
    h('div', { class: 'mk-head' }, h('div', { class: 'grow' }, search), sort, M.tab === 'modpack' ? null : compat),
    notes, list, more);

  /* ---- yüklü içerik ---- */
  const installed = () => {
    const box = h('div', { class: 'mk-list' });
    const sub = h('div', { class: 'chips', style: 'margin-bottom:14px' }, CONTENT_TYPES.map(([id, label]) =>
      h('button', { class: 'chip' + (M.ctype === id ? ' on' : ''), onclick: () => { M.ctype = id; render(); } }, label)));
    (async () => {
      const r = await api.content.list({ profileId: p.id, type: M.ctype });
      box.textContent = '';
      if (!r.ok) return box.append(h('p', { class: 'note' }, r.error));
      if (!r.files.length) return box.append(h('p', { class: 'note' }, 'Bu sürümde henüz yüklü içerik yok.'));
      for (const f of r.files) {
        const row = h('div', { class: 'file-row' + (f.enabled ? '' : ' off') },
          h('span', { class: 'name', title: f.name }, f.name.replace(/\.disabled$/, '')),
          f.size ? h('small', {}, (f.size / 1048576).toFixed(1) + ' MB') : null,
          M.ctype === 'mod'
            ? h('button', { class: 'btn small', onclick: async () => { await api.content.toggle({ profileId: p.id, type: M.ctype, name: f.name }); render(); } }, f.enabled ? 'Kapat' : 'Aç')
            : null,
          h('button', { class: 'btn small danger', onclick: async () => { await api.content.remove({ profileId: p.id, type: M.ctype, name: f.name }); render(); } }, 'Sil'));
        box.append(row);
      }
    })();
    return h('div', {}, sub, box);
  };

  const root = h('section', {}, head, targetRow, tabs, M.tab === 'installed' ? installed() : browse());
  if (M.tab !== 'installed') { drawNotes(); load(true); }
  return root;
}
