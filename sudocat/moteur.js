/* =========================================================================
   Sudocat / Sudodog — moteur (aucune dépendance, aucun DOM)

   Règle : grille N×N découpée en N zones de couleur (formes libres, cases
   contiguës). Placer N chats : un seul par ligne, par colonne et par zone, et
   deux chats ne se touchent jamais, même en diagonale.
   Les cases sont numérotées i = ligne × N + colonne.
   ========================================================================= */

/* ---------- Aléatoire reproductible (même graine = même grille) ---------- */
function makeRng(seed) {
  let a = seed >>> 0 || 0x9e3779b9;
  return function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledCopy(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const range = (n) => Array.from({ length: n }, (_, i) => i);

const MIN_SIZE = 4;   // en dessous, impossible de placer les chats sans contact
const MAX_SIZE = 12;   // 13-14 possibles mais jusqu'à 25 s pour un difficile

/* Paliers de raisonnement mesurés par le solveur « humain » :
     1  seule case possible dans une ligne, une colonne ou une zone
     2  confinement : les cases possibles d'une zone tiennent dans une ligne (etc.)
     3  blocage : une case dont le chat viderait toute une zone (ou ligne)
     4  groupe de 2 zones confinées dans 2 lignes (ou l'inverse)
     5  groupe de 3 ou 4
     6  au-delà : le solveur ne conclut pas sans essai
   Chaque niveau vise un palier ; les niveaux 1 et 2 diffèrent par les chats donnés. */
const LEVELS = {
  1: { id: 'facile', label: 'Facile', tier: 1, detail: 'chats donnés en plus, seule case possible' },
  2: { id: 'facile-plus', label: 'Facile +', tier: 1, detail: 'le minimum de chats donnés, seule case possible' },
  3: { id: 'moyen', label: 'Moyen', tier: 2, detail: 'zone confinée dans une ligne' },
  4: { id: 'moyen-plus', label: 'Moyen +', tier: 3, detail: 'case qui bloquerait une zone entière' },
  5: { id: 'difficile', label: 'Difficile', tier: 4, detail: 'groupe de 2 zones confinées' },
  6: { id: 'difficile-plus', label: 'Difficile +', tier: 5, detail: 'groupe de 3 ou 4 zones confinées' },
};
const MAX_LEVEL = 6;

/* Fourchette de tailles du mode « taille aléatoire » d'un lot, par niveau (à ajuster ici). */
const SIZE_RANGES = { 1: [5, 6], 2: [6, 7], 3: [7, 8], 4: [8, 9], 5: [9, 10], 6: [10, 12] };

/**
 * Taille tirée au hasard dans la fourchette du niveau. Elle ne dépend que de la graine
 * (tirage séparé de celui de la grille) : la même graine redonne la même taille.
 */
function randomSizeFor(level, seed) {
  const [lo, hi] = SIZE_RANGES[level];
  const r = makeRng(Math.imul((seed >>> 0) ^ 0x5bd1e995, 2654435761) >>> 0)();
  return lo + Math.floor(r * (hi - lo + 1));
}
const BEYOND = 6;   // palier « au-delà »

const TECHNIQUE_LABELS = {
  'unique-case': 'Seule case possible (ligne, colonne ou zone)',
  'confinement': 'Zone ou ligne confinée',
  'blocage': 'Case qui bloquerait tout',
  'groupe-2': 'Groupe de 2 zones confinées',
  'groupe-3': 'Groupe de 3 zones confinées',
  'groupe-4': 'Groupe de 4 zones confinées',
};

/** Niveau (1..6) qui correspond à un palier ; 7 = au-delà de Difficile +. */
function levelOfTier(tier) {
  if (tier >= BEYOND) return 7;
  if (tier === 1) return 2;
  return { 2: 3, 3: 4, 4: 5, 5: 6 }[tier];
}

/* ---------- Voisinages ---------- */
function neighbors4(i, n) {
  const r = Math.floor(i / n), c = i % n, out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}
function neighbors8(i, n) {
  const r = Math.floor(i / n), c = i % n, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
  }
  return out;
}

/* ---------- Placement des chats (la solution) ---------- */
/** cols[r] = colonne du chat de la ligne r ; deux lignes voisines s'écartent d'au moins 2 colonnes. */
function randomPlacement(n, rng) {
  const cols = new Array(n), used = new Array(n).fill(false);
  function rec(r) {
    if (r === n) return true;
    for (const c of shuffledCopy(range(n), rng)) {
      if (used[c] || (r > 0 && Math.abs(cols[r - 1] - c) <= 1)) continue;
      cols[r] = c; used[c] = true;
      if (rec(r + 1)) return true;
      used[c] = false;
    }
    return false;
  }
  return rec(0) ? cols : null;
}

/* ---------- Zones ---------- */
/**
 * Fait pousser une zone autour de chaque chat (zone k = celle du chat de la ligne k),
 * case par case, en privilégiant les zones les plus petites pour équilibrer les tailles.
 */
function growRegions(n, cols, rng) {
  const region = new Array(n * n).fill(-1);
  const sizes = new Array(n).fill(1);
  for (let k = 0; k < n; k++) region[k * n + cols[k]] = k;
  let left = n * n - n;
  while (left > 0) {
    // Tirage pondéré : une petite zone a plus de chances de grandir.
    const open = [];
    for (let k = 0; k < n; k++) {
      const front = [];
      for (let i = 0; i < n * n; i++) if (region[i] === k)
        for (const j of neighbors4(i, n)) if (region[j] === -1) front.push(j);
      if (front.length) open.push({ k, front });
    }
    let total = 0;
    const w = open.map((o) => { const x = 1 / (sizes[o.k] * sizes[o.k]); total += x; return x; });
    let pick = rng() * total, idx = 0;
    while (idx < open.length - 1 && pick >= w[idx]) { pick -= w[idx]; idx++; }
    const { k, front } = open[idx];
    const cell = front[Math.floor(rng() * front.length)];
    region[cell] = k; sizes[k]++; left--;
  }
  return region;
}

/** La zone k reste-t-elle d'un seul tenant si on lui retire la case `without` ? */
function regionConnected(region, n, k, without = -1) {
  const cells = [];
  for (let i = 0; i < n * n; i++) if (region[i] === k && i !== without) cells.push(i);
  if (!cells.length) return false;
  const seen = new Set([cells[0]]), stack = [cells[0]];
  while (stack.length) {
    const i = stack.pop();
    for (const j of neighbors4(i, n)) if (j !== without && region[j] === k && !seen.has(j)) { seen.add(j); stack.push(j); }
  }
  return seen.size === cells.length;
}

/* ---------- Solveur exhaustif ---------- */
/**
 * Cherche les placements valides (jusqu'à `limit`). givens : cases imposées.
 * Renvoie { count, solutions } ; une solution = tableau cols[r].
 */
function solveAll(region, n, limit = 2, givens = []) {
  const forced = new Array(n).fill(-1);
  for (const i of givens) forced[Math.floor(i / n)] = i % n;
  // regRow[k][r] : colonnes de la ligne r qui appartiennent à la zone k (masque).
  const regRow = range(n).map(() => new Array(n).fill(0));
  for (let i = 0; i < n * n; i++) regRow[region[i]][Math.floor(i / n)] |= 1 << (i % n);
  const cols = new Array(n), solutions = [];
  let count = 0;
  // Élagage : chaque zone sans chat doit garder une case libre dans les lignes restantes.
  function viable(r, colMask, regMask) {
    const near = r > 0 ? (7 << cols[r - 1]) >> 1 : 0;
    for (let k = 0; k < n; k++) {
      if (regMask & (1 << k)) continue;
      let ok = (regRow[k][r] & ~colMask & ~near) !== 0;
      for (let rr = r + 1; !ok && rr < n; rr++) ok = (regRow[k][rr] & ~colMask) !== 0;
      if (!ok) return false;
    }
    return true;
  }
  function rec(r, colMask, regMask) {
    if (count >= limit) return;
    if (r === n) { count++; if (solutions.length < limit) solutions.push(cols.slice()); return; }
    if (!viable(r, colMask, regMask)) return;
    for (let c = 0; c < n; c++) {
      if (forced[r] >= 0 && c !== forced[r]) continue;
      if (colMask & (1 << c)) continue;
      if (r > 0 && Math.abs(cols[r - 1] - c) <= 1) continue;
      const k = region[r * n + c];
      if (regMask & (1 << k)) continue;
      cols[r] = c;
      rec(r + 1, colMask | (1 << c), regMask | (1 << k));
      if (count >= limit) return;
    }
  }
  rec(0, 0, 0);
  return { count, solutions };
}

/**
 * Retouche les zones jusqu'à ce que la solution `cols` soit la seule.
 * On prend une autre solution, on choisit une de ses cases (qui n'est pas un chat
 * de la vraie solution) et on la donne à une zone voisine : cette autre solution
 * devient invalide. On garde la retouche si elle n'augmente pas le nombre de solutions.
 */
function makeUnique(region, n, cols, rng, maxSteps = 4000) {
  const isCat = new Set(range(n).map((r) => r * n + cols[r]));
  const CAP = 10;
  let cur = solveAll(region, n, CAP);
  for (let step = 0; step < maxSteps && cur.count > 1; step++) {
    const others = cur.solutions.filter((s) => s.some((c, r) => c !== cols[r]));
    const alt = others[Math.floor(rng() * others.length)];
    const moves = [];
    for (let r = 0; r < n; r++) {
      const x = r * n + alt[r];
      if (alt[r] === cols[r] || isCat.has(x)) continue;
      const from = region[x];
      if (!regionConnected(region, n, from, x)) continue;
      for (const y of neighbors4(x, n)) if (region[y] !== from) moves.push([x, region[y]]);
    }
    if (!moves.length) {
      // Repli : une case de bordure quelconque.
      for (let x = 0; x < n * n; x++) {
        if (isCat.has(x)) continue;
        for (const y of neighbors4(x, n)) if (region[y] !== region[x]) moves.push([x, region[y]]);
      }
    }
    const [x, to] = moves[Math.floor(rng() * moves.length)];
    const from = region[x];
    if (!regionConnected(region, n, from, x)) continue;
    region[x] = to;
    const next = solveAll(region, n, CAP);
    if (next.count <= cur.count || rng() < 0.05) cur = next;
    else region[x] = from;
  }
  return cur.count === 1;
}

/* ---------- Solveur « humain » : sert à noter la difficulté ---------- */
/**
 * Résout par déductions, toujours avec la technique la plus simple possible.
 * maxTier limite les paliers permis (voir LEVELS). Renvoie { solved, level, used } :
 * level = palier le plus élevé qu'il a fallu employer.
 */
function humanSolve(region, n, givens = [], maxTier = 5) {
  const N = n * n;
  const cand = new Array(N).fill(true);
  const cat = new Array(N).fill(false);
  const units = [];               // { type, cells, done }
  for (let r = 0; r < n; r++) units.push({ type: 'row', cells: range(n).map((c) => r * n + c) });
  for (let c = 0; c < n; c++) units.push({ type: 'col', cells: range(n).map((r) => r * n + c) });
  for (let k = 0; k < n; k++) units.push({ type: 'reg', cells: range(N).filter((i) => region[i] === k) });
  const unitsOf = range(N).map((i) => [Math.floor(i / n), n + (i % n), 2 * n + region[i]]);
  const n8 = range(N).map((i) => neighbors8(i, n));
  let level = 1, broken = false, placed = 0;
  const used = {};
  const note = (t, lv) => { used[t] = (used[t] || 0) + 1; if (lv > level) level = lv; };

  // Cases éliminées si l'on posait un chat en i.
  function shadow(i) {
    const s = new Set(n8[i]);
    for (const u of unitsOf[i]) for (const j of units[u].cells) s.add(j);
    s.delete(i);
    return s;
  }
  function place(i) {
    if (!cand[i]) { broken = true; return; }
    cat[i] = true; cand[i] = false; placed++;
    for (const j of shadow(i)) { if (cat[j]) broken = true; cand[j] = false; }
    for (const u of unitsOf[i]) units[u].done = true;
  }
  const open = (u) => units[u].cells.filter((i) => cand[i]);

  for (const g of givens) place(g);

  function single() {
    for (let u = 0; u < units.length; u++) {
      if (units[u].done) continue;
      const o = open(u);
      if (o.length === 0) { broken = true; return false; }
      if (o.length === 1) { place(o[0]); note('unique-case', 1); return true; }
    }
    return false;
  }
  function confinement() {
    for (let u = 0; u < units.length; u++) {
      if (units[u].done) continue;
      const o = open(u);
      // Unités communes à toutes les cases possibles de u.
      for (const v of unitsOf[o[0]]) {
        if (v === u || !o.every((i) => unitsOf[i].includes(v))) continue;
        let changed = false;
        for (const j of units[v].cells) if (cand[j] && !o.includes(j)) { cand[j] = false; changed = true; }
        if (changed) { note('confinement', 2); return true; }
      }
    }
    return false;
  }
  function blocking() {
    for (let i = 0; i < N; i++) {
      if (!cand[i]) continue;
      const s = shadow(i);
      for (let u = 0; u < units.length; u++) {
        if (units[u].done || unitsOf[i].includes(u)) continue;
        if (open(u).every((j) => s.has(j))) { cand[i] = false; note('blocage', 3); return true; }
      }
    }
    return false;
  }
  function groups(kMin, kMax) {
    // k zones dont les cases possibles tiennent dans k lignes (ou colonnes) :
    // ces lignes ne peuvent recevoir de chat que de ces zones. Et l'inverse.
    // Les petits groupes d'abord : un groupe de 2 est plus facile à voir qu'un de 3.
    const families = [[0, 2 * n], [n, 2 * n], [2 * n, 0], [2 * n, n]]; // [lignes testées, unités hôtes]
    for (let k = kMin; k <= kMax; k++) for (const [base, host] of families) {
      const lines = range(n).map((x) => host + x).filter((u) => !units[u].done);
      const L = lines.length;
      // Un groupe de k lignes a pour complément un groupe de L − k lignes :
      // il suffit donc de chercher jusqu'à k = L / 2 (et au plus 4 : au-delà, la
      // déduction n'est plus raisonnable pour un joueur).
      if (L < 3 || k > L / 2) continue;
      for (let mask = 1; mask < (1 << L) - 1; mask++) {
        if (popcount(mask) !== k) continue;
        const chosen = lines.filter((_, b) => mask & (1 << b));
        const inside = [];
        for (let x = 0; x < n; x++) {
          const u = base + x;
          if (units[u].done) continue;
          const o = open(u);
          if (o.every((i) => chosen.some((h) => unitsOf[i].includes(h)))) inside.push(u);
        }
        if (inside.length !== k) continue;
        let changed = false;
        for (const h of chosen) for (const j of units[h].cells)
          if (cand[j] && !inside.some((u) => unitsOf[j].includes(u))) { cand[j] = false; changed = true; }
        if (changed) { note('groupe-' + k, k === 2 ? 4 : 5); return true; }
      }
    }
    return false;
  }

  const steps = [[1, single], [2, confinement], [3, blocking], [4, () => groups(2, 2)], [5, () => groups(3, 4)]]
    .filter(([lv]) => lv <= maxTier);
  while (!broken && placed < n) {
    let progressed = false;
    for (const [, fn] of steps) { if (fn()) { progressed = true; break; } if (broken) break; }
    if (!progressed) break;
  }
  const solved = !broken && placed === n;
  return { solved, level: solved ? level : null, used };
}

function popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }

