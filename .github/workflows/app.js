/* Hopla Scan — application de scan de documents */
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const FILTERS = [["auto", "✨ Auto"], ["clean", "Sans ombre"], ["sharp", "Net"], ["orig", "Original"], ["gray", "Gris"], ["bw", "Noir & blanc"], ["light", "Éclairci"]];
const OUT_MAX = 2200;
const S = { docs: [], cur: null, E: null, view: "home", idbOk: true, editQueue: [], idParts: null, afterEdit: null };

/* ============ utilitaires ============ */
function mk(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
function ctx(c) { return c.getContext("2d", { willReadFrequently: true }); }
const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const urls = new WeakMap();
function urlOf(b) { if (!b) return ""; let u = urls.get(b); if (!u) { u = URL.createObjectURL(b); urls.set(b, u); } return u; }
function toBlob(c, q = .88, type = "image/jpeg") { return new Promise(r => c.toBlob(b => r(b), type, q)); }
function fmtDate(t) { try { return new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
function toast(t) { const e = $("#toast"); e.textContent = t; e.classList.add("on"); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove("on"), 2600); }
async function busy(on, t, prog) {
  $("#busyTxt").textContent = t || "Traitement…"; $("#busy").classList.toggle("on", !!on);
  $("#busyProg").style.display = prog == null ? "none" : "block"; if (prog != null) $("#busyProg i").style.width = Math.round(prog * 100) + "%";
  if (on) await sleep(30);
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } }

/* ============ stockage (IndexedDB, sur l'appareil) ============ */
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise(res => {
    try { const r = indexedDB.open("kadscanner", 1); r.onupgradeneeded = () => r.result.createObjectStore("docs", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }
    catch (e) { res(null); }
  });
  return dbp;
}
async function dbAll() { const d = await idb(); if (!d) { S.idbOk = false; return []; } return new Promise(res => { try { const q = d.transaction("docs").objectStore("docs").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); } catch (e) { res([]); } }); }
async function dbPut(doc) { const d = await idb(); if (!d) return; try { doc.updated = Date.now(); d.transaction("docs", "readwrite").objectStore("docs").put(doc); } catch (e) { } }
async function dbDel(id) { const d = await idb(); if (!d) return; try { d.transaction("docs", "readwrite").objectStore("docs").delete(id); } catch (e) { } }
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

/* ============ images ============ */
async function fileToCanvas(file, max = 2600) {
  let src, w, h, url = null;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; h = src.height; }
  catch (e) { url = URL.createObjectURL(file); src = new Image(); src.src = url; await src.decode(); w = src.naturalWidth; h = src.naturalHeight; }
  try {
    const sc = Math.min(1, max / Math.max(w, h));
    const c = mk(Math.round(w * sc), Math.round(h * sc)), x = ctx(c);
    x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height); return c;
  } finally { if (url) URL.revokeObjectURL(url); if (src.close) src.close(); }
}
function scaledCanvas(c, max) { const sc = Math.min(1, max / Math.max(c.width, c.height)); if (sc === 1) return { c, sc }; const o = mk(Math.round(c.width * sc), Math.round(c.height * sc)), x = ctx(o); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, o.width, o.height); return { c: o, sc }; }
function cloneCanvas(c) { const o = mk(c.width, c.height); ctx(o).drawImage(c, 0, 0); return o; }

/* ============ géométrie ============ */
function orderQuad(q) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const s = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let k = 0, m = 1e18; s.forEach((p, i) => { if (p[0] + p[1] < m) { m = p[0] + p[1]; k = i; } });
  return [0, 1, 2, 3].map(i => s[(i + k) % 4].slice());
}
function area(q) { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p[0] * n[1] - n[0] * p[1]; } return Math.abs(a) / 2; }
function isConvex(q) { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4]; const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(cr) < 1e-6) return false; const sg = Math.sign(cr); if (!s) s = sg; else if (sg !== s) return false; } return true; }
// resserre légèrement le cadre pour ne pas garder le bord de la table
function shrinkQuad(q, f) { const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4; return q.map(p => [p[0] + (cx - p[0]) * f * 2, p[1] + (cy - p[1]) * f * 2]); }
function fullQuad(c, ins = 0) { const iw = c.width * ins, ih = c.height * ins; return [[iw, ih], [c.width - iw, ih], [c.width - iw, c.height - ih], [iw, c.height - ih]]; }
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];[b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let k = i; k < n; k++) A[r][k] -= f * A[i][k]; b[r] -= f * b[i]; }
  }
  const x = new Array(n); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= A[i][k] * x[k]; x[i] = s / A[i][i]; } return x;
}
function homography(s, d) { const A = [], b = []; for (let i = 0; i < 4; i++) { const [x, y] = s[i], [X, Y] = d[i]; A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X); A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y); } return solve(A, b); }
function warp(src, q, maxSide) {
  const W0 = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H0 = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const sc = Math.min(1, maxSide / Math.max(W0, H0)), W = Math.max(1, Math.round(W0 * sc)), H = Math.max(1, Math.round(H0 * sc));
  const h = homography([[0, 0], [W, 0], [W, H], [0, H]], q);
  const sw = src.width, sh = src.height, sd = ctx(src).getImageData(0, 0, sw, sh).data;
  const out = mk(W, H), ox = ctx(out), od = ox.createImageData(W, H), o = od.data;
  let j = 0;
  for (let y = 0; y < H; y++) {
    const v = y + .5;
    for (let x = 0; x < W; x++, j += 4) {
      const u = x + .5, den = h[6] * u + h[7] * v + 1;
      let sx = (h[0] * u + h[1] * v + h[2]) / den - .5, sy = (h[3] * u + h[4] * v + h[5]) / den - .5;
      if (sx < 0) sx = 0; else if (sx > sw - 1.001) sx = sw - 1.001; if (sy < 0) sy = 0; else if (sy > sh - 1.001) sy = sh - 1.001;
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, i0 = (y0 * sw + x0) * 4, i1 = i0 + 4, i2 = i0 + sw * 4, i3 = i2 + 4;
      const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
      o[j] = sd[i0] * w0 + sd[i1] * w1 + sd[i2] * w2 + sd[i3] * w3;
      o[j + 1] = sd[i0 + 1] * w0 + sd[i1 + 1] * w1 + sd[i2 + 1] * w2 + sd[i3 + 1] * w3;
      o[j + 2] = sd[i0 + 2] * w0 + sd[i1 + 2] * w1 + sd[i2 + 2] * w2 + sd[i3 + 2] * w3; o[j + 3] = 255;
    }
  }
  ox.putImageData(od, 0, 0); return out;
}
function rotateCanvas(c, rot) { rot = ((rot % 4) + 4) % 4; if (!rot) return c; const w = c.width, h = c.height, o = mk(rot % 2 ? h : w, rot % 2 ? w : h), x = ctx(o); x.translate(o.width / 2, o.height / 2); x.rotate(rot * Math.PI / 2); x.drawImage(c, -w / 2, -h / 2); return o; }

/* ============ détection des bords ============ */
// Détection de secours (sans OpenCV)
function detectQuadJS(src) {
  const W = src.width, H = src.height, sc = Math.min(1, 320 / Math.max(W, H)), w = Math.max(8, Math.round(W * sc)), h = Math.max(8, Math.round(H * sc));
  const c = mk(w, h), x = ctx(c); x.drawImage(src, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data; const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
  const hist = new Float64Array(256); for (const v of g) hist[v | 0]++; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, mx = 0, th = 127; for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = g.length - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, b = wB * wF * (mB - mF) ** 2; if (b > mx) { mx = b; th = i; } }
  const m = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) m[i] = g[i] > th ? 1 : 0;
  const lab = new Int32Array(w * h); let best = null, id = 0; const st = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue; id++; let n = 0; st.push(i); lab[i] = id;
    while (st.length) { const p = st.pop(); n++; const px = p % w, py = (p / w) | 0; for (const q of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1]) if (q >= 0 && m[q] && !lab[q]) { lab[q] = id; st.push(q); } }
    if (!best || n > best.n) best = { id, n };
  }
  if (!best || best.n < .1 * w * h || best.n > .96 * w * h) return null;
  let q = [null, null, null, null], a = 1e18, b = -1e18, c2 = -1e18, d2 = 1e18;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { if (lab[y * w + xx] !== best.id) continue; const s = xx + y, t = xx - y; if (s < a) { a = s; q[0] = [xx, y]; } if (s > b) { b = s; q[2] = [xx, y]; } if (t > c2) { c2 = t; q[1] = [xx, y]; } if (t < d2) { d2 = t; q[3] = [xx, y]; } }
  q = orderQuad(q); if (!isConvex(q) || area(q) < .1 * w * h) return null;
  return q.map(p => [(p[0] + .5) / sc, (p[1] + .5) / sc]);
}
// Détection OpenCV dans un worker
const CVD = {
  worker: null, ready: false, failed: false, seq: 0, pending: new Map(),
  start() {
    if (this.worker || this.failed) return;
    try {
      this.worker = new Worker("cvworker.js");
      this.worker.onmessage = e => {
        const m = e.data;
        if (m.type === "ready") this.ready = true;
        else if (m.type === "error") { this.failed = true; }
        else if (m.type === "quad") { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p(m.quad); } }
      };
      this.worker.onerror = () => { this.failed = true; this.pending.forEach(p => p(undefined)); this.pending.clear(); };
    } catch (e) { this.failed = true; }
  },
  busy() { return this.pending.size > 0; },
  raw(imgData, timeout = 4000) {
    return new Promise(res => {
      if (!this.worker || this.failed) return res(undefined);
      const id = ++this.seq; this.pending.set(id, res);
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); res(undefined); } }, timeout);
      this.worker.postMessage({ id, w: imgData.width, h: imgData.height, buf: imgData.data.buffer }, [imgData.data.buffer]);
    });
  },
  async detect(canvas, max = 720) {
    const { c, sc } = scaledCanvas(canvas, max);
    let q;
    if (this.worker && !this.failed) {
      if (!this.ready) { for (let i = 0; i < 60 && !this.ready && !this.failed; i++) await sleep(100); }
      if (this.ready) q = await this.raw(ctx(c).getImageData(0, 0, c.width, c.height), 6000);
    }
    if (q === undefined) { const j = detectQuadJS(canvas); return j ? shrinkQuad(j, .008) : null; }
    return q ? shrinkQuad(q.map(p => [Math.min(canvas.width, Math.max(0, p[0] / sc)), Math.min(canvas.height, Math.max(0, p[1] / sc))]), .008) : null;
  }
};

