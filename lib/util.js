'use strict';
// Ortak yardımcılar: HTTP, indirme, sürüm karşılaştırma, güvenli yol birleştirme
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Limonylm-Limon-Launcher/0.3 (https://github.com/Limonylm/Limon-Launcher)';

async function http(url, opts = {}) {
  return fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
}

async function fetchJson(url, opts = {}) {
  const res = await http(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) {
    const e = new Error('İstek başarısız (' + res.status + ')');
    e.status = res.status;
    throw e;
  }
  return res.json();
}

async function download(url, file, onProgress) {
  const res = await http(url);
  if (!res.ok) throw new Error('İndirme hatası (' + res.status + ')');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  const tmp = file + '.part';
  const out = fs.createWriteStream(tmp);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (total && onProgress) onProgress(Math.round((got / total) * 100));
    }
    await new Promise((resolve, reject) => {
      out.on('error', reject);
      out.end(resolve);
    });
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.renameSync(tmp, file);
}

function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** "0.10.1" > "0.9" gibi sayısal karşılaştırma. a>b ise pozitif döner. */
function cmpVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** base klasörünün dışına çıkan yolları reddeder (../ saldırıları). */
function safeJoin(base, rel) {
  const root = path.resolve(base);
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Geçersiz dosya yolu: ' + rel);
  return p;
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

const slugify = (s) =>
  String(s || '')
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'surum';

module.exports = { UA, http, fetchJson, download, hashFile, cmpVersions, safeJoin, pool, slugify };
