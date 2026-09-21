'use strict';
/* Limon Launcher - 3D skin görüntüleyici (harici kütüphane yok, saf WebGL).
   Skin (64x64 / 64x32, klasik / slim), ikinci katman ve pelerin desteği, yürüme animasyonu. */
(function () {
  const VS = `
attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aNor;
uniform mat4 uVP; uniform mat4 uModel;
varying vec2 vUV; varying float vLight;
void main() {
  gl_Position = uVP * (uModel * vec4(aPos, 1.0));
  vec3 n = normalize((uModel * vec4(aNor, 0.0)).xyz);
  vec3 l = normalize(vec3(-0.35, 0.55, 0.75));
  vLight = 0.6 + 0.4 * max(dot(n, l), 0.0);
  vUV = aUV;
}`;
  const FS = `
precision mediump float;
uniform sampler2D uTex; varying vec2 vUV; varying float vLight;
void main() {
  vec4 c = texture2D(uTex, vUV);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb * vLight, 1.0);
}`;

  /* ---------- 4x4 matris (sütun öncelikli) ---------- */
  const M = {
    ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
          o[c * 4 + r] = s;
        }
      return o;
    },
    translate(x, y, z) {
      const m = M.ident();
      m[12] = x; m[13] = y; m[14] = z;
      return m;
    },
    rotX(a) {
      const m = M.ident(), c = Math.cos(a), s = Math.sin(a);
      m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
      return m;
    },
    rotY(a) {
      const m = M.ident(), c = Math.cos(a), s = Math.sin(a);
      m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
      return m;
    },
    persp(fov, aspect, n, f) {
      const t = 1 / Math.tan(fov / 2), m = new Float32Array(16);
      m[0] = t / aspect; m[5] = t;
      m[10] = (f + n) / (n - f); m[11] = -1;
      m[14] = (2 * f * n) / (n - f);
      return m;
    }
  };

  /* ---------- Geometri ---------- */
  function addFace(mesh, tl, tr, br, bl, nor, region, flipU, tw, th) {
    const [pu, pv, pw, ph] = region;
    let uvTL = [pu / tw, pv / th], uvTR = [(pu + pw) / tw, pv / th];
    let uvBR = [(pu + pw) / tw, (pv + ph) / th], uvBL = [pu / tw, (pv + ph) / th];
    if (flipU) { [uvTL, uvTR] = [uvTR, uvTL]; [uvBL, uvBR] = [uvBR, uvBL]; }
    const base = mesh.v.length / 8;
    [[tl, uvTL], [tr, uvTR], [br, uvBR], [bl, uvBL]].forEach(([p, t]) => mesh.v.push(p[0], p[1], p[2], t[0], t[1], nor[0], nor[1], nor[2]));
    mesh.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** (x,y,z) kutunun en küçük köşesi; w,h,d boyut; (u,v) doku başlangıcı (64 tabanlı). */
  function addBox(mesh, x, y, z, w, h, d, u, v, inf, opts, tw, th) {
    const x0 = x - inf, y0 = y - inf, z0 = z - inf, x1 = x + w + inf, y1 = y + h + inf, z1 = z + d + inf;
    const R = {
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h], front: [u + d, v + d, w, h],
      left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h]
    };
    if (opts.mirror) [R.left, R.right] = [R.right, R.left];
    if (opts.swapFB) [R.front, R.back] = [R.back, R.front];
    const f = opts.mirror;
    addFace(mesh, [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1], [0, 0, 1], R.front, f, tw, th);
    addFace(mesh, [x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0], [0, 0, -1], R.back, f, tw, th);
    addFace(mesh, [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0], [-1, 0, 0], R.right, f, tw, th);
    addFace(mesh, [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [1, 0, 0], R.left, f, tw, th);
    addFace(mesh, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], R.top, f, tw, th);
    addFace(mesh, [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], R.bottom, f, tw, th);
  }

  function buildSkinParts(slim, legacy, tw, th) {
    const aw = slim ? 3 : 4;
    const mk = (pivot) => ({ pivot, v: [], i: [], ax: 0, ay: 0 });
    const P = { head: mk([0, 24, 0]), body: mk([0, 12, 0]), rArm: mk([-4 - aw / 2, 22, 0]), lArm: mk([4 + aw / 2, 22, 0]), rLeg: mk([-2, 12, 0]), lLeg: mk([2, 12, 0]) };
    const O = {};
    addBox(P.head, -4, 24, -4, 8, 8, 8, 0, 0, 0, O, tw, th);
    addBox(P.head, -4, 24, -4, 8, 8, 8, 32, 0, 0.5, O, tw, th);
    addBox(P.body, -4, 12, -2, 8, 12, 4, 16, 16, 0, O, tw, th);
    addBox(P.rArm, -4 - aw, 12, -2, aw, 12, 4, 40, 16, 0, O, tw, th);
    addBox(P.rLeg, -4, 0, -2, 4, 12, 4, 0, 16, 0, O, tw, th);
    if (legacy) {
      addBox(P.lArm, 4, 12, -2, aw, 12, 4, 40, 16, 0, { mirror: true }, tw, th);
      addBox(P.lLeg, 0, 0, -2, 4, 12, 4, 0, 16, 0, { mirror: true }, tw, th);
    } else {
      addBox(P.body, -4, 12, -2, 8, 12, 4, 16, 32, 0.25, O, tw, th);
      addBox(P.rArm, -4 - aw, 12, -2, aw, 12, 4, 40, 32, 0.25, O, tw, th);
      addBox(P.rLeg, -4, 0, -2, 4, 12, 4, 0, 32, 0.25, O, tw, th);
      addBox(P.lArm, 4, 12, -2, aw, 12, 4, 32, 48, 0, O, tw, th);
      addBox(P.lArm, 4, 12, -2, aw, 12, 4, 48, 48, 0.25, O, tw, th);
      addBox(P.lLeg, 0, 0, -2, 4, 12, 4, 16, 48, 0, O, tw, th);
      addBox(P.lLeg, 0, 0, -2, 4, 12, 4, 0, 48, 0.25, O, tw, th);
    }
    return P;
  }

  function buildCapePart(tw, th) {
    const c = { pivot: [0, 24, -2], v: [], i: [], ax: 0, ay: 0 };
    addBox(c, -5, 8, -3, 10, 16, 1, 0, 0, 0, { swapFB: true }, tw, th);
    return c;
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Görsel yüklenemedi'));
      img.src = src;
    });
  }

  /* ---------- Görüntüleyici ---------- */
  class Skin3D {
    static supported() {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
      } catch {
        return false;
      }
    }

    /** opts: {animated, yaw, detached, autoStart, preserve, dpr} */
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.opts = opts;
      this.animated = opts.animated !== false;
      this.yaw = opts.yaw != null ? opts.yaw : 0.55;
      this.pitch = 0.08;
      this.dist = 70;
      this.parts = null;
      this.cape = null;
      this.dragging = false;
      this.disposed = false;
      this.t0 = performance.now();
      this.last = this.t0;
      this.time = 0;

      const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.preserve });
      if (!gl) throw new Error('WebGL kullanılamıyor');
      this.gl = gl;
      this.prog = this._program();
      this.loc = {
        pos: gl.getAttribLocation(this.prog, 'aPos'), uv: gl.getAttribLocation(this.prog, 'aUV'), nor: gl.getAttribLocation(this.prog, 'aNor'),
        vp: gl.getUniformLocation(this.prog, 'uVP'), model: gl.getUniformLocation(this.prog, 'uModel'), tex: gl.getUniformLocation(this.prog, 'uTex')
      };
      this.skinTex = null;
      this.capeTex = null;

      canvas.addEventListener('pointerdown', (e) => {
        this.dragging = true;
        this._px = e.clientX; this._py = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!this.dragging) return;
        this.yaw += (e.clientX - this._px) * 0.011;
        this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch + (e.clientY - this._py) * 0.005));
        this._px = e.clientX; this._py = e.clientY;
        if (!this._raf) this.render();
      });
      const up = () => { this.dragging = false; };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.dist = Math.max(45, Math.min(110, this.dist * (e.deltaY > 0 ? 1.06 : 0.94)));
        if (!this._raf) this.render();
      }, { passive: false });

      this._frame = this._frame.bind(this);
      if (opts.autoStart !== false) this._raf = requestAnimationFrame(this._frame);
    }

    _program() {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }

    _texture(img) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    _upload(part) {
      const gl = this.gl;
      part.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, part.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(part.v), gl.STATIC_DRAW);
      part.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(part.i), gl.STATIC_DRAW);
      part.count = part.i.length;
    }

    _free(parts) {
      if (!parts) return;
      for (const p of Object.values(parts)) {
        if (p.vbo) this.gl.deleteBuffer(p.vbo);
        if (p.ibo) this.gl.deleteBuffer(p.ibo);
      }
    }

    async setSkin(src, slim) {
      const img = await loadImage(src);
      if (this.disposed) return;
      const legacy = img.height * 2 === img.width;
      const parts = buildSkinParts(!!slim, legacy, 64, legacy ? 32 : 64);
      Object.values(parts).forEach((p) => this._upload(p));
      this._free(this.parts);
      if (this.skinTex) this.gl.deleteTexture(this.skinTex);
      this.parts = parts;
      this.skinTex = this._texture(img);
      if (!this._raf) this.render();
    }

    async setCape(src) {
      if (!src) {
        this._free(this.cape ? { c: this.cape } : null);
        this.cape = null;
        if (this.capeTex) this.gl.deleteTexture(this.capeTex);
        this.capeTex = null;
        if (!this._raf) this.render();
        return;
      }
      const img = await loadImage(src);
      if (this.disposed) return;
      const std = img.width * 2 === img.height * 4 || img.width % 64 === 0;
      const tw = std ? 64 : img.width;
      const th = std ? 32 : img.height;
      const cape = buildCapePart(tw, th);
      this._upload(cape);
      this._free(this.cape ? { c: this.cape } : null);
      if (this.capeTex) this.gl.deleteTexture(this.capeTex);
      this.cape = cape;
      this.capeTex = this._texture(img);
      if (!this._raf) this.render();
    }

    setAnimated(on) {
      this.animated = !!on;
      if (!this._raf) this.render();
    }

    _resize() {
      const c = this.canvas;
      const dpr = this.opts.dpr || window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round((c.clientWidth || c.width) * dpr));
      const h = Math.max(1, Math.round((c.clientHeight || c.height) * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }

    _draw(part, tex, root, vp) {
      const gl = this.gl;
      const L = this.loc;
      const local = M.mul(M.translate(part.pivot[0], part.pivot[1], part.pivot[2]),
        M.mul(M.rotX(part.ax), M.mul(M.rotY(part.ay), M.translate(-part.pivot[0], -part.pivot[1], -part.pivot[2]))));
      gl.uniformMatrix4fv(L.model, false, M.mul(root, local));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.ibo);
      gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(L.uv); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(L.nor); gl.vertexAttribPointer(L.nor, 3, gl.FLOAT, false, 32, 20);
      gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
    }

    render() {
      if (this.disposed) return;
      const gl = this.gl;
      this._resize();
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!this.parts) return;

      const t = this.time;
      const s = this.animated ? Math.sin(t * 6) : 0;
      const P = this.parts;
      P.rArm.ax = s * 0.75; P.lArm.ax = -s * 0.75;
      P.rLeg.ax = -s * 0.75; P.lLeg.ax = s * 0.75;
      P.head.ay = this.animated ? Math.sin(t * 1.7) * 0.25 : 0;
      if (this.cape) this.cape.ax = 0.1 + (this.animated ? Math.abs(s) * 0.18 + 0.03 * Math.sin(t * 2.3) : 0);

      const aspect = this.canvas.width / this.canvas.height;
      const vp = M.mul(M.persp(0.62, aspect, 1, 300), M.translate(0, 0, -this.dist));
      const root = M.mul(M.rotX(this.pitch), M.mul(M.rotY(this.yaw), M.translate(0, -16, 0)));

      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(this.loc.vp, false, vp);
      gl.uniform1i(this.loc.tex, 0);
      gl.activeTexture(gl.TEXTURE0);
      for (const p of Object.values(P)) this._draw(p, this.skinTex, root, vp);
      if (this.cape && this.capeTex) this._draw(this.cape, this.capeTex, root, vp);
    }

    _frame(now) {
      if (this.disposed) return;
      if (!this.opts.detached && !this.canvas.isConnected) return this.dispose();
      this._raf = requestAnimationFrame(this._frame);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.animated) {
        this.time += dt;
        if (!this.dragging) this.yaw += dt * 0.45;
      }
      this.render();
    }

    snapshot() {
      this.render();
      return this.canvas.toDataURL('image/png');
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      try {
        const ext = this.gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      } catch { /* yoksay */ }
    }
  }

  window.Skin3D = Skin3D;
})();