/* ============ amélioration de l'image ============ */
function dilate(id) {
  const { width: w, height: h, data: d } = id, o = new ImageData(w, h), od = o.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), i = (yy * w + xx) * 4; if (d[i] > r) r = d[i]; if (d[i + 1] > g) g = d[i + 1]; if (d[i + 2] > b) b = d[i + 2]; } }
    const j = (y * w + x) * 4; od[j] = r; od[j + 1] = g; od[j + 2] = b; od[j + 3] = 255;
  }
  return o;
}
// Estimation du fond (papier) : sert à supprimer les ombres et l'éclairage inégal
function bgEstimate(c) {
  const W = c.width, H = c.height, sw = Math.max(4, Math.round(W / 22)), sh = Math.max(4, Math.round(H / 22));
  const s = mk(sw, sh), sx = ctx(s); sx.imageSmoothingQuality = "high"; sx.drawImage(c, 0, 0, sw, sh);
  let id = sx.getImageData(0, 0, sw, sh); id = dilate(dilate(dilate(id))); sx.putImageData(id, 0, 0);
  const b = mk(W, H), bx = ctx(b); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = "high"; bx.drawImage(s, 0, 0, W, H); return bx.getImageData(0, 0, W, H).data;
}
// Flou rapide (somme glissante), utilisé pour la netteté
function boxBlur1(src, dst, W, H, r) {
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) { const o = y * W; let s = src[o] * (r + 1); for (let k = 1; k <= r; k++) s += src[o + Math.min(W - 1, k)]; for (let x = 0; x < W; x++) { dst[o + x] = s / n; s += src[o + Math.min(W - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
}
function boxBlurV(src, dst, W, H, r) {
  const n = 2 * r + 1;
  for (let x = 0; x < W; x++) { let s = src[x] * (r + 1); for (let k = 1; k <= r; k++) s += src[Math.min(H - 1, k) * W + x]; for (let y = 0; y < H; y++) { dst[y * W + x] = s / n; s += src[Math.min(H - 1, y + r + 1) * W + x] - src[Math.max(0, y - r) * W + x]; } }
}
function sharpenData(d, W, H, amount, r) {
  const N = W * H, L = new Float32Array(N), t = new Float32Array(N), b = new Float32Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) L[i] = .299 * d[j] + .587 * d[j + 1] + .114 * d[j + 2];
  boxBlur1(L, t, W, H, r); boxBlurV(t, b, W, H, r); boxBlur1(b, t, W, H, r); boxBlurV(t, b, W, H, r);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    let dl = L[i] - b[i]; if (dl > -2 && dl < 2) continue; dl *= amount;
    d[j] = clamp(d[j] + dl); d[j + 1] = clamp(d[j + 1] + dl); d[j + 2] = clamp(d[j + 2] + dl);
  }
}
function percentile(d, p, step = 16) {
  const h = new Uint32Array(256); let n = 0;
  for (let j = 0; j < d.length; j += 4 * step) { h[(.299 * d[j] + .587 * d[j + 1] + .114 * d[j + 2]) | 0]++; n++; }
  const t = n * p; let a = 0; for (let i = 0; i < 256; i++) { a += h[i]; if (a >= t) return i; } return 255;
}
function applyFilter(c, f, adj) {
  adj = adj || { b: 0, c: 0, s: 0 };
  const W = c.width, H = c.height, o = mk(W, H), x = ctx(o); x.drawImage(c, 0, 0);
  const id = x.getImageData(0, 0, W, H), d = id.data, n = d.length;
  let sharp = 0;
  if (f === "light") { for (let i = 0; i < n; i += 4) { d[i] = clamp(d[i] * 1.1 + 22); d[i + 1] = clamp(d[i + 1] * 1.1 + 22); d[i + 2] = clamp(d[i + 2] * 1.1 + 22); } sharp = .3; }
  else if (f === "sharp") {
    const lo = Math.min(60, percentile(d, .01)), hi = Math.max(lo + 60, percentile(d, .995)), k = 255 / (hi - lo);
    for (let i = 0; i < n; i += 4) { d[i] = clamp((d[i] - lo) * k); d[i + 1] = clamp((d[i + 1] - lo) * k); d[i + 2] = clamp((d[i + 2] - lo) * k); }
    sharp = 1.1;
  }
  else if (f !== "orig") {
    const bg = bgEstimate(c);
    for (let i = 0; i < n; i += 4) {
      d[i] = Math.min(255, d[i] / Math.max(bg[i], 1) * 255); d[i + 1] = Math.min(255, d[i + 1] / Math.max(bg[i + 1], 1) * 255); d[i + 2] = Math.min(255, d[i + 2] / Math.max(bg[i + 2], 1) * 255);
    }
    if (f === "auto") {
      const bp = Math.max(30, Math.min(120, percentile(d, .02) + 10)), k = 255 / (250 - bp);
      for (let i = 0; i < n; i += 4) {
        let r = (d[i] - bp) * k, g = (d[i + 1] - bp) * k, b = (d[i + 2] - bp) * k;
        const l = .299 * r + .587 * g + .114 * b; r = l + (r - l) * 1.3; g = l + (g - l) * 1.3; b = l + (b - l) * 1.3;
        d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
      }
      sharp = .9;
    } else if (f === "clean") {
      for (let i = 0; i < n; i += 4) { d[i] = 255 * Math.pow(d[i] / 255, 1.25); d[i + 1] = 255 * Math.pow(d[i + 1] / 255, 1.25); d[i + 2] = 255 * Math.pow(d[i + 2] / 255, 1.25); }
      sharp = .5;
    } else if (f === "gray") {
      const bp = Math.max(25, Math.min(110, percentile(d, .02) + 8)), k = 255 / (248 - bp);
      for (let i = 0; i < n; i += 4) { const l = clamp((.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2] - bp) * k); d[i] = d[i + 1] = d[i + 2] = l; }
      sharp = .7;
    } else if (f === "bw") {
      for (let i = 0; i < n; i += 4) { let l = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; l = l < 165 ? 0 : l > 212 ? 255 : (l - 165) * 5.4; d[i] = d[i + 1] = d[i + 2] = l; }
    }
  }
  if (adj.b || adj.c) {
    const cf = 1 + adj.c / 55, bb = adj.b * 2;
    for (let i = 0; i < n; i += 4) { d[i] = clamp((d[i] - 128) * cf + 128 + bb); d[i + 1] = clamp((d[i + 1] - 128) * cf + 128 + bb); d[i + 2] = clamp((d[i + 2] - 128) * cf + 128 + bb); }
  }
  sharp += (adj.s || 0) / 45;
  if (sharp > 0 && f !== "bw") sharpenData(d, W, H, sharp, Math.max(1, Math.round(Math.max(W, H) / 1400)));
  x.putImageData(id, 0, 0); return o;
}

/* ============ rendu d'une page ============ */
const imgCache = new Map();
function loadImg(src) { if (imgCache.has(src)) return imgCache.get(src); const p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); imgCache.set(src, p); return p; }
async function renderPage(p, orig) {
  const base = rotateCanvas(warp(orig, p.quad, OUT_MAX), p.rot || 0);
  const f = applyFilter(base, p.filter || "auto", p.adj);
  if (p.sig && p.sig.img) {
    try { const im = await loadImg(p.sig.img); const w = p.sig.w * f.width, h = w * im.height / im.width; const x = ctx(f); x.globalCompositeOperation = "multiply"; x.drawImage(im, p.sig.x * f.width, p.sig.y * f.height, w, h); x.globalCompositeOperation = "source-over"; } catch (e) { }
  }
  p.out = await toBlob(f, .88); p.w = f.width; p.h = f.height;
  const t = scaledCanvas(f, 380); p.thumb = await toBlob(t.c, .8);
}
async function origCanvas(p) { return fileToCanvas(p.orig, 99999); }
async function rerender(p) { const c = await origCanvas(p); await renderPage(p, c); }

