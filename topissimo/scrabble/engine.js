// ============================================================
//  Scrabble — moteur de base (lettres, plateau, score)
//  Convention : lettres en majuscules, sans accents.
//  Le joker est représenté par "?".
// ============================================================

// Valeurs des lettres (Scrabble francophone)
export const LETTER_VALUE = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 10, L: 1, M: 2, N: 1, O: 1, P: 3, Q: 8, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 10, X: 10, Y: 10, Z: 10, "?": 0,
};

// Distribution officielle (102 tuiles)
export const LETTER_BAG = {
  A: 9, B: 2, C: 2, D: 3, E: 15, F: 2, G: 2, H: 2, I: 8, J: 1,
  K: 1, L: 5, M: 3, N: 6, O: 6, P: 2, Q: 1, R: 6, S: 6, T: 6,
  U: 6, V: 2, W: 1, X: 1, Y: 1, Z: 1, "?": 2,
};

// ----- Mode « À l'anglaise » : distribution et valeurs du Scrabble anglais -----
export const LETTER_VALUE_EN = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, "?": 0,
};
export const LETTER_BAG_EN = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1,
  K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, "?": 2,
};

// Table de valeurs ACTIVE (le scoring s'y réfère). On la bascule sur l'anglaise
// pour le mode « À l'anglaise », française sinon. Binding vivant : les modules qui
// importent `letterValue` voient la mise à jour.
let _activeValues = LETTER_VALUE;
export function setLetterValues(table) { _activeValues = table || LETTER_VALUE; }
export function letterValue(l) { return _activeValues[l] || 0; }
// Sac / valeurs selon la formule.
export function bagFor(modeKey) { return (GAME_MODES[modeKey] && GAME_MODES[modeKey].english) ? LETTER_BAG_EN : LETTER_BAG; }
export function valuesFor(modeKey) { return (GAME_MODES[modeKey] && GAME_MODES[modeKey].english) ? LETTER_VALUE_EN : LETTER_VALUE; }

export const VOWELS = new Set(["A", "E", "I", "O", "U", "Y"]);

