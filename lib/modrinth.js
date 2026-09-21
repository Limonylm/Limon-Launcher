'use strict';
// Modrinth API: arama, mod/kaynak paketi/shader kurulumu ve modpack (.mrpack) kurulumu
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const extract = require('extract-zip');
const { fetchJson, download, hashFile, safeJoin, pool, slugify } = require('./util');

const API = 'https://api.modrinth.com/v2';
const TYPE_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const ALLOWED_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];

const enc = encodeURIComponent;

function compatLoaders(loader) {
  if (loader === 'quilt') return ['quilt', 'fabric'];
  return loader ? [loader] : [];
}

async function search({ query, type, mcVersion, loader, index, offset, limit }) {
  const facets = [[`project_type:${type}`]];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  if (type === 'mod' && loader && loader !== 'vanilla') facets.push(compatLoaders(loader).map((l) => `categories:${l}`));
  const idx = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(index) ? index : 'relevance';
  const url = `${API}/search?query=${enc(query || '')}&facets=${enc(JSON.stringify(facets))}&index=${idx}&limit=${limit || 20}&offset=${offset || 0}`;
  const r = await fetchJson(url);
  return {
    total: r.total_hits,
    hits: r.hits.map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      author: h.author, icon: h.icon_url, downloads: h.downloads, follows: h.follows, type: h.project_type
    }))
  };
}

async function pickVersion(projectId, { type, mcVersion, loader }) {
  const qs = [];
  if (mcVersion) qs.push(`game_versions=${enc(JSON.stringify([mcVersion]))}`);
  if (type === 'mod' && loader && loader !== 'vanilla') qs.push(`loaders=${enc(JSON.stringify(compatLoaders(loader)))}`);
  const versions = await fetchJson(`${API}/project/${enc(projectId)}/version${qs.length ? '?' + qs.join('&') : ''}`);
  if (!Array.isArray(versions) || !versions.length) return null;
  const rank = { release: 0, beta: 1, alpha: 2 };
  return [...versions].sort((a, b) => (rank[a.version_type] ?? 3) - (rank[b.version_type] ?? 3))[0];
}

async function verify(file, hashes) {
  if (hashes && hashes.sha1) {
    const got = await hashFile(file, 'sha1');
    if (got !== hashes.sha1) {
      fs.rmSync(file, { force: true });
      throw new Error('Dosya doğrulaması başarısız: ' + path.basename(file));
    }
  }
}

/** Projeyi (ve gerekli bağımlılıklarını) örnek klasörüne kurar. Kurulan dosya adlarını döndürür. */
async function installProject({ projectId, type, mcVersion, loader, instanceDir, onProgress }, seen = new Set()) {
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  const v = await pickVersion(projectId, { type, mcVersion, loader });
  if (!v) throw new Error('Bu Minecraft sürümü için uygun bir dosya bulunamadı.');
  const file = v.files.find((f) => f.primary) || v.files[0];
  if (!file) throw new Error('Sürümde indirilebilir dosya yok.');
  const dest = safeJoin(path.join(instanceDir, TYPE_DIR[type]), file.filename);
  if (!fs.existsSync(dest)) {
    onProgress && onProgress({ task: file.filename, percent: 0 });
    await download(file.url, dest, (p) => onProgress && onProgress({ task: file.filename, percent: p }));
    await verify(dest, file.hashes);
  }
  const installed = [file.filename];

  if (type === 'mod') {
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type !== 'required') continue;
      let pid = dep.project_id;
      if (!pid && dep.version_id) {
        try { pid = (await fetchJson(`${API}/version/${enc(dep.version_id)}`)).project_id; } catch { /* atla */ }
      }
      if (pid) installed.push(...(await installProject({ projectId: pid, type: 'mod', mcVersion, loader, instanceDir, onProgress }, seen)));
    }
  }
  return installed;
}

/** .mrpack dosyasını indirir, dosyalarını yeni bir örnek klasörüne kurar. */
async function installModpack({ projectId, instancesDir, onProgress }) {
  const v = await pickVersion(projectId, {});
  if (!v) throw new Error('Modpack sürümü bulunamadı.');
  const file = v.files.find((f) => f.filename.endsWith('.mrpack')) || v.files.find((f) => f.primary) || v.files[0];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'limon-mrpack-'));
  try {
    const pack = path.join(tmp, 'pack.mrpack');
    onProgress && onProgress({ task: 'Modpack indiriliyor', percent: 0 });
    await download(file.url, pack, (p) => onProgress && onProgress({ task: 'Modpack indiriliyor', percent: p }));
    const ex = path.join(tmp, 'x');
    await extract(pack, { dir: ex });

    const index = JSON.parse(fs.readFileSync(path.join(ex, 'modrinth.index.json'), 'utf8'));
    const deps = index.dependencies || {};
    const mcVersion = deps.minecraft;
    if (!mcVersion) throw new Error('Modpack Minecraft sürümünü belirtmiyor.');
    let loader = 'vanilla';
    let loaderVersion = '';
    if (deps['fabric-loader']) { loader = 'fabric'; loaderVersion = deps['fabric-loader']; }
    else if (deps['quilt-loader']) { loader = 'quilt'; loaderVersion = deps['quilt-loader']; }
    else if (deps.forge || deps.neoforge) throw new Error('Bu modpack Forge/NeoForge kullanıyor. Şimdilik yalnızca Fabric ve Quilt modpack’leri destekleniyor.');

    const folder = slugify(index.name) + '-' + crypto.randomBytes(3).toString('hex');
    const instanceDir = path.join(instancesDir, folder);
    fs.mkdirSync(instanceDir, { recursive: true });

    const files = (index.files || []).filter((f) => !(f.env && f.env.client === 'unsupported'));
    let done = 0;
    await pool(files, 6, async (f) => {
      const url = (f.downloads || [])[0];
      if (!url) throw new Error('İndirme bağlantısı yok: ' + f.path);
      if (!ALLOWED_HOSTS.includes(new URL(url).hostname)) throw new Error('İzin verilmeyen indirme adresi: ' + new URL(url).hostname);
      const dest = safeJoin(instanceDir, f.path);
      await download(url, dest);
      await verify(dest, f.hashes);
      done++;
      onProgress && onProgress({ task: `Modpack dosyaları (${done}/${files.length})`, percent: Math.round((done / files.length) * 100) });
    });

    for (const sub of ['overrides', 'client-overrides']) {
      const src = path.join(ex, sub);
      if (fs.existsSync(src)) fs.cpSync(src, instanceDir, { recursive: true, force: true });
    }
    return { name: index.name || 'Modpack', mcVersion, loader, loaderVersion, folder, instanceDir };
  } catch (e) {
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { search, installProject, installModpack, TYPE_DIR, API };
