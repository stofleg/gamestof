//  Découpage d'une grille 15×15 en pièces de puzzle irrégulières (Grille puzzle /
//  Jigsaw). Partagé par le générateur (le découpage d'une partie de tournoi est
//  stocké avec elle, identique pour tous les joueurs) et par la page de jeu.
const N = 15;

const melange = a => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * Croissance de régions : on sème des germes au hasard, puis chaque région
 * s'étend case par case vers une voisine libre, en tirant au sort la région qui
 * grandit (les plus petites d'abord). Les régions trop petites sont fondues dans
 * une voisine. Résultat : 25 à 30 pièces de 5 à 12 cases, aux contours variés.
 * Renvoie les régions sous forme compacte : [[[r, c], …], …] (cases absolues).
 */
export function decoupeRegions(nGermes = 28, tailleMin = 5) {
  const reg = Array.from({ length: N }, () => Array(N).fill(-1));
  const tailles = [];
  const libres = melange([...Array(N * N).keys()]);
  for (let g = 0; g < nGermes; g++) {
    const k = libres[g]; reg[Math.floor(k / N)][k % N] = g; tailles.push(1);
  }
  const voisins = (r, c) => [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([y,x]) => y>=0 && y<N && x>=0 && x<N);
  let restant = N * N - nGermes;
  while (restant > 0) {
    // une région prise au hasard, pondérée vers les plus petites
    const ordre = melange([...tailles.keys()]).sort((a, b) => tailles[a] - tailles[b] + (Math.random() - .5) * 6);
    let grandi = false;
    for (const g of ordre) {
      const bord = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
        if (reg[r][c] === g) for (const [y, x] of voisins(r, c)) if (reg[y][x] === -1) bord.push([y, x]);
      if (!bord.length) continue;
      const [y, x] = bord[Math.floor(Math.random() * bord.length)];
      reg[y][x] = g; tailles[g]++; restant--; grandi = true; break;
    }
    if (!grandi) break;
  }
  // fusion des régions trop petites dans une voisine
  for (let passe = 0; passe < 4; passe++) {
    for (let g = 0; g < tailles.length; g++) {
      if (!tailles[g] || tailles[g] >= tailleMin) continue;
      const autour = new Map();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
        if (reg[r][c] === g) for (const [y, x] of voisins(r, c)) if (reg[y][x] !== g) autour.set(reg[y][x], 1);
      const cible = [...autour.keys()].sort((a, b) => tailles[a] - tailles[b])[0];
      if (cible == null) continue;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (reg[r][c] === g) reg[r][c] = cible;
      tailles[cible] += tailles[g]; tailles[g] = 0;
    }
  }
  const out = [];
  for (let g = 0; g < tailles.length; g++) {
    if (!tailles[g]) continue;
    const cs = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (reg[r][c] === g) cs.push([r, c]);
    out.push(cs);
  }
  return out;
}

/** Pièces jouables (mélangées) : cases relatives à leur coin haut-gauche + place correcte. */
export function piecesDepuisRegions(regions) {
  return melange(regions.map(cs => {
    const r0 = Math.min(...cs.map(x => x[0])), c0 = Math.min(...cs.map(x => x[1]));
    return { cells: cs.map(([r, c]) => [r - r0, c - c0]), r0, c0, pose: null };
  })).map((p, i) => ({ ...p, id: i }));
}