/* ============ vues ============ */
function show(v) {
  S.view = v; $$(".view").forEach(e => e.classList.toggle("on", e.id === "v-" + v)); document.body.classList.toggle("cam", v === "cam");
  if (v === "crop") requestAnimationFrame(layoutCrop);
}
function renderHome() {
  const el = $("#homeList"), q = norm($("#q").value.trim());
  let docs = S.docs.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  $("#searchBox").style.display = S.docs.length ? "flex" : "none";
  if (!S.docs.length) {
    el.innerHTML = `<div class="empty"><div class="big">📄</div>Appuyez sur le <b>bouton jaune</b> pour scanner un document.
      <div class="feat"><div><span>✨</span>Bords trouvés et page redressée automatiquement</div><div><span>🧽</span>Ombres effacées, texte plus net</div>
      <div><span>🪪</span>Carte d'identité recto-verso sur une page A4</div><div><span>🔤</span>Texte reconnu : PDF où l'on peut chercher</div>
      <div><span>✍️</span>Signature sur vos documents</div><div><span>🔒</span>Tout reste sur votre téléphone</div></div></div>` +
      (S.idbOk ? "" : `<p class="note">Stockage indisponible ici : pensez à exporter vos PDF avant de fermer.</p>`);
    return;
  }
  if (q) docs = docs.filter(d => norm(d.name).includes(q) || d.pages.some(p => p.ocr && norm(p.ocr.text).includes(q)));
  el.innerHTML = docs.map(d => {
    const hasTxt = d.pages.some(p => p.ocr);
    const hit = q && !norm(d.name).includes(q) ? `<div class="meta" style="color:var(--y)">🔤 mot trouvé dans le texte</div>` : "";
    return `<div class="doc" data-open="${d.id}"><div class="th" style="background-image:url('${d.pages[0] ? urlOf(d.pages[0].thumb) : ""}')"></div><div><div class="nm">${esc(d.name)}${hasTxt ? '<span class="tag">TEXTE</span>' : ""}</div><div class="meta">${d.pages.length} page${d.pages.length > 1 ? "s" : ""} · ${fmtDate(d.updated || d.created)}</div>${hit}</div></div>`;
  }).join("") || `<div class="empty" style="margin-top:4vh">Aucun résultat pour « ${esc($("#q").value)} »</div>`;
  el.innerHTML += `<p class="note">🔒 Vos documents restent sur cet appareil.</p>`;
}
$("#q").addEventListener("input", renderHome);
function renderDoc() {
  const d = S.cur; if (!d) return; $("#docTitle").textContent = d.name;
  $("#pages").innerHTML = d.pages.map((p, i) => `<div class="pg"><img src="${urlOf(p.thumb)}" data-page="${i}" alt="Page ${i + 1}"><div class="num">${i + 1}</div>${p.ocr ? '<div class="ocr">TEXTE</div>' : ""}<div class="mv"><button data-mv="${i}" data-dir="-1" ${i ? "" : "disabled"}>◀</button><button data-mv="${i}" data-dir="1" ${i < d.pages.length - 1 ? "" : "disabled"}>▶</button></div></div>`).join("")
    || `<div class="empty" style="grid-column:1/-1">Aucune page.<br>Ajoutez-en avec <b>Ajouter</b> ou <b>Importer</b>.</div>`;
}

/* ============ fenêtres ============ */
function sheet(html) { $("#sheet").innerHTML = html; $("#modal").classList.add("on"); $("#sheet").scrollTop = 0; }
function closeSheet() { $("#modal").classList.remove("on"); if (S.view === "cam" && CAM.paused) { CAM.paused = false; } }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeSheet(); });
function confirmBox(title, text, okLabel) {
  return new Promise(res => {
    sheet(`<h3>${title}</h3><p>${text}</p><div class="row"><button class="btn" id="mNo">Annuler</button><button class="btn red" id="mYes">${okLabel}</button></div>`);
    $("#mNo").onclick = () => { closeSheet(); res(false); }; $("#mYes").onclick = () => { closeSheet(); res(true); };
  });
}

/* ============ documents ============ */
function newDoc(prefix = "Scan") { const t = Date.now(); const d = { id: uid(), name: prefix + " " + fmtDate(t).replace(/\//g, "-").replace(",", ""), created: t, updated: t, pages: [] }; S.docs.push(d); return d; }
function lastFilter() { return lsGet("hs-filter", "auto"); }
async function addAutoPage(doc, canvas, quad) {
  const p = { id: uid(), quad: quad || fullQuad(canvas), rot: 0, filter: lastFilter(), adj: { b: 0, c: 0, s: 0 } };
  p.orig = await toBlob(canvas, .92); await renderPage(p, canvas); doc.pages.push(p); return p;
}

/* ============ import depuis la galerie / l'appareil photo du téléphone ============ */
let pendingTarget = null;
function pickFile(id) { const i = $(id); i.value = ""; i.click(); }
async function importFiles(files, doc) {
  files = [...files].filter(f => f.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name)); if (!files.length) return;
  doc = doc || newDoc(); S.cur = doc;
  if (files.length === 1) {
    await busy(true, "Détection du document…");
    try { const c = await fileToCanvas(files[0]); const q = await CVD.detect(c); await busy(false); startEdit({ doc, orig: c, quad: q }); }
    catch (e) { await busy(false); toast("Image illisible"); }
    return;
  }
  for (let k = 0; k < files.length; k++) {
    await busy(true, `Traitement de la page ${k + 1} / ${files.length}…`, k / files.length);
    try { const c = await fileToCanvas(files[k]); await addAutoPage(doc, c, await CVD.detect(c)); } catch (e) { toast("Une image n'a pas pu être lue"); }
  }
  await dbPut(doc); await busy(false); renderDoc(); show("doc"); toast(files.length + " pages ajoutées");
}
$("#inGal").addEventListener("change", e => {
  const files = e.target.files; if (!files.length) return;
  if (S.view === "cam") { camStop(); }
  importFiles(files, pendingTarget);
});
$("#inCam").addEventListener("change", e => { const f = e.target.files[0]; if (f) camFromFile(f); });

/* ============ caméra en direct ============ */
const CAM = { stream: null, track: null, live: false, mode: "doc", auto: lsGet("hs-auto", "1") === "1", shots: [], quad: null, disp: null, stableSince: 0, needMove: false, lastShot: 0, capturing: false, paused: false, raf: 0, timer: 0, torch: false, target: null, idStep: 0 };
const video = $("#camVideo"), ov = $("#camOverlay");
function camHint(t, ok) { const h = $("#camHint"); h.textContent = t; h.classList.toggle("ok", !!ok); }
async function openCamera(mode, target) {
  CAM.mode = mode || "doc"; CAM.target = target || null; CAM.shots = []; CAM.idStep = 0; CAM.quad = null; CAM.disp = null; CAM.needMove = false; CAM.paused = false;
  show("cam"); setCamMode(CAM.mode); updateShots();
  $("#autoBtn").classList.toggle("on", CAM.auto);
  if (CAM.live && CAM.stream) { loopStart(); return; }
  let ok = false;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      CAM.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } } });
      video.srcObject = CAM.stream; await video.play(); CAM.track = CAM.stream.getVideoTracks()[0]; ok = true;
      try { const cap = CAM.track.getCapabilities ? CAM.track.getCapabilities() : {}; $("#torchBtn").style.display = cap.torch ? "grid" : "none"; } catch (e) { }
    } catch (e) { ok = false; }
  }
  CAM.live = ok;
  $("#camNoLive").classList.toggle("on", !ok); video.style.display = ok ? "block" : "none";
  setCamMode(CAM.mode);
  if (ok) loopStart();
}
function camStop() {
  cancelAnimationFrame(CAM.raf); clearTimeout(CAM.timer);
  if (CAM.stream) CAM.stream.getTracks().forEach(t => t.stop());
  CAM.stream = null; CAM.track = null; CAM.live = false; CAM.torch = false; $("#torchBtn").classList.remove("on");
}
function setCamMode(m) {
  CAM.mode = m; $$("#camTabs button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
  $("#idFrame").classList.toggle("on", m === "id" && CAM.live);
  $("#autoBtn").style.visibility = m === "doc" && CAM.live ? "visible" : "hidden";
  $("#shutter").classList.toggle("qr", m === "qr");
  CAM.quad = null; CAM.disp = null; CAM.stableSince = 0;
  if (!CAM.live) {
    $("#noLiveTxt").innerHTML = m === "qr" ? "Appuyez sur le bouton jaune pour photographier le QR code." : m === "id" ? `Appuyez sur le bouton blanc pour photographier le <b>${CAM.idStep ? "VERSO" : "RECTO"}</b> de la carte.` : "Appuyez sur le bouton blanc pour photographier le document.";
  }
  if (m === "doc") camHint(CAM.live ? "Cadrez le document" : "Photo du document");
  else if (m === "id") camHint(CAM.idStep ? "Retournez la carte : VERSO" : "Placez la carte : RECTO", false);
  else camHint("Visez le QR code");
}
$("#camTabs").addEventListener("click", e => {
  const b = e.target.closest("[data-mode]"); if (!b) return;
  if (b.dataset.mode === "id" && CAM.mode !== "id") { CAM.shots = []; CAM.idStep = 0; updateShots(); }
  if (b.dataset.mode === "doc" && CAM.mode === "id") { CAM.shots = []; CAM.idStep = 0; updateShots(); }
  setCamMode(b.dataset.mode);
});
function updateShots() {
  const n = CAM.shots.length, d = $("#camDone");
  d.style.visibility = n && CAM.mode !== "qr" ? "visible" : "hidden"; $("#camCnt").textContent = n ? "✓ " + n : "0";
  if (n) urlFromCanvas(CAM.shots[n - 1].c).then(u => d.style.backgroundImage = `url('${u}')`);
}
async function urlFromCanvas(c) { const t = scaledCanvas(c, 200); const b = await toBlob(t.c, .7); return urlOf(b); }
function loopStart() {
  cancelAnimationFrame(CAM.raf); clearTimeout(CAM.timer);
  const draw = () => { drawOverlay(); CAM.raf = requestAnimationFrame(draw); }; draw();
  const tick = async () => {
    if (S.view !== "cam" || !CAM.live) return;
    if (!CAM.paused && !CAM.capturing && video.videoWidth) {
      try {
        if (CAM.mode === "qr") await qrFrame();
        else if (CAM.mode === "doc") await docFrame();
      } catch (e) { }
    }
    CAM.timer = setTimeout(tick, CAM.mode === "qr" ? 180 : 90);
  };
  tick();
}
const frameC = mk(10, 10);
function grabSmall(max) {
  const vw = video.videoWidth, vh = video.videoHeight, sc = Math.min(1, max / Math.max(vw, vh));
  frameC.width = Math.round(vw * sc); frameC.height = Math.round(vh * sc);
  const x = ctx(frameC); x.drawImage(video, 0, 0, frameC.width, frameC.height); return { sc, data: x.getImageData(0, 0, frameC.width, frameC.height) };
}
async function docFrame() {
  if (!CVD.ready) { camHint("Préparation de la détection…"); return; }
  const { sc, data } = grabSmall(420);
  const q = await CVD.raw(data, 1500);
  if (q === undefined) return;
  const now = performance.now();
  if (!q) {
    CAM.quad = null; CAM.stableSince = 0; CAM.needMove = false;
    camHint("Cadrez le document"); return;
  }
  const vq = q.map(p => [p[0] / sc, p[1] / sc]);
  const diag = Math.hypot(video.videoWidth, video.videoHeight);
  const mv = CAM.quad ? Math.max(...vq.map((p, i) => dist(p, CAM.quad[i]))) / diag : 1;
  CAM.quad = vq;
  if (mv < .022) { if (!CAM.stableSince) CAM.stableSince = now; } else CAM.stableSince = 0;
  if (CAM.needMove && mv > .12) CAM.needMove = false;
  const rel = area(vq) / (video.videoWidth * video.videoHeight);
  if (rel < .15) { camHint("Rapprochez-vous du document"); return; }
  if (!CAM.auto) { camHint("Document trouvé : appuyez pour prendre", true); return; }
  if (CAM.needMove) { camHint("Page suivante… ou appuyez sur ✓", true); return; }
  if (CAM.stableSince && now - CAM.stableSince > 850 && now - CAM.lastShot > 1600) { camHint("Capture !", true); shoot(true); }
  else camHint("Ne bougez plus…", true);
}
function drawOverlay() {
  const r = ov.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (ov.width !== Math.round(r.width * dpr)) { ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr); }
  const x = ov.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, r.width, r.height);
  if (!CAM.live || CAM.mode !== "doc" || !CAM.quad || !video.videoWidth) { CAM.disp = null; return; }
  const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(r.width / vw, r.height / vh), ox = (r.width - vw * s) / 2, oy = (r.height - vh * s) / 2;
  const target = CAM.quad.map(p => [ox + p[0] * s, oy + p[1] * s]);
  CAM.disp = CAM.disp ? CAM.disp.map((p, i) => [p[0] + (target[i][0] - p[0]) * .35, p[1] + (target[i][1] - p[1]) * .35]) : target;
  const P = CAM.disp;
  x.beginPath(); x.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) x.lineTo(P[i][0], P[i][1]); x.closePath();
  x.fillStyle = "rgba(245,200,0,.22)"; x.fill(); x.lineWidth = 4; x.strokeStyle = "#F5C800"; x.stroke();
  P.forEach(p => { x.beginPath(); x.arc(p[0], p[1], 9, 0, 7); x.fillStyle = "#F5C800"; x.fill(); });
}
async function grabFull() {
  let c = null;
  if (window.ImageCapture && CAM.track) {
    try { const ic = new ImageCapture(CAM.track); const blob = await Promise.race([ic.takePhoto(), sleep(3500).then(() => null)]); if (blob) c = await fileToCanvas(blob); } catch (e) { c = null; }
  }
  if (!c) { const vw = video.videoWidth, vh = video.videoHeight; c = mk(vw, vh); ctx(c).drawImage(video, 0, 0); c = scaledCanvas(c, 2600).c; }
  return c;
}
function flash() { const f = $("#camFlash"); f.style.transition = "none"; f.style.opacity = ".85"; requestAnimationFrame(() => { f.style.transition = "opacity .35s"; f.style.opacity = "0"; }); vibrate(40); }
async function shoot(isAuto) {
  if (CAM.capturing) return;
  if (!CAM.live) {
    if (CAM.mode === "qr") pickFile("#inQr"); else pickFile("#inCam");
    return;
  }
  if (CAM.mode === "qr") { await qrFrame(true); return; }
  CAM.capturing = true; flash();
  try {
    const c = await grabFull();
    let q = null;
    if (CAM.mode === "id") q = await CVD.detect(c); else {
      q = await CVD.detect(c);
    }
    await addShot(c, q);
  } finally { CAM.capturing = false; CAM.lastShot = performance.now(); CAM.needMove = true; CAM.stableSince = 0; }
}
async function addShot(c, q) {
  CAM.shots.push({ c, q }); updateShots();
  if (CAM.mode === "id") {
    if (CAM.shots.length === 1) { CAM.idStep = 1; setCamMode("id"); toast("Recto pris ✓ — retournez la carte"); }
    else { finishCamera(); }
  } else toast(`Page ${CAM.shots.length} prise ✓`);
}
async function camFromFile(file) {
  await busy(true, "Détection du document…");
  try { const c = await fileToCanvas(file); const q = await CVD.detect(c); await busy(false); await addShot(c, q); if (CAM.mode === "doc" && CAM.shots.length === 1 && !CAM.live) finishCamera(); }
  catch (e) { await busy(false); toast("Image illisible"); }
}
async function finishCamera() {
  const shots = CAM.shots.slice(), mode = CAM.mode; CAM.shots = []; updateShots(); camStop();
  if (!shots.length) { show(S.cur ? "doc" : "home"); return; }
  const doc = CAM.target || newDoc(mode === "id" ? "Carte ID" : "Scan"); S.cur = doc;
  if (mode === "id") {
    S.idParts = []; S.editQueue = shots.map((s, i) => ({ doc, orig: s.c, quad: s.q, idPart: i }));
    return nextEdit();
  }
  if (shots.length === 1) return startEdit({ doc, orig: shots[0].c, quad: shots[0].q });
  for (let k = 0; k < shots.length; k++) { await busy(true, `Amélioration de la page ${k + 1} / ${shots.length}…`, k / shots.length); await addAutoPage(doc, shots[k].c, shots[k].q); }
  await dbPut(doc); await busy(false); renderDoc(); show("doc"); toast(shots.length + " pages ajoutées");
}

