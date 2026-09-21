'use strict';
// Fabric / Quilt yükleyicilerini hazırlar (kurulum profili JSON'unu indirir).
const fs = require('fs');
const path = require('path');
const { fetchJson, download } = require('./util');

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const META = {
  fabric: { name: 'Fabric', api: 'https://meta.fabricmc.net/v2/versions/loader' },
  quilt: { name: 'Quilt', api: 'https://meta.quiltmc.org/v3/versions/loader' }
};

async function vanillaMeta(root, id) {
  const local = path.join(root, 'versions', id, id + '.json');
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8'));
  const m = await fetchJson(MANIFEST_URL);
  const v = m.versions.find((x) => x.id === id);
  if (!v) throw new Error('Minecraft sürümü bulunamadı: ' + id);
  const j = await fetchJson(v.url);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, JSON.stringify(j));
  return j;
}

async function ensureVanillaJar(root, id, onProgress) {
  const meta = await vanillaMeta(root, id);
  const jar = path.join(root, 'versions', id, id + '.jar');
  if (!fs.existsSync(jar)) await download(meta.downloads.client.url, jar, onProgress);
  return { meta, jar };
}

/** Yükleyici gerekiyorsa hazırlar ve MCLC için "custom" sürüm kimliğini döndürür. */
async function ensureLoader(root, profile, onProgress) {
  const info = META[profile.loader];
  if (!info) return null;
  const mc = profile.version;
  const { meta, jar } = await ensureVanillaJar(root, mc, onProgress);

  let loaderVersion = profile.loaderVersion;
  if (!loaderVersion) {
    const list = await fetchJson(`${info.api}/${encodeURIComponent(mc)}`);
    if (!Array.isArray(list) || !list.length) throw new Error(`${info.name}, Minecraft ${mc} sürümünü desteklemiyor.`);
    const stable = list.find((x) => x.loader && x.loader.stable === true) ||
      list.find((x) => x.loader && !/beta|alpha|pre|rc/i.test(x.loader.version)) || list[0];
    loaderVersion = stable.loader.version;
  }
  const prof = await fetchJson(`${info.api}/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`);
  const id = prof.id;
  const dir = path.join(root, 'versions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(prof));
  // MCLC uyumluluğu: vanilla json ve jar, özel sürüm klasöründe de bulunsun
  fs.writeFileSync(path.join(dir, mc + '.json'), JSON.stringify(meta));
  const dj = path.join(dir, mc + '.jar');
  if (!fs.existsSync(dj)) {
    try { fs.linkSync(jar, dj); } catch { fs.copyFileSync(jar, dj); }
  }
  return id;
}

module.exports = { ensureLoader, META };
