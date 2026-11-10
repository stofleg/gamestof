// ============================================================
//  Dé à 20 faces (icosaèdre) dessiné en SVG : jeton du tirage complétif sur le chevalet.
//  Projection orthographique, une face bien de face (pointe en haut) ; faces visibles
//  ombrées ; chaque lettre est « collée » sur sa face (transformation affine triangle de
//  référence → face), avec sa valeur en petit en bas à droite, comme sur un jeton.
// ============================================================
import { LETTER_VALUE } from "./engine.js?v=483";
const PHI = (1 + Math.sqrt(5)) / 2;
const V0 = [];
for (const a of [-1, 1]) for (const b of [-PHI, PHI]) { V0.push([0, a, b], [a, b, 0], [b, 0, a]); }
// Faces : triplets de sommets deux à deux à distance 2.
const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const F = [];
for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++)
  if ([d(V0[i], V0[j]), d(V0[j], V0[k]), d(V0[i], V0[k])].every(x => Math.abs(x - 2) < 1e-9)) F.push([i, j, k]);

const rot = (p, ax, ay, az) => {
  let [x, y, z] = p;
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  return [x, y, z];
};
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const n = Math.hypot(...a); return a.map(v => v / n); };

// Lettres : 20 lettres différentes (l'ordre suit les faces).
const LETTRES = "AEMSRBINCTUDLOPGHFVK".split("");   // valeurs variées sur les faces visibles

/** Repère où la face `k` est face à l'observateur, son 1er sommet en haut. */
function deFace(k) {
  const [a, b, c] = F[k].map(i => V0[i]);
  const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  const z = norm(centre), y = norm(sub(a, centre)), x = cross(y, z);
  return p => [p[0] * x[0] + p[1] * x[1] + p[2] * x[2], p[0] * y[0] + p[1] * y[1] + p[2] * y[2], p[0] * z[0] + p[1] * z[1] + p[2] * z[2]];
}