// ============================================================
//  Modes de jeu (formules originales FFSC)
// ============================================================
export const GAME_MODES = {
  duplicate: { label: "Normal",    rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 }, defaultTime: 120 },
  blitz:     { label: "Blitz",     rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 }, defaultTime: 60 },
  "7sur8":   { label: "7 sur 8",   rackSize: 8, maxPlayed: 7, bonuses: { 7: 50 },              defaultTime: 120 },
  "7et8":    { label: "7 et 8",    rackSize: 8, maxPlayed: 8, bonuses: { 7: 50, 8: 75 },       defaultTime: 120 },
  "789":     { label: "7, 8 et 9", rackSize: 9, maxPlayed: 9, bonuses: { 7: 50, 8: 75, 9: 100 }, defaultTime: 120 },
  // ----- Formules « superoriginales » (génération de tournoi réservée à l'admin) -----
  // 6 lettres : duplicate à 6 jetons, jamais de prime de scrabble.
  "6lettres":  { label: "6 lettres",  rackSize: 6,  maxPlayed: 6,  bonuses: {}, defaultTime: 120, stofOnly: true },
  // Hyperblitz : blitz à 30 s/coup.
  hyperblitz:  { label: "Hyperblitz", rackSize: 7,  maxPlayed: 7,  bonuses: { 7: 50 }, defaultTime: 30, stofOnly: true },
  // 7 sur 15 : tirage de 15, max 7 jouées (sur le modèle 7 sur 8). Min 4 voyelles.
  "7sur15": { label: "7 sur 15", rackSize: 15, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 240, minVowels: 4, stofOnly: true },
  // 15 lettres : tirage de 15, prime dès 7 jouées (+25 par jeton au-delà), min 4 voyelles.
  // CONSERVÉE pour une future généralisation (jouer avec N lettres au choix) mais
  // RETIRÉE des menus pour l'instant (hidden) car jugée trop difficile.
  "15lettres": { label: "15 lettres", rackSize: 15, maxPlayed: 15,
    bonuses: { 7: 50, 8: 75, 9: 100, 10: 125, 11: 150, 12: 175, 13: 200, 14: 225, 15: 250 },
    defaultTime: 240, minVowels: 4, stofOnly: true, hidden: true },
  // Joker payant : partie joker classique, mais le joker vaut les points de la
  // lettre qu'il représente (le top est calculé en testant chaque lettre possible).
  jokerpayant: { label: "Joker payant", rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 120, stofOnly: true, jokerPays: true },
  // Horizontal/Vertical : top horizontal imposé au coup 1, vertical au 2, etc.
  horizvert: { label: "Horizontal/Vertical", rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 120, stofOnly: true, alternateDir: true },
  // Top/sous-top : il faut trouver le top ET le sous-top ; score = top + sous-top.
  topsoustop: { label: "Top/sous-top", rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 180, stofOnly: true, dualTop: true },
  // Double joker infini : 2 jokers + 5 lettres à chaque tirage, jokers laissés sur
  // la grille (non recyclés), fin quand toutes les lettres réelles sont posées.
  infjoker: { label: "Double joker infini", rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 120, stofOnly: true, infJoker: true },
  // Grille random : disposition des bonus mélangée (générée et stockée par partie).
  grillerandom: { label: "Grille random", rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 120, stofOnly: true, randomBoard: true },
  // Snake : chaque coup doit prolonger le serpent (un seul trait continu).
  // RETIRÉE des menus (hidden) — jugée peu intéressante ; code conservé au cas où.
  snake: { label: "Snake", rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 120, stofOnly: true, snake: true, hidden: true },
  // Sablier : partie normale mais chrono DÉCROISSANT — 120 s au coup 1, puis −5 s
  // par coup (plancher 5 s), partie limitée à 24 coups.
  sablier: { label: "Sablier", rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 120, stofOnly: true, sablier: true },
  // Gigogne : le tirage GRANDIT — 2 lettres au coup 1, 3 au coup 2, 4 au coup 3…
  // (coup n → n+1 lettres). On peut jouer autant de lettres qu'on en a. Primes de
  // scrabble progressives : 50 à 7 lettres, +25 par lettre au-delà (75, 100, 125…).
  gigogne: { label: "Gigogne", rackSize: 2, maxPlayed: 15,
    bonuses: { 7: 50, 8: 75, 9: 100, 10: 125, 11: 150, 12: 175, 13: 200, 14: 225, 15: 250 },
    defaultTime: 120, stofOnly: true, gigogne: true },
  // À l'anglaise : règles normales mais distribution + valeurs des lettres du
  // Scrabble anglais (dictionnaire français inchangé).
  anglaise: { label: "À l'anglaise", rackSize: 7, maxPlayed: 7, bonuses: { 7: 50 },
    defaultTime: 120, stofOnly: true, english: true },
};

// Temps imparti pour un coup en mode Sablier : base − 5 s par coup, plancher 5 s.
export function sablierTime(base, moveNo) {
  return Math.max(5, (base || 120) - 5 * ((moveNo || 1) - 1));
}

// Taille du tirage au coup `moveNo` en mode Gigogne (coup n → n+1 lettres).
export function gigogneRackSize(moveNo) {
  return (moveNo || 1) + 1;
}
// Nom affiché en combinant mode + joker
export function modeDisplayName(modeKey, withJoker) {
  const m = GAME_MODES[modeKey] || GAME_MODES.duplicate;
  if (!withJoker) return m.label;
  if (modeKey === "duplicate") return "Joker";
  return `${m.label} joker`;
}
// L'option "joker" est un flag séparé (combinable avec les modes ci-dessus)


// Plateau 15×15 avec bonus.
//  '.' = case normale
//  'd' = lettre doublée (DL)
//  't' = lettre triplée (TL)
//  'D' = mot doublé (DW)
//  'T' = mot triplé (TW)
//  '*' = étoile centrale (= DW)
export const BOARD_BONUSES = [
  "T..d...T...d..T",
  ".D...t...t...D.",
  "..D...d.d...D..",
  "d..D...d...D..d",
  "....D.....D....",
  ".t...t...t...t.",
  "..d...d.d...d..",
  "T..d...*...d..T",
  "..d...d.d...d..",
  ".t...t...t...t.",
  "....D.....D....",
  "d..D...d...D..d",
  "..D...d.d...D..",
  ".D...t...t...D.",
  "T..d...T...d..T",
];
export const BOARD_SIZE = 15;
export const CENTER = 7;