/* ---------- Génération ---------- */
/** Chats donnés pour que la grille se résolve au palier `maxLevel` (le moins possible). */
function chooseGivens(region, n, cols, maxLevel, rng) {
  const cats = shuffledCopy(range(n).map((r) => r * n + cols[r]), rng);
  const givens = [];
  for (const c of cats) {
    if (humanSolve(region, n, givens, maxLevel).solved) break;
    givens.push(c);
  }
  // Élagage : on retire ceux qui ne servent à rien.
  for (const c of givens.slice()) {
    const without = givens.filter((x) => x !== c);
    if (humanSolve(region, n, without, maxLevel).solved) givens.splice(givens.indexOf(c), 1);
  }
  return givens.sort((a, b) => a - b);
}

/**
 * Fabrique une grille à solution unique.
 * opts : size (4..12), level (1..6, voir LEVELS), seed (entier).
 * Renvoie { size, seed, region, solution (cols), givens, tier, level, targetLevel, reached, used, attempts } :
 * tier = palier de raisonnement obtenu, level = niveau correspondant (7 = au-delà).
 * La même configuration redonne toujours la même grille. Le niveau 2 reproduit
 * exactement l'ancien « Facile » (mêmes tirages), pour que ses graines restent valables.
 */
function generatePuzzle(opts) {
  const n = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.floor(Number(opts.size) || 8)));
  const target = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number(opts.level)) || 1));
  const goal = LEVELS[target].tier;
  const seed = Number(opts.seed) >>> 0;
  const rng = makeRng(seed);
  // Difficile + est rare : il lui faut plus d'essais (mesuré : 300 suffisent dès 6×6).
  const maxAttempts = opts.maxAttempts || (target === 6 ? 300 : 40);
  let best = null;

  for (let a = 1; a <= maxAttempts; a++) {
    const cols = randomPlacement(n, rng);
    const region = growRegions(n, cols, rng);
    if (!makeUnique(region, n, cols, rng)) continue;
    // Palier « naturel » de la grille, sans chat donné.
    const free = humanSolve(region, n, [], 5);
    const natural = free.solved ? free.level : BEYOND;
    let givens = [];
    if (goal <= 3 && (natural > goal || goal === 1)) givens = chooseGivens(region, n, cols, goal, rng);
    const res = humanSolve(region, n, givens, 5);
    const tier = res.solved ? res.level : BEYOND;
    const reached = tier === goal;
    const cand = { region, cols, givens, tier, used: res.used, attempts: a, reached };
    const gap = (c) => (c.reached ? 0 : Math.abs(c.tier - goal) + 0.5);
    if (!best || gap(cand) < gap(best)) best = cand;
    if (reached) break;
  }
  if (!best) throw new Error('Impossible de fabriquer une grille ' + n + '×' + n);

  // Niveau 1 : quelques chats donnés de plus que le minimum (environ N/4).
  if (target === 1) {
    const given = new Set(best.givens);
    const others = shuffledCopy(range(n).map((r) => r * n + best.cols[r]).filter((i) => !given.has(i)), rng);
    best.givens = [...best.givens, ...others.slice(0, Math.ceil(n / 4))].sort((x, y) => x - y);
    best.used = humanSolve(best.region, n, best.givens, 5).used;
  }

  const level = best.reached ? target : levelOfTier(best.tier);
  return {
    size: n, seed, region: best.region, solution: best.cols, givens: best.givens,
    tier: best.tier, level, targetLevel: target, reached: best.reached, used: best.used, attempts: best.attempts,
  };
}