/** `angles` : { ax, ay, az } pour une vue en biais ; par défaut, une face bien de face. */
/** `serre` : cadre ajusté au dé, sans ombre portée (jeton du chevalet, calé comme les autres jetons). */
export function icosaedre({ taille = 200, angles = null, police = "Georgia, 'Times New Roman', serif", id = "ico", serre = false } = {}) {
  const R = taille * 0.47 / Math.hypot(1, PHI);
  const tourne = angles ? (p => rot(p, angles.ax, angles.ay, angles.az)) : deFace(0);
  const V = V0.map(tourne);
  const P = V.map(([x, y]) => [taille / 2 + x * R, taille / 2 - y * R]);
  const L = norm([-0.3, 0.4, 0.87]);   // lumière en haut à gauche, surtout de face
  let faces = F.map((f, idx) => {
    let [a, b, c] = f.map(i => V[i]);
    let n = cross(sub(b, a), sub(c, a));
    const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2] < 0) { n = n.map(v => -v); f = [f[0], f[2], f[1]]; }
    n = norm(n);
    return { f, n, z: centre[2] };
  });
  // lettres les plus courantes sur les faces vues de face, les rares (Q, V…) à l'arrière
  faces.slice().sort((a, b) => b.n[2] - a.n[2]).forEach((o, i) => { o.lettre = LETTRES[i]; });
  faces = faces.filter(o => o.n[2] > 0.02).sort((a, b) => a.z - b.z);

  let svg = "";
  for (const o of faces) {
    const pts = o.f.map(i => P[i]);
    const lum = Math.max(0, o.n[0] * L[0] + o.n[1] * L[1] + o.n[2] * L[2]);
    // teinte des jetons Topissimo (ivoire doré), éclairée selon l'orientation de la face
    const t = 0.55 + 0.45 * lum;
    const col = `rgb(${Math.round(250 * t + 5)},${Math.round(226 * t)},${Math.round(150 * t)})`;
    svg += `<polygon points="${pts.map(p => p.map(v => v.toFixed(2)).join(",")).join(" ")}" fill="${col}" stroke="#7a5a1c" stroke-width="${(taille / 160).toFixed(2)}" stroke-linejoin="round"/>`;
    // Lettre : triangle de référence (sommet en haut) → face ; on choisit la rotation des
    // sommets qui garde la lettre la plus « debout » à l'écran.
    const ref = [[0, -1], [-0.866, 0.5], [0.866, 0.5]];
    let best = null;
    for (let k = 0; k < 3; k++) {
      let q = [pts[k], pts[(k + 1) % 3], pts[(k + 2) % 3]];
      // même sens de parcours que le triangle de référence (sinon la lettre serait en miroir)
      const sens = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
      if (sens > 0) q = [q[0], q[2], q[1]];
      const cx = (q[0][0] + q[1][0] + q[2][0]) / 3, cy = (q[0][1] + q[1][1] + q[2][1]) / 3;
      const s = 0.62;   // lettre dans le tiers central de la face
      const p0 = [cx + (q[0][0] - cx) * s, cy + (q[0][1] - cy) * s], p1 = [cx + (q[1][0] - cx) * s, cy + (q[1][1] - cy) * s], p2 = [cx + (q[2][0] - cx) * s, cy + (q[2][1] - cy) * s];
      // matrice M telle que M·(r1−r0) = p1−p0 et M·(r2−r0) = p2−p0
      const u1 = sub(ref[1], ref[0]), u2 = sub(ref[2], ref[0]), w1 = sub(p1, p0), w2 = sub(p2, p0);
      const det = u1[0] * u2[1] - u1[1] * u2[0];
      const a = (w1[0] * u2[1] - w2[0] * u1[1]) / det, cc = (w2[0] * u1[0] - w1[0] * u2[0]) / det;
      const b = (w1[1] * u2[1] - w2[1] * u1[1]) / det, dd = (w2[1] * u1[0] - w1[1] * u2[0]) / det;
      const e = p0[0] - (a * ref[0][0] + cc * ref[0][1]), f = p0[1] - (b * ref[0][0] + dd * ref[0][1]);
      const debout = dd / Math.hypot(cc, dd);   // image du vecteur « haut » (0,−1) = (−cc, −dd) : le plus vers le haut
      if (!best || debout > best.debout) best = { debout, m: [a, b, cc, dd, e, f] };
    }
    const op = (0.35 + 0.65 * Math.min(1, o.n[2] * 1.4)).toFixed(2);   // lettres des faces rasantes plus pâles
    const m = `matrix(${best.m.map(v => v.toFixed(4)).join(" ")})`;
    svg += `<text transform="${m}" x="-0.08" y="0.42" font-family="${police}" font-weight="700" font-size="1.2" text-anchor="middle" fill="#2b1d06" fill-opacity="${op}">${o.lettre}</text>`
      + `<text transform="${m}" x="0.5" y="0.62" font-family="Inter, Arial, sans-serif" font-weight="700" font-size="0.42" text-anchor="middle" fill="#2b1d06" fill-opacity="${op}">${LETTER_VALUE[o.lettre]}</text>`;
  }
  const label = 'role="img" aria-label="Dé du tirage complétif : ajoute la lettre de ton choix"';
  if (serre) {
    // cadre = contour du dé (+ demi-trait), sans marge ni ombre
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]), m = taille / 160;
    const x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m, w = Math.max(...xs) - x0 + m, h = Math.max(...ys) - y0 + m;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(2)} ${y0.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}" ${label}>${svg}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${taille} ${taille}" width="${taille}" height="${taille}" ${label}>
<defs><radialGradient id="${id}-ombre" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="${taille * 0.53}" cy="${taille * 0.93}" rx="${taille * 0.36}" ry="${taille * 0.06}" fill="url(#${id}-ombre)"/>
${svg}</svg>`;
}