export function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null)
  );
}

// Type d'une case (compte tenu des tuiles déjà posées : si une case a déjà une
// lettre, son bonus n'agit plus). On garde aussi un masque "lockedBonus" mais
// pour simplifier on regarde juste si board[r][c] est null.
export function cellBonus(r, c) {
  return BOARD_BONUSES[r][c];
}

// Mode « Snake » : les cases occupées doivent former un CHEMIN SIMPLE (serpent).
// Vrai si l'ensemble des cases occupées est un chemin : chaque case a ≤ 2 voisines
// orthogonales, exactement 2 extrémités (degré 1), c'est connexe et sans boucle.
export function isSimplePath(board) {
  const N = BOARD_SIZE;
  const occ = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board[r][c]) occ.push([r, c]);
  if (occ.length <= 1) return true;
  const key = (r, c) => r * N + c;
  let deg1 = 0;
  for (const [r, c] of occ) {
    let d = 0;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && board[nr][nc]) d++;
    }
    if (d > 2) return false;       // branche → pas un chemin
    if (d === 0) return false;     // case isolée (≥2 occupées) → pas connexe
    if (d === 1) deg1++;
  }
  if (deg1 !== 2) return false;    // un chemin a exactement 2 extrémités (sinon boucle)
  // Connexité : BFS depuis une extrémité.
  const isEnd = ([r, c]) => {
    let d = 0;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && board[nr][nc]) d++;
    }
    return d === 1;
  };
  const start = occ.find(isEnd);
  const seen = new Set([key(start[0], start[1])]);
  const stack = [start];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc, k = key(nr, nc);
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && board[nr][nc] && !seen.has(k)) { seen.add(k); stack.push([nr, nc]); }
    }
  }
  return seen.size === occ.length;
}

// --- Snake : suivi du serpent par ses 2 extrémités (chemin ordonné) ---
// Les cases du mot principal du coup.
function moveCells(move) {
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const out = [];
  for (let i = 0; i < move.word.length; i++) out.push([move.row + i * dr, move.col + i * dc]);
  return out;
}
const _adj = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

// Vrai si le coup PROLONGE le serpent depuis UNE de ses extrémités : exactement
// une extrémité est « accrochée » (case posée adjacente OU mot passant par elle),
// avec une seule case posée adjacente à cette extrémité (pas de jonction en T).
// Les contacts latéraux avec l'intérieur (= mots croisés) sont permis.
// ends = [[r,c],[r,c]] ou null/vide pour le 1er coup (toujours légal ici).
export function isSnakeMove(board, ends, move) {
  if (!ends || ends.length < 2) return true;
  const cells = moveCells(move);
  const placed = cells.filter(([r, c]) => board[r] && !board[r][c]);
  if (!placed.length) return false;
  let attached = 0;
  for (const E of ends) {
    const adjPlaced = placed.filter(p => _adj(p, E));
    const eInWord = cells.some(([r, c]) => r === E[0] && c === E[1]);
    if (!adjPlaced.length && !eInWord) continue;     // extrémité non connectée
    if (adjPlaced.length > 1) return false;          // 2 cases posées touchent E → jonction en T
    // L'accroche doit se faire à un BOUT du nouveau mot : la case d'entrée (la
    // case posée touchant E, sinon E lui-même) doit être à une extrémité du mot,
    // sinon le mot part dans deux directions depuis l'accroche = branche (impossible
    // à tracer d'un seul trait : cf. PAKOL entré par son milieu).
    const entry = adjPlaced.length ? adjPlaced[0] : E;
    const idx = cells.findIndex(([r, c]) => r === entry[0] && c === entry[1]);
    if (idx !== 0 && idx !== cells.length - 1) return false;
    attached++;
  }
  return attached === 1;
}