/* ---------- Couleurs des zones : voisines aussi différentes que possible ---------- */
// Écarts mesurés dans l'espace OKLab (distance proche de la perception de l'œil).
function hexToOklab(hex) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const r = lin(parseInt(hex.slice(1, 3), 16)), g = lin(parseInt(hex.slice(3, 5), 16)), b = lin(parseInt(hex.slice(5, 7), 16));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * q,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * q,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * q];
}
function colorDistance(h1, h2) {
  const a = hexToOklab(h1), b = hexToOklab(h2);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Paires de zones qui se touchent (par un côté de case). */
function zoneNeighbors(region, n) {
  const pairs = new Set();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const k = region[r * n + c];
    for (const [rr, cc] of [[r + 1, c], [r, c + 1]]) {
      if (rr >= n || cc >= n) continue;
      const q = region[rr * n + cc];
      if (q !== k) pairs.add(k < q ? k * 64 + q : q * 64 + k);
    }
  }
  return [...pairs].map((x) => [Math.floor(x / 64), x % 64]);
}

/**
 * Couleur de chaque zone : colors[k] = indice dans palette. Toutes les zones ont une
 * couleur différente, et l'on maximise l'écart entre zones voisines (d'abord le plus
 * petit écart entre deux voisines, puis l'écart moyen). Le résultat ne dépend que de la
 * forme des zones : la même grille garde toujours les mêmes couleurs.
 */
