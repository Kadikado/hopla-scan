/* Hopla Scan — moteur de détection des bords (OpenCV, dans un worker) */
self.Module = {};
let CV = null;
const ready = (async () => {
  importScripts("opencv.js");
  let c = self.cv;
  if (c && typeof c.then === "function" && !c.Mat) c = await c;
  if (c && !c.Mat) await new Promise(r => { c.onRuntimeInitialized = r; });
  CV = c;
  return c;
})();
ready.then(() => postMessage({ type: "ready" })).catch(e => postMessage({ type: "error", msg: String(e) }));

onmessage = async e => {
  const { id, w, h, buf } = e.data;
  let quad = null;
  try {
    const cv = await ready;
    quad = detect(cv, new ImageData(new Uint8ClampedArray(buf), w, h));
  } catch (err) { quad = null; }
  postMessage({ type: "quad", id, quad });
};

function orderQuad(q) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const s = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let k = 0, m = 1e18;
  s.forEach((p, i) => { if (p[0] + p[1] < m) { m = p[0] + p[1]; k = i; } });
  return [0, 1, 2, 3].map(i => s[(i + k) % 4]);
}
function area(q) { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p[0] * n[1] - n[0] * p[1]; } return Math.abs(a) / 2; }
function angleOk(q) {
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) + 1e-9);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    if (ang < 45 || ang > 135) return false;
  }
  return true;
}

function detect(cv, img) {
  const W = img.width, H = img.height, A = W * H;
  const mats = [];
  const M = m => (mats.push(m), m);
  const src = M(cv.matFromImageData(img));
  const gray = M(new cv.Mat());
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const blur = M(new cv.Mat());
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

  // saturation : aide quand la feuille blanche est posée sur une table colorée
  const hsv = M(new cv.Mat()), rgb = M(new cv.Mat());
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  const ch = M(new cv.MatVector()); cv.split(hsv, ch);
  const sat = M(ch.get(1)); const satB = M(new cv.Mat()); cv.GaussianBlur(sat, satB, new cv.Size(5, 5), 0);

  // médiane des niveaux de gris
  const hist = new Array(256).fill(0); const gd = blur.data;
  for (let i = 0; i < gd.length; i++) hist[gd[i]]++;
  let acc = 0, med = 128; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= gd.length / 2) { med = i; break; } }

  const kernel = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
  const kernelBig = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7)));
  let best = null;
  // carte des bords pour vérifier qu'un quadrilatère suit vraiment des contours
  const sup = M(new cv.Mat()), supS = M(new cv.Mat()), supD = M(new cv.Mat());
  cv.Canny(blur, sup, 20, 60); cv.Canny(satB, supS, 15, 45); cv.bitwise_or(sup, supS, sup);
  cv.dilate(sup, supD, kernel, new cv.Point(-1, -1), 2);
  const sd = supD.data;
  function support(q) {
    let hit = 0, n = 0;
    for (let e = 0; e < 4; e++) {
      const a = q[e], b = q[(e + 1) % 4];
      for (let t = 0.04; t <= 0.96; t += 0.023) {
        const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
        if (x <= 2 || y <= 2 || x >= W - 3 || y >= H - 3) continue; // partie coupée par le bord de l'image : ignorée
        n++;
        if (sd[y * W + x]) hit++;
      }
    }
    return n < 40 ? 0 : hit / n;
  }

  function consider(bin) {
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const ca = cv.contourArea(c);
      if (ca < 0.1 * A) { c.delete(); continue; }
      const hull = new cv.Mat(); cv.convexHull(c, hull, false, true);
      const peri = cv.arcLength(hull, true);
      for (const eps of [0.015, 0.025, 0.04, 0.06]) {
        const ap = new cv.Mat(); cv.approxPolyDP(hull, ap, eps * peri, true);
        if (ap.rows === 4 && cv.isContourConvex(ap)) {
          const q = orderQuad([0, 1, 2, 3].map(k => [ap.data32S[k * 2], ap.data32S[k * 2 + 1]]));
          const a = area(q);
          const spt = a > 0.12 * A && a < 0.985 * A && angleOk(q) ? support(q) : 0;
          if (spt > 0.55) {
            const score = a * spt * spt * spt;
            if (!best || score > best.score) best = { q, score };
          }
          ap.delete(); break;
        }
        ap.delete();
      }
      hull.delete(); c.delete();
    }
    contours.delete(); hier.delete();
  }

  const edges = M(new cv.Mat()), tmp = M(new cv.Mat());
  for (const [lo, hi] of [[Math.max(10, 0.5 * med), Math.min(255, 1.2 * med)], [20, 60], [50, 150]]) {
    cv.Canny(blur, edges, lo, hi);
    cv.dilate(edges, tmp, kernel, new cv.Point(-1, -1), 2);
    consider(tmp);
  }
  // seuillage Otsu (feuille claire sur fond foncé) + fermeture morphologique
  const th = M(new cv.Mat());
  cv.threshold(blur, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.morphologyEx(th, tmp, cv.MORPH_CLOSE, kernelBig);
  consider(tmp);
  // saturation inversée (papier peu saturé sur fond coloré)
  cv.threshold(satB, th, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  cv.morphologyEx(th, tmp, cv.MORPH_CLOSE, kernelBig);
  consider(tmp);
  // gradient sur la saturation
  cv.Canny(satB, edges, 20, 60);
  cv.dilate(edges, tmp, kernel, new cv.Point(-1, -1), 2);
  consider(tmp);

  mats.forEach(m => { try { m.delete(); } catch (e) {} });
  return best ? best.q : null;
}