/* ============ QR codes ============ */
let bd = null; try { if ("BarcodeDetector" in window) bd = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { bd = null; }
async function decodeCanvas(c) {
  if (bd) { try { const r = await bd.detect(c); if (r && r.length) return r[0].rawValue; } catch (e) { } }
  if (typeof jsQR !== "function") return null;
  for (const m of [900, 1400, 600]) { const s = scaledCanvas(c, m).c, id = ctx(s).getImageData(0, 0, s.width, s.height); const r = jsQR(id.data, s.width, s.height, { inversionAttempts: "attemptBoth" }); if (r && r.data) return r.data; if (Math.max(c.width, c.height) <= m) break; }
  return null;
}
async function qrFrame(manual) {
  let t = null;
  if (bd) { try { const r = await bd.detect(video); if (r && r.length) t = r[0].rawValue; } catch (e) { } }
  if (!t && typeof jsQR === "function") { const { data } = grabSmall(720); const r = jsQR(data.data, data.width, data.height, { inversionAttempts: "dontInvert" }); if (r && r.data) t = r.data; }
  if (t) { vibrate(60); CAM.paused = true; qrSave(t); showQR(t); }
  else if (manual) toast("Aucun QR code visible");
}
function qrHist() { try { return JSON.parse(lsGet("ks-qr", "[]")); } catch (e) { return []; } }
function qrSave(t) { const h = qrHist().filter(x => x !== t); h.unshift(t); lsSet("ks-qr", JSON.stringify(h.slice(0, 15))); }
function qrInfo(t) {
  if (/^https?:\/\//i.test(t)) return { kind: "Lien internet", show: t, link: t, label: "🌐 Ouvrir le lien" };
  if (/^www\./i.test(t)) return { kind: "Lien internet", show: t, link: "https://" + t, label: "🌐 Ouvrir le lien" };
  if (/^tel:/i.test(t)) return { kind: "Numéro de téléphone", show: t.slice(4), link: t, label: "📞 Appeler" };
  if (/^mailto:/i.test(t)) return { kind: "Adresse e-mail", show: t.slice(7).split("?")[0], link: t, label: "✉️ Écrire un e-mail" };
  if (/^smsto?:/i.test(t)) return { kind: "SMS", show: t.replace(/^smsto?:/i, "") };
  if (/^WIFI:/i.test(t)) { const g = k => { const m = t.match(new RegExp("[:;]" + k + ":((?:\\\\.|[^;])*)")); return m ? m[1].replace(/\\(.)/g, "$1") : ""; }; return { kind: "Réseau Wi-Fi", show: "Réseau : " + g("S") + "\nMot de passe : " + (g("P") || "(aucun)"), copy: g("P") || g("S"), copyLabel: "📋 Copier le mot de passe" }; }
  if (/^BEGIN:VCARD/i.test(t)) { const g = k => { const m = t.match(new RegExp("^" + k + "[^:]*:(.*)$", "mi")); return m ? m[1].trim() : ""; }; return { kind: "Carte de contact", show: [g("FN"), g("TEL"), g("EMAIL"), g("ORG")].filter(Boolean).join("\n") || t }; }
  if (/^geo:/i.test(t)) return { kind: "Position GPS", show: t.slice(4), link: "https://maps.google.com/?q=" + encodeURIComponent(t.slice(4).split("?")[0]), label: "🗺️ Voir sur la carte" };
  return { kind: "Texte", show: t };
}
function showQR(t) {
  const i = qrInfo(t), h = qrHist().filter(x => x !== t).slice(0, 10);
  sheet(`<h3>QR code lu ✓</h3><div class="qrkind">${esc(i.kind)}</div><div class="qrres">${esc(i.show)}</div>
  <div class="col">${i.link ? `<a class="btn y" href="${esc(i.link)}" target="_blank" rel="noopener">${i.label}</a>` : ""}
  <button class="btn ${i.link ? "" : "y"}" id="qCopy">${i.copyLabel || "📋 Copier"}</button>
  <div class="row"><button class="btn" id="qAgain">🔳 Autre QR</button><button class="btn" id="qClose">Fermer</button></div></div>
  ${h.length ? `<div class="hist"><h4>Derniers QR codes lus</h4>${h.map((x, k) => `<button data-hq="${k}">${esc(x)}</button>`).join("")}</div>` : ""}`);
  $("#qCopy").onclick = () => copyText(i.copy || t);
  $("#qAgain").onclick = () => { closeSheet(); if (S.view !== "cam") openCamera("qr"); else if (!CAM.live) pickFile("#inQr"); };
  $("#qClose").onclick = () => { closeSheet(); };
  $$("[data-hq]").forEach(b => b.onclick = () => showQR(h[+b.dataset.hq]));
}
$("#inQr").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return; await busy(true, "Lecture du QR code…"); let t = null;
  try { t = await decodeCanvas(await fileToCanvas(f, 1600)); } catch (err) { } await busy(false);
  if (t) { qrSave(t); showQR(t); }
  else { sheet(`<h3>Aucun QR code trouvé</h3><p>Reprenez la photo en vous approchant : le QR code doit être net, bien éclairé et occuper une bonne partie de l'image.</p><div class="row"><button class="btn" id="qClose">Fermer</button><button class="btn y" id="qAgain">🔳 Réessayer</button></div>`); $("#qClose").onclick = closeSheet; $("#qAgain").onclick = () => { closeSheet(); pickFile("#inQr"); }; }
});
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast("Copié ✓"); } catch (e) { toast("Copie impossible : sélectionnez le texte"); } }