function zoneColors(region, n, palette) {
  const P = palette.length;
  if (P < n) throw new Error(`Il faut au moins ${n} couleurs (la palette en a ${P}).`);
  const D = palette.map((a) => palette.map((b) => colorDistance(a, b)));
  const adj = zoneNeighbors(region, n);
  const score = (perm) => {
    let min = Infinity, sum = 0;
    for (const [a, b] of adj) { const d = D[perm[a]][perm[b]]; if (d < min) min = d; sum += d; }
    return [min, sum];
  };
  const better = (x, y) => x[0] > y[0] + 1e-9 || (Math.abs(x[0] - y[0]) <= 1e-9 && x[1] > y[1] + 1e-9);
  let h = 2166136261;
  for (const k of region) { h ^= k + 1; h = Math.imul(h, 16777619); }
  const rng = makeRng(h >>> 0);
  let best = null, bestScore = null;
  for (let restart = 0; restart < 30; restart++) {
    const perm = shuffledCopy(range(P), rng);          // perm[0..n-1] : couleurs utilisées
    let cur = score(perm), improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < P; j++) {
        [perm[i], perm[j]] = [perm[j], perm[i]];
        const sc = score(perm);
        if (better(sc, cur)) { cur = sc; improved = true; } else [perm[i], perm[j]] = [perm[j], perm[i]];
      }
    }
    if (!best || better(cur, bestScore)) { best = perm.slice(0, n); bestScore = cur; }
  }
  return best;
}