// Nouvelles extrémités du serpent après application du coup.
export function snakeEndpointsAfter(ends, board, move) {
  const cells = moveCells(move);
  const placed = cells.filter(([r, c]) => board[r] && !board[r][c]);
  if (!ends || ends.length < 2) return [cells[0], cells[cells.length - 1]];
  const attachedEnds = ends.filter(E => placed.some(p => _adj(p, E)) || cells.some(([r, c]) => r === E[0] && c === E[1]));
  if (attachedEnds.length === 1) {
    const E = attachedEnds[0];
    const other = ends.find(e => e !== E);
    let far = placed[0], best = -1;
    for (const p of placed) { const d = Math.abs(p[0] - E[0]) + Math.abs(p[1] - E[1]); if (d > best) { best = d; far = p; } }
    return [other, far];
  }
  // Extension colinéaire des 2 côtés (coup 2) → extrémités = les 2 cases de degré 1.
  const after = applyMove(board, move);
  const N = BOARD_SIZE, deg1 = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!after[r][c]) continue;
    let d = 0;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < N && nc >= 0 && nc < N && after[nr][nc]) d++; }
    if (d === 1) deg1.push([r, c]);
  }
  return deg1.length === 2 ? deg1 : [cells[0], cells[cells.length - 1]];
}

// Génère une grille de bonus ALÉATOIRE pour le mode « Grille random » :
//  • mêmes effectifs de chaque case spéciale que la grille classique ;
//  • l'étoile reste au centre ;
//  • aucune case spéciale n'est adjacente orthogonalement à une autre (elles ne
//    peuvent se côtoyer qu'en diagonale, comme sur une grille de Scrabble).
// Renvoie un tableau de 15 chaînes (même format que BOARD_BONUSES).
export function randomBoardLayout() {
  const N = BOARD_SIZE, C = CENTER;
  // Effectifs des cases spéciales (l'étoile centrale comptait comme un mot compte
  // double → on la remet dans le pool en tant que "D"). Le centre n'est donc PAS
  // forcément un mot compte double : il reçoit une case quelconque comme les autres
  // (l'étoile de départ est un marqueur d'affichage, géré à part au rendu).
  const types = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const b = BOARD_BONUSES[r][c];
    if (b !== ".") types.push(b === "*" ? "D" : b);
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let attempt = 0; attempt < 600; attempt++) {
    const grid = Array.from({ length: N }, () => Array(N).fill("."));
    const cells = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells.push([r, c]);
    shuffle(cells);
    const free = (r, c) => {
      if (grid[r][c] !== ".") return false;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] !== ".") return false;
      }
      return true;
    };
    let ok = true;
    for (const t of shuffle(types.slice())) {
      let placed = false;
      for (const [r, c] of cells) { if (free(r, c)) { grid[r][c] = t; placed = true; break; } }
      if (!placed) { ok = false; break; }
    }
    if (ok) return grid.map(row => row.join(""));
  }
  return BOARD_BONUSES.slice();   // repli (très improbable) : grille classique
}

// ============================================================
//  Score d'un coup
//  move = {
//    word: "BONJOUR",
//    row, col,            // coordonnées de départ
//    dir: "H" | "V",      // horizontal ou vertical
//    blanks: [index, ...] // positions (dans word) où la lettre est un joker
//  }
//  Retourne un objet { score, words: [{word, score}], errors: [...] }
//  Si errors non vide, le coup est illégal.
// ============================================================