/* ============ recadrage ============ */
function nextEdit() { const n = S.editQueue.shift(); if (n) startEdit(n); }
function startEdit(o) {
  // o = {doc, orig, quad, page?, idx?, idPart?}
  const isNew = o.page == null;
  const q = o.quad ? o.quad.map(p => p.slice()) : (isNew ? fullQuad(o.orig, .04) : o.page.quad.map(p => p.slice()));
  const pv = scaledCanvas(o.orig, 1500);
  S.E = { doc: o.doc, idx: o.idx, page: o.page || null, isNew, orig: o.orig, quad: q, rot: isNew ? 0 : (o.page.rot || 0), filter: isNew ? (o.idPart != null ? "sharp" : lastFilter()) : (o.page.filter || "auto"), adj: isNew ? { b: 0, c: 0, s: 0 } : Object.assign({ b: 0, c: 0, s: 0 }, o.page.adj), prevSrc: pv.c, prevSc: pv.sc, drag: -1, idPart: o.idPart };
  $("#cropTitle").textContent = o.idPart === 0 ? "Recto de la carte" : o.idPart === 1 ? "Verso de la carte" : "Recadrer";
  show("crop");
}
const cc = $("#cropCanvas"); const CV = { s: 1, ox: 0, oy: 0, dpr: 1, w: 0, h: 0 };
function layoutCrop() {
  const E = S.E; if (!E) return; const r = $("#cropBox").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  CV.w = r.width; CV.h = r.height; CV.dpr = dpr; cc.width = Math.round(r.width * dpr); cc.height = Math.round(r.height * dpr);
  const pad = 30, img = E.prevSrc, s = Math.min((r.width - 2 * pad) / img.width, (r.height - 2 * pad) / img.height);
  CV.s = s; CV.ox = (r.width - img.width * s) / 2; CV.oy = (r.height - img.height * s) / 2; drawCrop();
}
window.addEventListener("resize", () => { if (S.view === "crop") layoutCrop(); });
function scr(p) { const k = S.E.prevSc; return [CV.ox + p[0] * k * CV.s, CV.oy + p[1] * k * CV.s]; }
function drawCrop() {
  const E = S.E, x = cc.getContext("2d"), img = E.prevSrc; x.setTransform(CV.dpr, 0, 0, CV.dpr, 0, 0); x.clearRect(0, 0, CV.w, CV.h);
  x.drawImage(img, CV.ox, CV.oy, img.width * CV.s, img.height * CV.s);
  const P = E.quad.map(scr);
  x.beginPath(); x.rect(0, 0, CV.w, CV.h); x.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) x.lineTo(P[i][0], P[i][1]); x.closePath(); x.fillStyle = "rgba(14,15,12,.55)"; x.fill("evenodd");
  x.beginPath(); x.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) x.lineTo(P[i][0], P[i][1]); x.closePath(); x.strokeStyle = "#F5C800"; x.lineWidth = 3; x.stroke();
  // poignées des côtés
  for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; x.beginPath(); x.arc(m[0], m[1], 9, 0, 7); x.fillStyle = "#F5C800"; x.fill(); }
  P.forEach((p, i) => { x.beginPath(); x.arc(p[0], p[1], E.drag === i ? 18 : 15, 0, 7); x.fillStyle = "rgba(245,200,0,.35)"; x.fill(); x.lineWidth = 4; x.strokeStyle = "#F5C800"; x.stroke(); });
  if (E.drag >= 0 && E.drag < 4) {
    const p = P[E.drag], R = 62, z = 2.6; let lx = p[0], ly = p[1] - R - 46; if (ly < R + 4) ly = p[1] + R + 46; lx = Math.min(CV.w - R - 4, Math.max(R + 4, lx));
    x.save(); x.beginPath(); x.arc(lx, ly, R, 0, 7); x.clip(); x.fillStyle = "#000"; x.fillRect(lx - R, ly - R, 2 * R, 2 * R);
    const k = CV.s * z; x.drawImage(img, lx - (p[0] - CV.ox) * z, ly - (p[1] - CV.oy) * z, img.width * k, img.height * k);
    x.strokeStyle = "#F5C800"; x.lineWidth = 2; x.beginPath(); x.moveTo(lx - 14, ly); x.lineTo(lx + 14, ly); x.moveTo(lx, ly - 14); x.lineTo(lx, ly + 14); x.stroke(); x.restore();
    x.beginPath(); x.arc(lx, ly, R, 0, 7); x.lineWidth = 4; x.strokeStyle = "#F5C800"; x.stroke();
  }
}
function toImg(sx, sy) { const k = S.E.prevSc * CV.s; return [Math.min(S.E.orig.width, Math.max(0, (sx - CV.ox) / k)), Math.min(S.E.orig.height, Math.max(0, (sy - CV.oy) / k))]; }
cc.addEventListener("pointerdown", e => {
  const E = S.E; if (!E) return; const r = cc.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const P = E.quad.map(scr); let bi = -1, bd2 = 46;
  P.forEach((p, i) => { const d = Math.hypot(p[0] - px, p[1] - py); if (d < bd2) { bd2 = d; bi = i; } });
  if (bi < 0) for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const d = Math.hypot(m[0] - px, m[1] - py); if (d < 36) { bi = 4 + i; } }
  if (bi >= 0) { E.drag = bi; E.last = [px, py]; E.grab = bi < 4 ? [P[bi][0] - px, P[bi][1] - py] : [0, 0]; cc.setPointerCapture(e.pointerId); drawCrop(); }
});
cc.addEventListener("pointermove", e => {
  const E = S.E; if (!E || E.drag < 0) return; const r = cc.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (E.drag < 4) E.quad[E.drag] = toImg(px + E.grab[0], py + E.grab[1]);
  else { // déplacer un côté entier
    const i = E.drag - 4, j = (i + 1) % 4, k = E.prevSc * CV.s, dx = (px - E.last[0]) / k, dy = (py - E.last[1]) / k;
    for (const n of [i, j]) E.quad[n] = [Math.min(E.orig.width, Math.max(0, E.quad[n][0] + dx)), Math.min(E.orig.height, Math.max(0, E.quad[n][1] + dy))];
  }
  E.last = [px, py]; drawCrop();
});
["pointerup", "pointercancel"].forEach(t => cc.addEventListener(t, () => { if (S.E) { S.E.drag = -1; drawCrop(); } }));

/* ============ amélioration (aperçu) ============ */
let prevTimer = 0;
function buildPreview() { const E = S.E; const q = E.quad.map(p => [p[0] * E.prevSc, p[1] * E.prevSc]); E.prevBase = rotateCanvas(warp(E.prevSrc, q, 1100), E.rot); drawPreview(true); }
function drawPreview(now) {
  const E = S.E; if (!E) return;
  $("#chips").innerHTML = FILTERS.map(([k, l]) => `<button class="chip ${k === E.filter ? "on" : ""}" data-filter="${k}">${l}</button>`).join("");
  $("#aB").value = E.adj.b; $("#aC").value = E.adj.c; $("#aS").value = E.adj.s;
  clearTimeout(prevTimer); $("#prevBusy").style.display = "block";
  prevTimer = setTimeout(() => {
    const f = applyFilter(E.prevBase, E.filter, E.adj), pc = $("#prevCanvas"); pc.width = f.width; pc.height = f.height; pc.getContext("2d").drawImage(f, 0, 0);
    $("#prevBusy").style.display = "none";
  }, now ? 0 : 60);
}
["aB", "aC", "aS"].forEach(id => $("#" + id).addEventListener("input", () => { const E = S.E; if (!E) return; E.adj = { b: +$("#aB").value, c: +$("#aC").value, s: +$("#aS").value }; drawPreview(); }));