/* ---------- Images : un animal différent par ligne de la grille ---------- */
/**
 * Indices (dans la liste d'images du thème) de l'animal posé sur chaque ligne :
 * N images toutes différentes, tirées au hasard. Le tirage ne dépend que de la graine
 * (séparé de celui de la grille), donc la même graine redonne les mêmes animaux.
 * Renvoie null si le thème n'a pas assez d'images.
 */
function imageOrder(seed, n, poolSize) {
  if (poolSize < n) return null;
  const rng = makeRng(Math.imul((seed >>> 0) ^ 0x1b873593, 2246822519) >>> 0);
  return shuffledCopy(range(poolSize), rng).slice(0, n);
}

/** Grille en texte : une lettre par zone, « * » sur un chat donné. */
function puzzleToText(p, withSolution = false) {
  const n = p.size, lines = [];
  const given = new Set(p.givens);
  for (let r = 0; r < n; r++) {
    let s = '';
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const letter = String.fromCharCode(65 + p.region[i]);
      s += given.has(i) || (withSolution && p.solution[r] === c) ? letter.toLowerCase() : letter;
    }
    lines.push(s);
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = { makeRng, imageOrder, zoneColors, zoneNeighbors, colorDistance, MIN_SIZE, MAX_SIZE, LEVELS, MAX_LEVEL, SIZE_RANGES, randomSizeFor, TECHNIQUE_LABELS, levelOfTier, randomPlacement, growRegions,
    regionConnected, solveAll, makeUnique, humanSolve, generatePuzzle, puzzleToText };
}