export function scoreMove(board, move, dict, opts = {}) {
  const bonuses = opts.bonuses || { 7: 50 };
  const { word, row, col, dir, blanks = [] } = move;
  const errors = [];
  const dr = dir === "V" ? 1 : 0;
  const dc = dir === "H" ? 1 : 0;
  const len = word.length;

  // 1) Vérifier que les lettres tiennent sur le plateau et matchent les lettres existantes
  const placed = []; // tuiles nouvellement posées
  for (let i = 0; i < len; i++) {
    const r = row + i * dr;
    const c = col + i * dc;
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      errors.push("Mot hors plateau");
      return { score: 0, words: [], errors };
    }
    const existing = board[r][c];
    if (existing) {
      if (existing.letter !== word[i]) {
        errors.push(`Conflit en (${r},${c}) : "${existing.letter}" ≠ "${word[i]}"`);
        return { score: 0, words: [], errors };
      }
    } else {
      placed.push({ r, c, letter: word[i], isBlank: blanks.includes(i) });
    }
  }

  if (placed.length === 0) {
    errors.push("Aucune lettre nouvelle posée");
    return { score: 0, words: [], errors };
  }

  // 2) Vérifier la contiguïté : 1er coup doit passer par le centre,
  //    sinon le mot doit toucher au moins une lettre déjà posée.
  const isFirstMove = board.every(row => row.every(c => !c));
  if (isFirstMove) {
    let passesCenter = false;
    for (let i = 0; i < len; i++) {
      if (row + i * dr === CENTER && col + i * dc === CENTER) passesCenter = true;
    }
    if (!passesCenter) errors.push("Le premier coup doit passer par l'étoile centrale");
  } else {
    // doit toucher une lettre existante (soit le mot principal a une lettre existante,
    // soit l'un des nouveaux placements a un voisin existant)
    const hasExistingInWord = (() => {
      for (let i = 0; i < len; i++) {
        const r = row + i * dr, c = col + i * dc;
        if (board[r][c]) return true;
      }
      return false;
    })();
    const hasAdjacent = placed.some(({ r, c }) =>
      [[1,0],[-1,0],[0,1],[0,-1]].some(([dr2,dc2]) => {
        const nr = r + dr2, nc = c + dc2;
        return nr>=0 && nr<BOARD_SIZE && nc>=0 && nc<BOARD_SIZE && board[nr][nc];
      })
    );
    if (!hasExistingInWord && !hasAdjacent) {
      errors.push("Le mot doit toucher une lettre déjà posée");
    }
  }

  // 3) Construire un plateau "virtuel" qui inclut les tuiles posées,
  //    pour étendre les mots aux deux extrémités et calculer les mots croisés.
  const b = board.map(r => r.slice());
  for (const p of placed) {
    b[p.r][p.c] = { letter: p.letter, isBlank: p.isBlank };
  }

  // 4) Étendre le mot principal aux deux extrémités
  let mainStartR = row, mainStartC = col;
  while (true) {
    const pr = mainStartR - dr, pc = mainStartC - dc;
    if (pr < 0 || pc < 0 || !b[pr][pc]) break;
    mainStartR = pr; mainStartC = pc;
  }
  let mainEndR = row + (len-1)*dr, mainEndC = col + (len-1)*dc;
  while (true) {
    const nr = mainEndR + dr, nc = mainEndC + dc;
    if (nr >= BOARD_SIZE || nc >= BOARD_SIZE || !b[nr][nc]) break;
    mainEndR = nr; mainEndC = nc;
  }

  const collectWord = (sr, sc, ddr, ddc) => {
    const cells = [];
    let r = sr, c = sc;
    while (r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE && b[r][c]) {
      cells.push({ r, c, ...b[r][c] });
      r += ddr; c += ddc;
    }
    return cells;
  };

  const wordsFormed = [];
  const mainCells = collectWord(mainStartR, mainStartC, dr, dc);
  wordsFormed.push({ cells: mainCells, isMain: true });

  // Mots croisés : pour chaque nouvelle lettre, regarder la perpendiculaire
  const pdr = dc, pdc = dr; // perpendiculaire
  for (const p of placed) {
    // trouver début perp
    let sr = p.r, sc = p.c;
    while (true) {
      const pr = sr - pdr, pc = sc - pdc;
      if (pr<0 || pc<0 || pr>=BOARD_SIZE || pc>=BOARD_SIZE || !b[pr][pc]) break;
      sr = pr; sc = pc;
    }
    const cells = collectWord(sr, sc, pdr, pdc);
    if (cells.length > 1) wordsFormed.push({ cells, isMain: false });
  }

  // 5) Validation des mots dans le dictionnaire
  const wordStrings = wordsFormed.map(w => w.cells.map(c => c.letter).join(""));
  // Cases des mots INVALIDES (pour les afficher en rouge : mot principal et/ou
  // mot croisé « en raccord »).
  const invalidCells = [];
  if (dict) {
    for (const w of wordsFormed) {
      const str = w.cells.map(c => c.letter).join("");
      if (!dict.has(str)) {
        errors.push(`"${str}" n'est pas dans le dictionnaire`);
        for (const cell of w.cells) invalidCells.push({ r: cell.r, c: cell.c });
      }
    }
  }

  // En mode `raw` (badge de score progressif), on calcule quand même le total
  // des points malgré une erreur de placement (1er coup pas encore sur le centre,
  // mot pas encore raccordé…) → le score s'affiche au fur et à mesure.
  if (errors.length && !opts.raw) return { score: 0, words: wordStrings, errors, invalidCells };

  // 6) Calcul du score
  const placedSet = new Set(placed.map(p => `${p.r},${p.c}`));
  let totalScore = 0;
  const wordDetails = [];

  for (const { cells } of wordsFormed) {
    let wordScore = 0;
    let wordMult = 1;
    for (const cell of cells) {
      const key = `${cell.r},${cell.c}`;
      const isNew = placedSet.has(key);
      // Joker payant : le joker vaut les points de la lettre représentée UNIQUEMENT
      // au moment où il est posé (jeton nouveau). Une fois sur la grille, un mot qui
      // s'appuie dessus le compte 0 (comme un blanc classique). Sinon : 0 (standard).
      let letterScore = cell.isBlank
        ? ((opts.jokerPays && isNew) ? (_activeValues[cell.letter] || 0) : 0)
        : _activeValues[cell.letter];
      if (isNew) {
        // Grille random : disposition des bonus propre à la partie (opts.layout).
        const b = (opts.layout || BOARD_BONUSES)[cell.r][cell.c];
        if (b === "d") letterScore *= 2;
        else if (b === "t") letterScore *= 3;
        else if (b === "D" || b === "*") wordMult *= 2;
        else if (b === "T") wordMult *= 3;
      }
      wordScore += letterScore;
    }
    wordScore *= wordMult;
    totalScore += wordScore;
    wordDetails.push({ word: cells.map(c => c.letter).join(""), score: wordScore });
  }

  // Bonus scrabble (variable selon mode : 7→50, 8→75, 9→100, etc.)
  if (bonuses[placed.length]) totalScore += bonuses[placed.length];

  return { score: totalScore, words: wordDetails, errors, placed };
}

