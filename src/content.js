'use strict';
/* Sürüm içeriği: bir sürümün mod, kaynak paketi (texture) ve gölgelendirici (shader) yönetimi.
   İçerik Modrinth'ten indirilir ve o sürümün klasörüne kurulur. */

S.market = { tab: 'mod', query: '', sort: 'downloads', compat: true };

const CT_TABS = [['mod', 'Modlar'], ['resourcepack', 'Kaynak paketleri'], ['shader', 'Gölgelendiriciler'], ['installed', 'Yüklü']];
const CT_SORTS = [['downloads', 'En çok indirilen'], ['relevance', 'Alaka'], ['follows', 'En çok takip edilen'], ['newest', 'En yeni'], ['updated', 'Son güncellenen']];
const CONTENT_TYPES = [['mod', 'Modlar'], ['resourcepack', 'Kaynak paketleri'], ['shader', 'Gölgelendiriciler']];

function renderVersionDetail(p) {
  const M = S.market;
  const loaderName = p.loader && p.loader !== 'vanilla' ? LOADER_NAMES[p.loader] : null;
  const notes = h('div');
  const list = h('div', { class: 'mk-list' });
  const more = h('div', { class: 'mk-more' });
  let offset = 0;
  let total = 0;
  let seq = 0;

  const switchToFabric = async () => {
    const r = await api.profiles.save({ ...p, loader: 'fabric', loaderVersion: '' });
    if (applyProfileState(r)) { toast('Sürüm Fabric’e geçirildi.', 'ok'); render(); } else toast(r.error, 'error');
  };

  /* ---- başlık ---- */
  const head = h('div', { class: 'detail-head' },
    h('button', { class: 'btn small', onclick: () => { S.contentFor = null; render(); } }, '← Sürümler'),
    h('div', { class: 'grow' },
      h('h1', { class: 'page-title' }, 'Minecraft ' + p.version),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, p.name),
        loaderName ? h('span', { class: 'chip loader' }, loaderName) : h('span', { class: 'chip' }, 'Vanilla'),
        p.dirMode === 'own' ? h('span', { class: 'chip' }, 'Özel klasör') : null)),
    h('button', { class: 'btn small', onclick: () => api.profiles.openDir(p.id) }, 'Klasörü aç'));

  const tabs = h('div', { class: 'mk-tabs', role: 'tablist' }, CT_TABS.map(([id, label]) =>
    h('button', { class: 'mk-tab' + (M.tab === id ? ' on' : ''), role: 'tab', onclick: () => { M.tab = id; render(); } }, label)));

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
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      btn.disabled = true;
      btn.textContent = 'Yükleniyor…';
      const r = await api.modrinth.install({ profileId: p.id, projectId: hit.id, type: M.tab });
      if (r.ok) {
        btn.textContent = 'Yüklendi ✓';
        toast(hit.title + ' yüklendi' + (r.installed.length > 1 ? ` (${r.installed.length} dosya, bağımlılıklar dahil)` : '') + '.', 'ok');
      } else {
        btn.disabled = false;
        btn.textContent = 'Yükle';
        toast(r.error, 'error');
      }
    } }, 'Yükle');
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
      mcVersion: M.compat ? p.version : null,
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
  const search = h('input', { type: 'text', value: M.query, placeholder: 'Ara…', autocomplete: 'off', 'aria-label': 'Ara' });
  search.addEventListener('input', () => { M.query = search.value.trim(); clearTimeout(timer); timer = setTimeout(() => load(true), 350); });
  const sort = h('select', { 'aria-label': 'Sırala', onchange: (e) => { M.sort = e.target.value; load(true); } },
    CT_SORTS.map(([id, label]) => h('option', { value: id, selected: M.sort === id }, label)));
  const compat = h('label', { class: 'check', style: 'margin:0' },
    h('input', { type: 'checkbox', checked: M.compat, onchange: (e) => { M.compat = e.target.checked; load(true); } }),
    h('span', {}, `Yalnızca ${p.version}${M.tab === 'mod' && loaderName ? ' ' + loaderName : ''} ile uyumlu olanlar`));

  const browse = () => h('div', {},
    h('div', { class: 'mk-head' }, h('div', { class: 'grow' }, search), sort, compat),
    notes, list, more);

  /* ---- yüklü içerik ---- */
  const installed = () => {
    const box = h('div', { class: 'mk-list' });
    const sub = h('div', { class: 'chips', style: 'margin-bottom:14px' }, CONTENT_TYPES.map(([id, label]) =>
      h('button', { class: 'chip' + ((M.ctype || 'mod') === id ? ' on' : ''), onclick: () => { M.ctype = id; render(); } }, label)));
    const type = M.ctype || 'mod';
    (async () => {
      const r = await api.content.list({ profileId: p.id, type });
      box.textContent = '';
      if (!r.ok) return box.append(h('p', { class: 'note' }, r.error));
      if (!r.files.length) return box.append(h('p', { class: 'note' }, 'Bu sürümde henüz yüklü içerik yok.'));
      for (const f of r.files) {
        box.append(h('div', { class: 'file-row' + (f.enabled ? '' : ' off') },
          h('span', { class: 'name', title: f.name }, f.name.replace(/\.disabled$/, '')),
          f.size ? h('small', {}, (f.size / 1048576).toFixed(1) + ' MB') : null,
          type === 'mod'
            ? h('button', { class: 'btn small', onclick: async () => { await api.content.toggle({ profileId: p.id, type, name: f.name }); render(); } }, f.enabled ? 'Kapat' : 'Aç')
            : null,
          h('button', { class: 'btn small danger', onclick: async () => { await api.content.remove({ profileId: p.id, type, name: f.name }); render(); } }, 'Sil')));
      }
    })();
    return h('div', {}, sub, box);
  };

  const root = h('section', {}, head, tabs, M.tab === 'installed' ? installed() : browse());
  if (M.tab !== 'installed') { drawNotes(); load(true); }
  return root;
}
