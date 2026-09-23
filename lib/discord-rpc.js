'use strict';
// Discord Rich Presence: Discord masaüstü uygulamasıyla yerel IPC (adlandırılmış boru/soket) üzerinden konuşur.
// Resmi bir Discord kütüphanesi kullanmaz; protokolü kendisi uygular (opcode + JSON çerçeveleme).
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function pipePaths() {
  const paths = [];
  if (process.platform === 'win32') {
    for (let i = 0; i < 10; i++) paths.push(`\\\\.\\pipe\\discord-ipc-${i}`);
  } else {
    const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
    for (let i = 0; i < 10; i++) paths.push(path.join(base, `discord-ipc-${i}`));
  }
  return paths;
}

function encode(op, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/** Gelen baytları çerçevelere ayırır. Bağlantı başına bir tane kullanılır. */
class FrameReader {
  constructor() {
    this.buf = Buffer.alloc(0);
  }
  push(chunk, onFrame) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 8) return;
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      const raw = this.buf.subarray(8, 8 + len);
      this.buf = this.buf.subarray(8 + len);
      let data = null;
      try { data = JSON.parse(raw.toString('utf8')); } catch { /* bozuk çerçeve, yoksay */ }
      onFrame(op, data);
    }
  }
}

/**
 * Discord Rich Presence istemcisi.
 * getClientId(): geçerli Discord uygulama kimliğini döndüren fonksiyon (ayarlar değişebildiği için).
 */
class DiscordRPC extends EventEmitter {
  constructor(getClientId) {
    super();
    this.getClientId = getClientId;
    this.socket = null;
    this.ready = false;
    this.reader = new FrameReader();
    this.pending = null; // hazır olmadan önce ayarlanan son etkinlik
    this.stopped = true;
    this.retryTimer = null;
    this.connecting = false;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this._connectLoop();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this._teardown();
  }

  _teardown() {
    this.ready = false;
    this.pending = null;
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* yoksay */ }
    }
    this.socket = null;
  }

  _scheduleRetry(ms) {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this._connectLoop(), ms);
  }

  async _connectLoop() {
    if (this.stopped || this.connecting) return;
    const clientId = this.getClientId();
    if (!clientId) return this._scheduleRetry(15000);
    this.connecting = true;
    const candidates = pipePaths();
    for (const p of candidates) {
      if (this.stopped) { this.connecting = false; return; }
      const ok = await this._tryConnect(p, clientId);
      if (ok) { this.connecting = false; return; }
    }
    this.connecting = false;
    this._scheduleRetry(20000); // Discord kapalı olabilir; sessizce yeniden dene
  }

  _tryConnect(pipePath, clientId) {
    return new Promise((resolve) => {
      let settled = false;
      const sock = net.createConnection(pipePath);
      const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };

      const onError = () => { sock.destroy(); finish(false); };
      sock.once('error', onError);
      sock.setTimeout(2500, () => { sock.destroy(); finish(false); });

      sock.once('connect', () => {
        sock.removeListener('error', onError);
        this.socket = sock;
        this.reader = new FrameReader();
        sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: clientId }));

        sock.on('data', (chunk) => this.reader.push(chunk, (op, data) => this._onFrame(op, data)));
        sock.on('close', () => {
          const wasReady = this.ready;
          this.ready = false;
          this.socket = null;
          this.emit('disconnect');
          if (!this.stopped) this._scheduleRetry(wasReady ? 5000 : 20000);
        });
        sock.on('error', () => { /* 'close' olayı temizliği tetikleyecek */ });
        finish(true);
      });
    });
  }

  _onFrame(op, data) {
    // Discord bağlı istemcinin hâlâ ayakta olduğunu görmek için PING gönderir;
    // aynı veriyle PONG dönmezsek bağlantıyı kapatır. Bu, gel-git (yanıp sönme) sorununun asıl sebebiydi.
    if (op === OP.PING) { if (this.socket) this.socket.write(encode(OP.PONG, data)); return; }
    if (op === OP.CLOSE) { this.socket && this.socket.destroy(); return; }
    if (!data) return;
    if (data.evt === 'READY') {
      this.ready = true;
      this.emit('ready');
      if (this.pending !== null) this._send(this.pending);
      return;
    }
    if (data.evt === 'ERROR') this.emit('error', data.data);
  }

  _send(activity) {
    if (!this.socket || !this.ready) { this.pending = activity; return; }
    this.socket.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY',
      nonce: crypto.randomUUID(),
      args: { pid: process.pid, activity }
    }));
  }

  /** activity: {details, state, startTimestamp, largeImageKey, largeImageText} ya da null. */
  setActivity(activity) {
    if (!activity) return this._send(null);
    const a = { instance: false };
    if (activity.details) a.details = String(activity.details).slice(0, 128);
    if (activity.state) a.state = String(activity.state).slice(0, 128);
    if (activity.startTimestamp) a.timestamps = { start: Math.floor(activity.startTimestamp / 1000) };
    if (activity.largeImageKey) {
      a.assets = { large_image: activity.largeImageKey };
      if (activity.largeImageText) a.assets.large_text = String(activity.largeImageText).slice(0, 128);
    }
    this._send(a);
  }

  clearActivity() {
    this._send(null);
  }
}

module.exports = { DiscordRPC, encode, FrameReader, OP, pipePaths };