// Applique un coup au plateau (renvoie un nouveau plateau)
export function applyMove(board, move) {
  const { word, row, col, dir, blanks = [] } = move;
  const dr = dir === "V" ? 1 : 0;
  const dc = dir === "H" ? 1 : 0;
  const b = board.map(r => r.slice());
  for (let i = 0; i < word.length; i++) {
    const r = row + i * dr, c = col + i * dc;
    if (!b[r][c]) b[r][c] = { letter: word[i], isBlank: blanks.includes(i) };
  }
  return b;
}

// ============================================================
//  Tirage en duplicate (règle officielle FFSC)
//   - Coups 1 à 14 : au moins 2 voyelles ET 2 consonnes (sur le rack entier)
//   - Coup 15 et + : au moins 1 voyelle ET 1 consonne
//   - REJET : si le rack complété ne respecte pas la règle, on remet TOUT
//     (reliquat + lettres piochées) dans le sac et on tire un chevalet
//     complet neuf. On répète jusqu'à obtenir un tirage valide.
//   - Les jokers conservés sur le chevalet ne sont jamais remis dans le sac.
//   - Si la règle est impossible à satisfaire (sac vidé d'un type en fin de
//     partie), on relâche progressivement tant que le rack reste jouable.
//
//   Retour : { drawn, bag, fresh, minApplied } ou { drawn:null, failed:true }.
//     - drawn : lettres à AJOUTER au reliquat si fresh === false ;
//               chevalet complet neuf (hors jokers conservés) si fresh === true.
//     - fresh : true UNIQUEMENT en cas de REJET (le reliquat a été remis dans
//               le sac car le rack complété violait la règle). C'est ce cas, et
//               lui seul, qui est affiché « –XXX » sur la feuille de route.
//               Un chevalet vidé par le jeu (reliquat vide) n'est PAS un rejet.
// ============================================================
export function drawForDuplicate(bag, kept, moveNo, target = 7, opts = {}) {
  // Minimum de voyelles paramétrable (mode « 15 lettres » : 4, sinon 2),
  // réduit de 1 à partir du coup 15 (comme la règle FFSC standard 2→1).
  const baseV = opts.minVowels || 2;
  const minV = moveNo >= 15 ? Math.max(1, baseV - 1) : baseV;
  const minC = moveNo >= 15 ? 1 : 2;
  const minVC = minV;   // conservé pour minApplied (compat logs)
  // Règle FFSC du tirage, sensible au numéro de coup :
  //  • jusqu'au coup 14 inclus (min 2/2) : le joker PEUT servir de voyelle ou de
  //    consonne pour atteindre le quota (on l'affecte au type déficitaire) ;
  //  • à partir du coup 15 (min 1/1) : le joker ne compte PLUS — il faut une
  //    vraie voyelle ET une vraie consonne, SAUF si le type manquant est épuisé
  //    dans le sac restant (alors le joker peut s'y substituer).
  const jokerWildcard = moveNo <= 14;
  // Quotas voyelles/consonnes potentiellement différents (mode 15 lettres).
  const rackValid = (rack, remBag, mvV, mvC = mvV) => {
    let v = 0, c = 0, j = 0;
    for (const l of rack) { if (l === "?") j++; else if (VOWELS.has(l)) v++; else c++; }
    if (jokerWildcard) {
      while (j > 0 && (v < mvV || c < mvC)) {
        const dv = mvV - v, dc = mvC - c;
        if (dv >= dc && dv > 0) v++; else if (dc > 0) c++; else break;
        j--;
      }
    } else {
      if (v < mvV && bagTotalVowels(remBag) === 0) { const u = Math.min(j, mvV - v); v += u; j -= u; }
      if (c < mvC && bagTotalConsonants(remBag) === 0) { const u = Math.min(j, mvC - c); c += u; j -= u; }
    }
    return v >= mvV && c >= mvC;
  };

  const realKept = kept.filter(l => l !== "?");
  const jokerCount = kept.length - realKept.length;
  const need = target - kept.length;

  // Rien à piocher : on garde le chevalet tel quel.
  if (need <= 0) {
    return { drawn: [], bag: { ...bag }, fresh: false, minApplied: minVC };
  }

  // Sac vide : on retourne le chevalet tel quel s'il est jouable, sinon échec.
  const bagEmpty = Object.values(bag).every(c => !c);
  if (bagEmpty) {
    if (rackValid(kept, bag, 1)) {
      return { drawn: [], bag: { ...bag }, fresh: false, minApplied: 0 };
    }
    return { drawn: null, bag: { ...bag }, failed: true };
  }

  // Pioche n lettres aléatoires dans une copie du sac.
  const drawN = (srcBag, n) => {
    const trial = { ...srcBag };
    const drawn = [];
    for (let i = 0; i < n; i++) {
      const pool = [];
      for (const [l, c] of Object.entries(trial)) for (let j = 0; j < c; j++) pool.push(l);
      if (!pool.length) break;
      const idx = Math.floor(Math.random() * pool.length);
      drawn.push(pool[idx]);
      trial[pool[idx]]--;
    }
    return { drawn, bag: trial };
  };

  // 1) Tirage de complément : on garde le reliquat, on pioche `need` lettres.
  {
    const r = drawN(bag, need);
    if (r.drawn.length === need) {
      if (rackValid([...kept, ...r.drawn], r.bag, minV, minC)) {
        // Complément valide : on garde le reliquat → ce n'est PAS un rejet.
        return { drawn: r.drawn, bag: r.bag, fresh: false, minApplied: minVC };
      }
    }
  }

  // Le rejet (remise du reliquat + tirage complet) n'a de sens que s'il reste
  // assez de lettres pour reformer un chevalet complet de `target` jetons.
  const bagBack = { ...bag };
  for (const l of realKept) bagBack[l] = (bagBack[l] || 0) + 1;
  const freshNeed = target - jokerCount;
  const jokerFill = Array(jokerCount).fill("?");
  const bagBackCount = Object.values(bagBack).reduce((a, b) => a + b, 0);

  // 1bis) Fin de partie : pas assez de lettres pour un chevalet complet.
  //   → AUCUN rejet. On garde le reliquat et on pioche le complément disponible
  //   (sans tiret). On cherche un rack jouable (≥1 voyelle + ≥1 consonne).
  if (jokerCount + bagBackCount < target) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const r = drawN(bag, need);
      if (rackValid([...kept, ...r.drawn], r.bag, 1)) {
        return { drawn: r.drawn, bag: r.bag, fresh: false, minApplied: 0 };
      }
    }
    // Aucun complément jouable : on renvoie le chevalet restant tel quel s'il
    // est lui-même jouable, sinon fin de partie.
    if (rackValid(kept, bag, 1)) {
      return { drawn: [], bag: { ...bag }, fresh: false, minApplied: 0 };
    }
    return { drawn: null, bag: { ...bag }, failed: true };
  }

  // 2) REJET : on remet le reliquat (hors jokers) dans le sac et on tire un
  //    chevalet complet neuf. On répète jusqu'à satisfaire la règle.
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = drawN(bagBack, freshNeed);
    if (r.drawn.length < freshNeed) break;   // plus assez de lettres
    if (rackValid([...jokerFill, ...r.drawn], r.bag, minV, minC)) {
      return { drawn: r.drawn, bag: r.bag, fresh: true, minApplied: minVC };
    }
  }

  // 3) Règle stricte impossible malgré un sac suffisant. On relâche tant que le
  //    rack reste jouable (≥1 voyelle + ≥1 consonne), tirage complet (rejet).
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = drawN(bagBack, freshNeed);
    if (r.drawn.length < freshNeed) break;
    if (rackValid([...jokerFill, ...r.drawn], r.bag, 1)) {
      return { drawn: r.drawn, bag: r.bag, fresh: true, minApplied: 0 };
    }
  }

  // Vraiment impossible → fin de partie.
  return { drawn: null, bag: { ...bag }, failed: true };
}

