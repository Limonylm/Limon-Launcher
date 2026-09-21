'use strict';
// GitHub Releases üzerinden kendini güncelleme
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fetchJson, download, cmpVersions } = require('./util');

const REPO = 'Limonylm/Limon-Launcher';
const PORTABLE = () => !!process.env.PORTABLE_EXECUTABLE_FILE;

/** Yeni sürüm varsa {available:true, version, url, name, size, page} döndürür. */
async function check(currentVersion) {
  let rel;
  try {
    rel = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  } catch (e) {
    return { available: false, reason: e.status === 404 ? 'not-found' : 'error' };
  }
  const parsed = (rel.assets || [])
    .map((a) => ({ a, m: /^Limon-Launcher(?:-Kurulum)?-(\d+\.\d+\.\d+)\.exe$/.exec(a.name) }))
    .filter((x) => x.m);
  if (!parsed.length) return { available: false, reason: 'no-assets' };
  const latest = parsed.map((x) => x.m[1]).sort((a, b) => cmpVersions(b, a))[0];
  if (cmpVersions(latest, currentVersion) <= 0) return { available: false, latest };
  const wantPortable = PORTABLE();
  const pick = parsed.find((x) => x.m[1] === latest && x.a.name.includes('Kurulum') !== wantPortable);
  if (!pick) return { available: false, latest, reason: 'no-matching-asset' };
  return { available: true, version: latest, url: pick.a.browser_download_url, name: pick.a.name, size: pick.a.size, page: rel.html_url };
}

/** Güncellemeyi indirir, çalıştırır ve launcher'ı kapatır. */
async function install(app, info, onProgress) {
  const dir = path.join(app.getPath('temp'), 'limon-update');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, info.name);
  await download(info.url, file, onProgress);

  if (PORTABLE()) {
    // Portable sürüm: yeni exe'yi eskisinin yanına koyup açar
    let target = path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('downloads'), info.name);
    try { fs.copyFileSync(file, target); } catch { target = path.join(app.getPath('downloads'), info.name); fs.copyFileSync(file, target); }
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Kurulumlu sürüm: sessiz kurulum, bitince launcher yeniden açılır
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  }
  setTimeout(() => app.quit(), 400);
}

module.exports = { check, install, REPO };