/* ============ carte d'identité : assemblage sur A4 ============ */
async function composeId(parts) {
  // A4 à 300 ppp ; carte au format réel (85,6 × 54 mm)
  const W = 2480, H = 3508, c = mk(W, H), x = ctx(c); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
  const cw = Math.round(85.6 / 25.4 * 300), ch = Math.round(54 / 25.4 * 300);
  parts.forEach((p, i) => {
    let img = p; if (img.height > img.width) img = rotateCanvas(img, 3);
    const s = Math.min(cw / img.width, ch / img.height), w = img.width * s, h = img.height * s;
    const cy = i === 0 ? H * .28 : H * .62;
    x.imageSmoothingQuality = "high"; x.drawImage(img, (W - w) / 2, cy - h / 2, w, h);
    x.strokeStyle = "#ddd"; x.lineWidth = 2; x.strokeRect((W - w) / 2, cy - h / 2, w, h);
  });
  return c;
}

/* ============ PDF (avec texte invisible cherchable) ============ */
function latin1(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[i] = c < 256 ? c : 63; } return u; }
const WINANSI = { "€": 128, "‚": 130, "ƒ": 131, "„": 132, "…": 133, "†": 134, "‡": 135, "ˆ": 136, "‰": 137, "Š": 138, "‹": 139, "Œ": 140, "Ž": 142, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151, "˜": 152, "™": 153, "š": 154, "›": 155, "œ": 156, "ž": 158, "Ÿ": 159 };
function pdfStr(t) { let o = ""; for (const ch of t) { let c = ch.charCodeAt(0); if (WINANSI[ch]) c = WINANSI[ch]; else if (c > 255) c = 63; const s = String.fromCharCode(c); o += s === "(" || s === ")" || s === "\\" ? "\\" + s : s; } return o; }
const measureC = mk(10, 10).getContext("2d"); measureC.font = "100px Helvetica, Arial, sans-serif";
async function makePdf(pages, quality) {
  const Q = { compact: [1500, .6], standard: [2000, .78], haute: [99999, .9] }[quality || "standard"];
  const parts = [], offs = []; let len = 0;
  const push = x => { const u = typeof x === "string" ? latin1(x) : x; parts.push(u); len += u.length; };
  const obj = (n, s) => { offs[n] = len; push(n + " 0 obj\n" + s + "\nendobj\n"); };
  push("%PDF-1.4\n%âãÏÓ\n");
  const N = pages.length; obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => (4 + 3 * i) + " 0 R").join(" ")}] /Count ${N} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  for (let i = 0; i < N; i++) {
    const p = pages[i];
    let blob = p.out, w = p.w, h = p.h;
    if (quality !== "haute") { const c = await fileToCanvas(p.out, Q[0]); w = c.width; h = c.height; blob = await toBlob(c, Q[1]); }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const land = w > h, PW = land ? 841.89 : 595.28, PH = land ? 595.28 : 841.89;
    const s = Math.min(PW / w, PH / h), dw = w * s, dh = h * s, x = (PW - dw) / 2, y = (PH - dh) / 2, pn = 4 + 3 * i, cn = pn + 1, im = pn + 2;
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${im} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${cn} 0 R >>`);
    let c = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q\n`;
    if (p.ocr && p.ocr.words && p.ocr.words.length) {
      const k = s * (w / p.ocr.w); // pixels OCR -> points PDF
      c += "BT 3 Tr\n";
      for (const wd of p.ocr.words) {
        const t = (wd.t || "").trim(); if (!t) continue;
        const bw = (wd.x1 - wd.x0) * k, bh = (wd.y1 - wd.y0) * k; if (bw <= 0 || bh <= 0) continue;
        const fs = Math.max(1, bh * .92), natural = measureC.measureText(t).width / 100 * fs, tz = natural > 0 ? Math.max(10, Math.min(500, bw / natural * 100)) : 100;
        const px = x + wd.x0 * k, py = y + dh - wd.y1 * k + bh * .18;
        c += `/F1 ${fs.toFixed(2)} Tf ${tz.toFixed(1)} Tz 1 0 0 1 ${px.toFixed(2)} ${py.toFixed(2)} Tm (${pdfStr(t)}) Tj\n`;
      }
      c += "ET\n";
    }
    const cb = latin1(c);
    offs[cn] = len; push(`${cn} 0 obj\n<< /Length ${cb.length} >>\nstream\n`); push(cb); push("\nendstream\nendobj\n");
    offs[im] = len; push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`); push(bytes); push("\nendstream\nendobj\n");
  }
  const total = 4 + 3 * N, xref = len; let t = "xref\n0 " + total + "\n0000000000 65535 f \n";
  for (let k = 1; k < total; k++) t += String(offs[k]).padStart(10, "0") + " 00000 n \n";
  push(t + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/* ============ reconnaissance du texte (OCR) ============ */
let TW = null, ocrProg = null;
async function ocrWorker() {
  if (TW) return TW;
  TW = (async () => {
    if (!window.Tesseract) await loadScript("tess/tesseract.min.js");
    const base = new URL(".", location.href).href;
    return Tesseract.createWorker("fra", 1, {
      workerPath: base + "tess/ocrworker.js", workerBlobURL: false, corePath: base + "tess/core", langPath: base + "tess/lang",
      logger: m => { if (ocrProg && m && typeof m.progress === "number") ocrProg(m); }
    });
  })();
  try { return await TW; } catch (e) { TW = null; throw e; }
}
async function ocrPage(p, onProg) {
  ocrProg = onProg; const w = await ocrWorker();
  const { data } = await w.recognize(p.out, {}, { text: true, blocks: true });
  const words = [];
  for (const b of data.blocks || []) for (const pa of b.paragraphs || []) for (const l of pa.lines || []) for (const wd of l.words || []) {
    if (wd.text && wd.text.trim() && wd.confidence > 25) words.push({ t: wd.text, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 });
  }
  p.ocr = { text: (data.text || "").trim(), words, w: p.w, h: p.h }; ocrProg = null; return p.ocr;
}
async function ocrPages(doc, list) {
  const todo = list.filter(p => !p.ocr);
  try {
    for (let i = 0; i < todo.length; i++) {
      const lbl = `Lecture du texte… page ${i + 1} / ${todo.length}`;
      await busy(true, TW ? lbl : "Préparation de la lecture du texte…", i / todo.length);
      await ocrPage(todo[i], m => { const base = i / todo.length, part = m.status === "recognizing text" ? m.progress : 0; $("#busyTxt").textContent = m.status === "recognizing text" ? lbl : "Préparation de la lecture du texte…"; $("#busyProg i").style.width = Math.round((base + part / todo.length) * 100) + "%"; });
    }
    await dbPut(doc); await busy(false); return true;
  } catch (e) { await busy(false); toast("Lecture du texte impossible ici"); return false; }
}
function showText(title, text) {
  sheet(`<h3>${esc(title)}</h3><textarea id="txtArea">${esc(text || "")}</textarea><div class="row"><button class="btn y" id="tCopy">📋 Copier</button><button class="btn" id="tSave">💾 .txt</button><button class="btn" id="tClose">Fermer</button></div>`);
  $("#tCopy").onclick = () => copyText($("#txtArea").value);
  $("#tSave").onclick = () => saveFile(fname(S.cur) + ".txt", new Blob([$("#txtArea").value], { type: "text/plain" }));
  $("#tClose").onclick = closeSheet;
}

/* ============ signature ============ */
function signaturePad(onDone) {
  sheet(`<h3>Votre signature</h3><p>Signez avec le doigt dans le cadre blanc.</p><canvas id="pad"></canvas><div class="row"><button class="btn" id="pClear">Effacer</button><button class="btn" id="pCancel">Annuler</button><button class="btn y" id="pOk">Valider ✓</button></div>`);
  const pad = $("#pad"), r = pad.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; pad.width = r.width * dpr; pad.height = r.height * dpr;
  const x = pad.getContext("2d"); x.scale(dpr, dpr); x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = "#0b1a5c";
  let drawing = false, last = null, lastT = 0, drawn = false, lw = 3.2;
  const pos = e => { const b = pad.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  pad.onpointerdown = e => { drawing = true; last = pos(e); lastT = performance.now(); pad.setPointerCapture(e.pointerId); x.beginPath(); x.arc(last[0], last[1], 1.4, 0, 7); x.fillStyle = "#0b1a5c"; x.fill(); drawn = true; };
  pad.onpointermove = e => { if (!drawing) return; const p = pos(e), t = performance.now(), v = dist(p, last) / Math.max(1, t - lastT); const target = Math.max(1.6, Math.min(4.2, 4.4 - v * 1.6)); lw += (target - lw) * .35; x.lineWidth = lw; x.beginPath(); x.moveTo(last[0], last[1]); x.lineTo(p[0], p[1]); x.stroke(); last = p; lastT = t; };
  pad.onpointerup = pad.onpointercancel = () => drawing = false;
  $("#pClear").onclick = () => { x.clearRect(0, 0, pad.width, pad.height); drawn = false; };
  $("#pCancel").onclick = closeSheet;
  $("#pOk").onclick = () => {
    if (!drawn) { toast("Signez d'abord dans le cadre"); return; }
    const d = ctx(pad).getImageData(0, 0, pad.width, pad.height).data; let x0 = pad.width, y0 = pad.height, x1 = 0, y1 = 0;
    for (let y = 0; y < pad.height; y++) for (let xx = 0; xx < pad.width; xx++) if (d[(y * pad.width + xx) * 4 + 3] > 10) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const m = 8, w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m, o = mk(w, h); o.getContext("2d").drawImage(pad, x0 - m, y0 - m, w, h, 0, 0, w, h);
    const url = o.toDataURL("image/png"); lsSet("hs-sig", url); closeSheet(); onDone(url);
  };
}
let SG = null;
function startSign(doc, idx) {
  const p = doc.pages[idx]; const sig = lsGet("hs-sig", null);
  if (!sig) { signaturePad(() => startSign(doc, idx)); return; }
  // On affiche la page SANS signature pour la placer
  SG = { doc, idx, p, sig, x: p.sig ? p.sig.x : .55, y: p.sig ? p.sig.y : .78, w: p.sig ? p.sig.w : .32 };
  (async () => {
    await busy(true, "Préparation…");
    const tmp = Object.assign({}, p, { sig: null }); await rerender(tmp); SG.base = tmp.out;
    await busy(false);
    $("#signPage").src = urlOf(SG.base); $("#signImgEl").src = sig; $("#signRemoveBtn").style.display = p.sig ? "flex" : "none";
    show("sign"); $("#signPage").onload = placeSig; placeSig();
  })();
}
function placeSig() {
  if (!SG) return; const pg = $("#signPage"), W = pg.clientWidth, H = pg.clientHeight; if (!W) return;
  const el = $("#signImg"), im = $("#signImgEl"); const ar = im.naturalWidth ? im.naturalHeight / im.naturalWidth : .4;
  SG.x = Math.max(0, Math.min(1 - SG.w, SG.x)); const hh = SG.w * W * ar / H; SG.y = Math.max(0, Math.min(1 - hh, SG.y));
  el.style.left = SG.x * W + "px"; el.style.top = SG.y * H + "px"; el.style.width = SG.w * W + "px"; el.style.height = SG.w * W * ar + "px";
}
(() => {
  const el = $("#signImg"), res = $("#signRes"); let mode = null, st = null;
  el.addEventListener("pointerdown", e => { if (e.target === res) return; mode = "move"; st = [e.clientX, e.clientY, SG.x, SG.y]; el.setPointerCapture(e.pointerId); });
  res.addEventListener("pointerdown", e => { e.stopPropagation(); mode = "size"; st = [e.clientX, e.clientY, SG.w]; res.setPointerCapture(e.pointerId); });
  const mv = e => { if (!mode || !SG) return; const pg = $("#signPage"), W = pg.clientWidth, H = pg.clientHeight; if (mode === "move") { SG.x = st[2] + (e.clientX - st[0]) / W; SG.y = st[3] + (e.clientY - st[1]) / H; } else { SG.w = Math.max(.08, Math.min(.9, st[2] + (e.clientX - st[0]) / W)); } placeSig(); };
  el.addEventListener("pointermove", mv); res.addEventListener("pointermove", mv);
  const up = () => mode = null; el.addEventListener("pointerup", up); res.addEventListener("pointerup", up);
  window.addEventListener("resize", () => { if (S.view === "sign") placeSig(); });
})();

/* ============ fichiers : enregistrer / partager ============ */
// Dans l'application Android/iPhone (Capacitor) : fichiers et partage natifs
const CAP = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? window.Capacitor : null;
function blobToB64(blob) { return new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.onerror = j; fr.readAsDataURL(blob); }); }
async function nativeWrite(name, blob, dir) { const res = await CAP.Plugins.Filesystem.writeFile({ path: name, data: await blobToB64(blob), directory: dir, recursive: true }); return res.uri; }
if (CAP) document.addEventListener("click", e => { const a = e.target.closest("a[target=_blank]"); if (a) { e.preventDefault(); location.href = a.href; } }, true);
async function getDl() { try { if (window.claude && typeof window.claude.use === "function") return await window.claude.use("downloads"); } catch (e) { } return null; }
async function saveFile(name, blob) {
  if (CAP) {
    try { await nativeWrite("Hopla Scan/" + name, blob, "DOCUMENTS"); toast("Enregistré dans Documents › Hopla Scan ✓"); return true; }
    catch (e) { return shareFile(name, blob); }
  }
  const dl = await getDl();
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); toast("Fichier enregistré ✓"); return true; }
    catch (e) { if (e && e.code === "declined") { toast("Enregistrement annulé"); return false; } if (e && e.code === "rate_limited") { toast("Patientez un instant puis réessayez"); return false; } }
  }
  try { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000); toast("Téléchargement lancé"); return true; }
  catch (e) { toast("Enregistrement impossible ici"); } return false;
}
async function shareFile(name, blob) {
  if (CAP) {
    try { const uri = await nativeWrite(name, blob, "CACHE"); await CAP.Plugins.Share.share({ title: name, files: [uri], dialogTitle: "Partager " + name }); return true; }
    catch (e) { if (e && /cancel/i.test(e.message || "")) return false; toast("Partage impossible"); return false; }
  }
  try {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return true; }
  } catch (e) { if (e && e.name === "AbortError") return false; }
  return saveFile(name, blob);
}
const fname = d => ((d && d.name) || "scan").replace(/[\\/:*?"<>|]+/g, "-").trim() || "scan";
function fileReady(name, blob, label) {
  const size = blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(blob.size / 1024)) + " Ko";
  sheet(`<h3>${label} prêt ✓</h3><p>${esc(name)} · ${size}</p><div class="col"><button class="btn y" id="fShare">📤 Partager (WhatsApp, e-mail…)</button><button class="btn" id="fSave">💾 Enregistrer sur le téléphone</button><button class="btn" id="fClose">Fermer</button></div>`);
  $("#fShare").onclick = async () => { closeSheet(); await shareFile(name, blob); };
  $("#fSave").onclick = async () => { closeSheet(); await saveFile(name, blob); };
  $("#fClose").onclick = closeSheet;
}

/* ============ actions ============ */
const ACT = {
  scan: () => { pendingTarget = null; openCamera("doc", null); },
  scanMore: () => { openCamera("doc", S.cur); },
  qr: () => openCamera("qr", null),
  gal: () => { pendingTarget = S.view === "doc" ? S.cur : null; pickFile("#inGal"); },
  camGal: () => { pendingTarget = CAM.target; pickFile("#inGal"); },
  camClose: () => { const t = CAM.target; CAM.shots = []; camStop(); if (t) { renderDoc(); show("doc"); } else { renderHome(); show("home"); } },
  shutter: () => shoot(false),
  camDone: () => finishCamera(),
  autoToggle: () => { CAM.auto = !CAM.auto; lsSet("hs-auto", CAM.auto ? "1" : "0"); $("#autoBtn").classList.toggle("on", CAM.auto); toast(CAM.auto ? "Capture automatique activée" : "Capture manuelle"); },
  torch: async () => { if (!CAM.track) return; CAM.torch = !CAM.torch; try { await CAM.track.applyConstraints({ advanced: [{ torch: CAM.torch }] }); $("#torchBtn").classList.toggle("on", CAM.torch); } catch (e) { CAM.torch = false; toast("Lampe indisponible"); } },
  home: () => { S.cur = null; renderHome(); show("home"); },
  rename: () => {
    const d = S.cur; sheet(`<h3>Renommer</h3><input type="text" id="mIn" value="${esc(d.name)}" maxlength="80"><div class="row"><button class="btn" id="mNo">Annuler</button><button class="btn y" id="mYes">OK</button></div>`);
    const i = $("#mIn"); setTimeout(() => { i.focus(); i.select(); }, 50);
    const ok = async () => { const v = i.value.trim(); if (v) { d.name = v; await dbPut(d); renderDoc(); } closeSheet(); };
    $("#mYes").onclick = ok; i.onkeydown = e => { if (e.key === "Enter") ok(); }; $("#mNo").onclick = closeSheet;
  },
  docmenu: () => {
    const d = S.cur, hasTxt = d.pages.length && d.pages.every(p => p.ocr);
    sheet(`<h3>${esc(d.name)}</h3><div class="col">
      <button class="btn opt" id="mOcr"><span class="ic">🔤</span><span>${hasTxt ? "Voir le texte du document" : "Reconnaître le texte"}<small>${hasTxt ? "Copier ou enregistrer le texte" : "Rend le PDF cherchable et permet de copier le texte"}</small></span></button>
      <button class="btn opt" id="mAll"><span class="ic">🎨</span><span>Même filtre pour toutes les pages</span></button>
      <button class="btn opt" id="mJpg"><span class="ic">🖼️</span><span>Exporter les pages en images JPG</span></button>
      <button class="btn opt" id="mRen"><span class="ic">✎</span><span>Renommer</span></button>
      <button class="btn red opt" id="mDel"><span class="ic">🗑</span><span>Supprimer le document</span></button>
      <button class="btn" id="mNo">Fermer</button></div>`);
    $("#mNo").onclick = closeSheet; $("#mRen").onclick = () => { closeSheet(); ACT.rename(); };
    $("#mOcr").onclick = async () => { closeSheet(); if (!d.pages.length) return; if (await ocrPages(d, d.pages)) { renderDoc(); showText(d.name, d.pages.map((p, i) => (d.pages.length > 1 ? `— Page ${i + 1} —\n` : "") + (p.ocr ? p.ocr.text : "")).join("\n\n")); } };
    $("#mJpg").onclick = async () => { closeSheet(); for (let i = 0; i < d.pages.length; i++) { const ok = await saveFile(fname(d) + (d.pages.length > 1 ? "-p" + (i + 1) : "") + ".jpg", d.pages[i].out); if (!ok) break; } };
    $("#mAll").onclick = () => {
      sheet(`<h3>Filtre pour toutes les pages</h3><div class="col">${FILTERS.map(([k, l]) => `<button class="btn" data-allf="${k}">${l}</button>`).join("")}<button class="btn" id="mNo">Annuler</button></div>`);
      $("#mNo").onclick = closeSheet;
      $$("[data-allf]").forEach(b => b.onclick = async () => {
        closeSheet(); const f = b.dataset.allf;
        for (let i = 0; i < d.pages.length; i++) { await busy(true, `Page ${i + 1} / ${d.pages.length}…`, i / d.pages.length); const p = d.pages[i]; p.filter = f; p.ocr = null; await rerender(p); }
        await dbPut(d); await busy(false); renderDoc(); toast("Filtre appliqué ✓");
      });
    };
    $("#mDel").onclick = async () => { closeSheet(); if (await confirmBox("Supprimer ?", "Le document « " + esc(d.name) + " » et toutes ses pages seront effacés.", "Supprimer")) { S.docs = S.docs.filter(x => x !== d); await dbDel(d.id); ACT.home(); toast("Document supprimé"); } };
  },
  share: () => {
    const d = S.cur; if (!d || !d.pages.length) { toast("Ajoutez d'abord une page"); return; }
    const hasTxt = d.pages.every(p => p.ocr);
    sheet(`<h3>Partager</h3><div class="col">
      <button class="btn y opt" data-pdf="standard"><span class="ic">📄</span><span>PDF standard<small>Bonne qualité, taille raisonnable</small></span></button>
      <button class="btn opt" data-pdf="compact"><span class="ic">📦</span><span>PDF léger<small>Pour l'envoyer facilement par e-mail</small></span></button>
      <button class="btn opt" data-pdf="haute"><span class="ic">💎</span><span>PDF haute qualité<small>Pour imprimer</small></span></button>
      <button class="btn opt" id="sTxt"><span class="ic">🔤</span><span>${hasTxt ? "Texte du document" : "PDF + texte cherchable"}<small>${hasTxt ? "Le PDF contient déjà le texte" : "Reconnaît le texte avant de créer le PDF"}</small></span></button>
      <button class="btn" id="mNo">Fermer</button></div>`);
    $("#mNo").onclick = closeSheet;
    const go = async q => { closeSheet(); await busy(true, "Création du PDF…"); let b; try { b = await makePdf(d.pages, q); } catch (e) { await busy(false); toast("Erreur de création du PDF"); return; } await busy(false); fileReady(fname(d) + ".pdf", b, "PDF"); };
    $$("[data-pdf]").forEach(b => b.onclick = () => go(b.dataset.pdf));
    $("#sTxt").onclick = async () => { closeSheet(); if (hasTxt) { showText(d.name, d.pages.map(p => p.ocr.text).join("\n\n")); return; } if (await ocrPages(d, d.pages)) { renderDoc(); go("standard"); } };
  },
  cancelEdit: () => { const E = S.E; S.E = null; S.editQueue = []; S.idParts = null; if (E && E.isNew && !E.doc.pages.length) { S.docs = S.docs.filter(x => x !== E.doc); ACT.home(); } else { renderDoc(); show("doc"); } },
  auto: async () => { const E = S.E; await busy(true, "Détection…"); const q = await CVD.detect(E.orig); await busy(false); if (q) { E.quad = q; toast("Bords détectés ✓"); } else { E.quad = fullQuad(E.orig, .04); toast("Bords non trouvés : ajustez les coins"); } drawCrop(); },
  full: () => { S.E.quad = fullQuad(S.E.orig); drawCrop(); },
  cropOk: async () => { const E = S.E; const q = orderQuad(E.quad); if (!isConvex(q) || area(q) < 200) { toast("Forme invalide : replacez les coins"); return; } E.quad = q; await busy(true, "Redressement…"); buildPreview(); await busy(false); $("#saveBtn").textContent = E.idPart === 0 ? "Suivant : verso →" : "✓ Enregistrer"; show("filter"); },
  backCrop: () => show("crop"),
  rotL: () => { const E = S.E; E.rot = (E.rot + 3) % 4; E.prevBase = rotateCanvas(E.prevBase, 3); drawPreview(true); },
  rotR: () => { const E = S.E; E.rot = (E.rot + 1) % 4; E.prevBase = rotateCanvas(E.prevBase, 1); drawPreview(true); },
  adjToggle: () => { $("#adj").classList.toggle("on"); $("#adjBtn").classList.toggle("y"); },
  savePage: async () => {
    const E = S.E; await busy(true, "Amélioration de la page…");
    try {
      if (E.idPart == null) lsSet("hs-filter", E.filter);
      if (E.idPart != null) {
        const base = rotateCanvas(warp(E.orig, E.quad, 1600), E.rot); S.idParts.push(applyFilter(base, E.filter, E.adj));
        if (S.editQueue.length) { await busy(false); S.E = null; nextEdit(); return; }
        const comp = await composeId(S.idParts); S.idParts = null;
        await addAutoPageFixed(E.doc, comp);
      } else {
        const p = E.isNew ? { id: uid() } : E.page; const geomChanged = E.isNew || JSON.stringify(p.quad) !== JSON.stringify(E.quad) || p.rot !== E.rot;
        p.quad = E.quad; p.rot = E.rot; p.filter = E.filter; p.adj = E.adj;
        if (E.isNew) p.orig = await toBlob(E.orig, .92);
        if (geomChanged || true) p.ocr = null;
        await renderPage(p, E.orig); if (E.isNew) E.doc.pages.push(p);
      }
      await dbPut(E.doc);
    } catch (e) { console.error(e); toast("Erreur d'enregistrement"); }
    await busy(false); S.E = null; renderDoc(); show("doc");
    if (S.editQueue.length) nextEdit();
  },
  signCancel: () => { SG = null; renderDoc(); show("doc"); },
  signRedo: () => { const g = SG; signaturePad(url => { g.sig = url; $("#signImgEl").src = url; $("#signImgEl").onload = placeSig; }); },
  signRemove: async () => { const g = SG; g.p.sig = null; await busy(true, "Mise à jour…"); await rerender(g.p); await dbPut(g.doc); await busy(false); SG = null; renderDoc(); show("doc"); toast("Signature retirée"); },
  signOk: async () => { const g = SG; g.p.sig = { img: g.sig, x: g.x, y: g.y, w: g.w }; await busy(true, "Ajout de la signature…"); await rerender(g.p); await dbPut(g.doc); await busy(false); SG = null; renderDoc(); show("doc"); toast("Document signé ✓"); }
};
async function addAutoPageFixed(doc, canvas) {
  const p = { id: uid(), quad: fullQuad(canvas), rot: 0, filter: "orig", adj: { b: 0, c: 0, s: 0 }, kind: "id" };
  p.orig = await toBlob(canvas, .92); await renderPage(p, canvas); doc.pages.push(p); return p;
}
function pageMenu(i) {
  const d = S.cur, p = d.pages[i];
  sheet(`<h3>Page ${i + 1}</h3><div class="col">
    <button class="btn y opt" id="pgEdit"><span class="ic">✂️</span><span>Recadrer et améliorer</span></button>
    <button class="btn opt" id="pgSign"><span class="ic">✍️</span><span>${p.sig ? "Modifier la signature" : "Signer la page"}</span></button>
    <button class="btn opt" id="pgTxt"><span class="ic">🔤</span><span>Texte de la page<small>${p.ocr ? "Déjà reconnu" : "Reconnaître et copier le texte"}</small></span></button>
    <button class="btn opt" id="pgRot"><span class="ic">↻</span><span>Pivoter</span></button>
    <button class="btn red opt" id="pgDel"><span class="ic">🗑</span><span>Supprimer la page</span></button>
    <button class="btn" id="mNo">Fermer</button></div>`);
  $("#mNo").onclick = closeSheet;
  $("#pgEdit").onclick = async () => { closeSheet(); await busy(true, "Ouverture…"); try { const c = await origCanvas(p); await busy(false); startEdit({ doc: d, orig: c, page: p, idx: i }); } catch (e) { await busy(false); toast("Page illisible"); } };
  $("#pgSign").onclick = () => { closeSheet(); startSign(d, i); };
  $("#pgTxt").onclick = async () => { closeSheet(); if (await ocrPages(d, [p])) { renderDoc(); showText("Page " + (i + 1), p.ocr.text || "(aucun texte trouvé)"); } };
  $("#pgRot").onclick = async () => { closeSheet(); await busy(true, "Rotation…"); p.rot = ((p.rot || 0) + 1) % 4; p.ocr = null; await rerender(p); await dbPut(d); await busy(false); renderDoc(); };
  $("#pgDel").onclick = async () => { closeSheet(); if (await confirmBox("Supprimer la page ?", "La page " + (i + 1) + " sera retirée du document.", "Supprimer")) { d.pages.splice(i, 1); await dbPut(d); renderDoc(); } };
}
document.addEventListener("click", async e => {
  const a = e.target.closest("[data-act]"); if (a) { ACT[a.dataset.act] && ACT[a.dataset.act](); return; }
  const f = e.target.closest("[data-filter]"); if (f && S.E) { S.E.filter = f.dataset.filter; drawPreview(true); return; }
  const o = e.target.closest("[data-open]"); if (o) { S.cur = S.docs.find(d => d.id === o.dataset.open); renderDoc(); show("doc"); return; }
  const m = e.target.closest("[data-mv]"); if (m && S.cur) { const i = +m.dataset.mv, j = i + (+m.dataset.dir), P = S.cur.pages; if (j < 0 || j >= P.length) return; [P[i], P[j]] = [P[j], P[i]]; await dbPut(S.cur); renderDoc(); return; }
  const pg = e.target.closest("[data-page]"); if (pg && S.cur) { pageMenu(+pg.dataset.page); }
});

/* ============ démarrage ============ */
CVD.start();
(async () => { S.docs = (await dbAll()).filter(d => d && Array.isArray(d.pages)); renderHome(); })();
