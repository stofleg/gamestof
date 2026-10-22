//  Découpage d'une grille 15×15 en pièces de Tetris (tétrominos, plus quelques
//  pièces de 1 à 3 cases quand rien d'autre ne rentre), dans un ordre de chute
//  qui permet de les faire tomber une à une à leur place : une pièce ne vient
//  qu'une fois posées toutes celles qui se trouvent sous elle, et avant toutes
//  celles qui se trouvent au-dessus.
const N = 15;

const norm = cs => {
  const r0 = Math.min(...cs.map(x => x[0])), c0 = Math.min(...cs.map(x => x[1]));
  return cs.map(([r, c]) => [r - r0, c - c0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
};
export const tourne = cs => {               // quart de tour horaire
  const h = Math.max(...cs.map(x => x[0]));
  return cs.map(([r, c]) => [c, h - r]);
};
function orientations(base) {
  const vues = new Map();
  let cs = base;
  for (let k = 0; k < 4; k++) { const n = norm(cs); vues.set(JSON.stringify(n), n); cs = tourne(cs); }
  return [...vues.values()];
}
const TETRO = ["I", "O", "T", "S", "Z", "J", "L"].map(n => ({
  I: [[0,0],[0,1],[0,2],[0,3]], O: [[0,0],[0,1],[1,0],[1,1]], T: [[0,0],[0,1],[0,2],[1,1]],
  S: [[0,1],[0,2],[1,0],[1,1]], Z: [[0,0],[0,1],[1,1],[1,2]], J: [[0,0],[1,0],[1,1],[1,2]],
  L: [[0,2],[1,0],[1,1],[1,2]] }[n])).flatMap(orientations);
const PETITES = [
  ...orientations([[0,0],[0,1],[0,2]]), ...orientations([[0,0],[1,0],[1,1]]),
  ...orientations([[0,0],[0,1]]), [[0,0]] ];

const hasard = a => a[Math.floor(Math.random() * a.length)];
const melange = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Un pavage aléatoire : chaque case vide (de bas en haut) reçoit une pièce
 *  dont elle est la case « d'ancrage » (la dernière en ordre de lecture). */
function pave() {
  const id = Array.from({ length: N }, () => Array(N).fill(-1));
  const pieces = [];
  for (let r = N - 1; r >= 0; r--) for (let c = N - 1; c >= 0; c--) {
    if (id[r][c] !== -1) continue;
    let pose = null;
    for (const lot of [TETRO, PETITES]) {
      for (const f of melange([...lot])) {
        const [ar, ac] = f[f.length - 1];
        const cs = f.map(([y, x]) => [r - ar + y, c - ac + x]);
        if (cs.every(([y, x]) => y >= 0 && y < N && x >= 0 && x < N && id[y][x] === -1)) { pose = cs; break; }
      }
      if (pose) break;
    }
    for (const [y, x] of pose) id[y][x] = pieces.length;
    pieces.push(pose);
  }
  return { id, pieces };
}

/** Ordre de chute (tri topologique) ou null s'il y a un cycle. */
function ordre({ id, pieces }) {
  const avant = pieces.map(() => new Set());     // avant[b] : pièces à poser avant b
  for (let c = 0; c < N; c++) for (let r = 0; r < N - 1; r++)
    for (let s = r + 1; s < N; s++) if (id[s][c] !== id[r][c]) avant[id[r][c]].add(id[s][c]);
  const reste = new Set(pieces.keys()), out = [];
  while (reste.size) {
    const prets = [...reste].filter(p => [...avant[p]].every(q => !reste.has(q)));
    if (!prets.length) return null;
    // la plus basse d'abord (le haut de pile reste régulier), un peu de hasard
    const haut = q => Math.min(...pieces[q].map(x => x[0]));
    const p = prets.sort((a, b) => haut(b) - haut(a) + (Math.random() - .5) * 3)[0];
    out.push(p); reste.delete(p);
  }
  return out;
}

export function decoupeTetris(essais = 500) {
  let meilleur = null;
  for (let k = 0; k < essais; k++) {
    const t = pave(), o = ordre(t);
    if (!o) continue;
    const petites = t.pieces.filter(p => p.length < 4).length;
    if (!meilleur || petites < meilleur.petites) meilleur = { petites, pieces: o.map(i => t.pieces[i]) };
    if (petites <= 6) break;
  }
  return meilleur && meilleur.pieces;
}