// Tirage générique (utilisé pour tests/contextes hors duplicate)
export function drawRack(bag, n = 7, rule = { minVowels: 0, minConsonants: 0 }) {
  // bag est un objet {LETTRE: nombre restant}. On modifie une copie.
  const b = { ...bag };
  const draw = () => {
    const pool = [];
    for (const [l, count] of Object.entries(b)) {
      for (let i = 0; i < count; i++) pool.push(l);
    }
    if (pool.length === 0) return null;
    const idx = Math.floor(Math.random() * pool.length);
    const letter = pool[idx];
    b[letter]--;
    return letter;
  };

  // Plusieurs essais pour respecter la règle voyelles/consonnes
  for (let attempt = 0; attempt < 20; attempt++) {
    const trial = { ...b };
    const rack = [];
    for (let i = 0; i < n; i++) {
      const all = [];
      for (const [l, c] of Object.entries(trial)) for (let j = 0; j < c; j++) all.push(l);
      if (!all.length) break;
      const idx = Math.floor(Math.random() * all.length);
      rack.push(all[idx]);
      trial[all[idx]]--;
    }
    const v = rack.filter(l => VOWELS.has(l) || l === "?").length;
    const c = rack.length - v;
    if (v >= rule.minVowels && c >= rule.minConsonants) {
      // commit
      for (const l of rack) b[l]--;
      return { rack, bag: b };
    }
  }
  // fallback : tirage simple
  const rack = [];
  for (let i = 0; i < n; i++) { const l = draw(); if (l) rack.push(l); }
  return { rack, bag: b };
}

export function bagTotalVowels(bag) {
  let v = 0; for (const l of Object.keys(bag)) if (VOWELS.has(l)) v += bag[l]; return v;
}
export function bagTotalConsonants(bag) {
  let c = 0; for (const l of Object.keys(bag)) if (!VOWELS.has(l) && l !== "?") c += bag[l]; return c;
}
