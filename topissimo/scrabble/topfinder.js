// ============================================================
//  Top finder
//  Trouve le coup au score maximal pour un tirage et un plateau
//  donnés. Algorithme à base d'ancres :
//
//   - Une "ancre" = case vide adjacente à une lettre existante
//     (ou la case centrale si le plateau est vide).
//   - Pour chaque ancre, chaque direction (H, V), chaque offset
//     (position de l'ancre dans le mot), on étend récursivement
//     en plaçant des lettres du chevalet, élagué par hasPrefix().
//   - Pour chaque mot complet, on appelle scoreMove() (qui valide
//     aussi les mots croisés) et on garde le maximum.
// ============================================================

import { BOARD_SIZE, CENTER, scoreMove, applyMove, LETTER_VALUE, VOWELS, isSimplePath, isSnakeMove } from "./engine.js?v=341";

// Un coup PROLONGE le serpent s'il s'accroche à une extrémité (isSnakeMove ; les
// mots croisés latéraux sont permis), OU s'il garde un chemin simple (extension
// colinéaire du coup 2). `ends` = les 2 extrémités courantes du serpent.
export function snakeMoveLegal(board, ends, move) {
  return isSnakeMove(board, ends, move) || isSimplePath(applyMove(board, move));
}

// Mode Snake : meilleur coup (score max) qui prolonge le serpent. En cas d'isotop
// (même score), on privilégie le mot le plus RALLONGEABLE dans le dico (par l'avant
// ou l'arrière) pour que le serpent puisse continuer (tête/queue extensible).
export function snakeBestTop(board, rack, dict, ends, opts = {}) {
  const all = findTop(board, rack, dict, { all: true, ...opts }) || [];
  const legal = all.filter(c => snakeMoveLegal(board, ends, c.move));
  if (!legal.length) return null;
  const top = legal[0].score;                       // legal garde l'ordre décroissant
  const tied = legal.filter(c => c.score === top);
  if (tied.length === 1) return tied[0];
  tied.sort((a, b) => scoreDictExtensibility(b.move.word, dict) - scoreDictExtensibility(a.move.word, dict));
  return tied[0];
}

// ============================================================
//  Top finder avec départage des isotops (mêmes scores)
//
//  Ordre de priorité :
//   1. Rallongeabilité : préférer un mot dont la (ou les) extrémité
//      peut accueillir une lettre (case adjacente vide, pas en bord
//      ni bloquée). +2 si rallongeable des deux côtés, +1 si un seul.
//   2. Ouverture du plateau : nombre de nouveaux points d'ancrage
//      créés (cases vides adjacentes aux nouvelles lettres).
//   3. Qualité du reliquat : équilibre voyelles/consonnes, malus si
//      on garde un Q sans U disponible (rack ∪ sac), etc.
// ============================================================

export function findTopRanked(board, rack, dict, bag = null, opts = {}) {
  const all = findTop(board, rack, dict, { all: true, ...opts }) || [];
  if (!all.length) return null;
  const top = all[0].score;
  const tied = all.filter(c => c.score === top);
  const isotopWords = [...new Set(tied.map(c => c.move.word))];
  if (tied.length === 1) return { ...tied[0], isotops: 1, isotopWords };

  const scored = sortTiedIsotops(tied, board, rack, dict, bag, opts);
  return { ...scored[0], isotops: tied.length, isotopWords };
}

// Trie une liste de coups À SCORE ÉGAL (isotops) selon les critères de pertinence
// Topissimo (mêmes critères que findTopRanked). Renvoie le tableau trié.
function sortTiedIsotops(tied, board, rack, dict, bag, opts = {}) {
  const preserveJoker = !!opts.preserveJoker;
  const isFirstMove = board.every(row => row.every(c => !c));

  const scored = tied.map(c => ({
    ...c,
    _noJoker:   scoreJokerPreserved(c.move, bag, preserveJoker),
    _endsGame:  scoreEndsGame(rack, c.move, bag, board),  // 1 si ce coup termine la partie
    _playsQ:    c.move.word.includes("Q") ? 1 : 0,
    _qPos:      scoreQPosition(c.move),                 // -1 si Q en bout, 0 sinon
    _extBoth:   isFirstMove ? scoreExtBothSides(c.move.word, dict) : 0, // 1 si rallongeable des 2 côtés (1er coup)
    _dictExt:   scoreDictExtensibility(c.move.word, dict), // rallonges 1 lettre dans le dico
    // 1er coup : pour un mot de 3 lettres, on privilégie le placement qui pose
    // sur le centre la lettre la PLUS fréquente en bord (début/fin) de mot de 8
    // lettres — c'est par le centre que passe le futur scrabble vertical (8A/8H).
    // Ex. DEY : on centre sur E (fréquent en bord de 8) plutôt que Y (rare).
    _centerL:   isFirstMove ? centerLetterScore(c.move, dict, board) : 0,
    // À nombre de rallonges égal, on préfère les rallonges FINALES (le mot est
    // posé à gauche, sens de lecture). Ex. SENTIRA (rallonge finale) > ENTRAIS
    // (benjamins) pour AEINRST.
    _backExt:   isFirstMove ? backExtCount(c.move.word, dict) : 0,
    _twAccess:  scoreTWAccess(board, c.move),              // nb de cases TW libres atteignables après ce coup
    _ext:       scoreExtensibility(board, c.move),
    _scrab:     scoreScrabbleOpenings(board, c.move),   // nb d'appuis pour scrabble perpendiculaire
    _open:      scoreOpenness(board, c.move),
    _left:      scoreLeftPosition(c.move, dict),        // utile au 1er coup
    _leave:     scoreLeave(board, rack, c.move, bag),
  }));
  // Ordre de priorité :
  //   1. coup qui TERMINE la partie (prime sur tout, même sur préserver joker)
  //   2. joker préservé (mode joker)
  //   3. joue le Q
  //   4. Q pas en bout de mot
  //   5. (1er coup) rallongeable des 2 côtés en 1 lettre (TETAI > ETAIT)
  //   6. extensibilité dico globale (nb total de rallonges 1 lettre)
  //   7. accès aux cases TW libres (tuile posée dans même ligne/colonne qu'une TW libre)
  //   8. rallongeabilité physique (les 2 côtés ouverts sur le plateau)
  //   9. nb d'appuis créant un scrabble (≥6 cases libres perpendiculaires)
  //  10. position à gauche (1er coup uniquement)
  //  11. ouverture de la grille (générique)
  //  12. qualité du reliquat
  scored.sort((a, b) =>
    b._endsGame - a._endsGame ||
    b._noJoker - a._noJoker ||
    b._playsQ - a._playsQ ||
    b._qPos - a._qPos ||
    b._extBoth - a._extBoth ||
    b._dictExt - a._dictExt ||
    b._centerL - a._centerL ||
    b._backExt - a._backExt ||
    b._twAccess - a._twAccess ||
    b._ext - a._ext ||
    b._scrab - a._scrab ||
    (isFirstMove ? b._left - a._left : 0) ||
    b._open - a._open ||
    b._leave - a._leave
  );
  return scored;
}

// Liste des isotops (coups au score MAX) classés par pertinence Topissimo.
// Le premier élément est le choix qu'aurait fait findTopRanked.
export function rankIsotops(board, rack, dict, bag = null, opts = {}) {
  const all = findTop(board, rack, dict, { all: true, ...opts }) || [];
  if (!all.length) return [];
  const top = all[0].score;
  const tied = all.filter(c => c.score === top);
  if (tied.length <= 1) return tied;
  return sortTiedIsotops(tied, board, rack, dict, bag, opts);
}

// Renvoie 1 si le coup PRÉSERVE le joker, 0 s'il le consomme.
//   • Aucun joker posé → 1.
//   • Hors partie joker (preserveJoker faux ou sac inconnu) → un joker posé est
//     consommé définitivement → 0.
//   • En partie joker (règle FFSC 3.8.1) : le joker est recyclé si la lettre
//     qu'il représente est encore dans le sac. Si TOUS les jokers du mot sont
//     recyclables, le coup ne consomme aucun joker → 1 (à départager ensuite par
//     l'ouverture de la grille : VEXE(R) recyclable et plus ouvrant > VEXE).
function scoreJokerPreserved(move, bag, preserveJoker) {
  const blanks = move.blanks || [];
  if (blanks.length === 0) return 1;
  if (!preserveJoker || !bag) return 0;
  const need = {};
  for (const i of blanks) { const L = move.word[i]; need[L] = (need[L] || 0) + 1; }
  for (const [L, n] of Object.entries(need)) {
    if ((bag[L] || 0) < n) return 0;   // au moins un joker non recyclable
  }
  return 1;
}

// Renvoie 1 si le coup TERMINE la partie : après avoir joué, ce qui reste
// (chevalet conservé + sac) n'a plus de voyelle OU plus de consonne.
// Le bag passé peut être null (cas générique) → on retourne 0 (info indispo).
function scoreEndsGame(rack, move, bag, board) {
  if (!bag) return 0;
  // Lettres réellement POSÉES depuis le chevalet = uniquement les cases NOUVELLES
  // (vides sur le plateau). Les lettres du mot déjà présentes sur le plateau ne
  // consomment PAS de tuile → il ne faut pas les retirer du reliquat (sinon on
  // sous-estime le reliquat et on croit à tort la partie terminée sur un isotop).
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const used = []; // lettres retirées du chevalet
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, cc = move.col + i * dc;
    if (board && board[r] && board[r][cc]) continue;   // déjà sur le plateau → pas du rack
    const isBlank = (move.blanks || []).includes(i);
    used.push(isBlank ? "?" : move.word[i]);
  }
  const rackRem = rack.slice();
  for (const L of used) {
    let idx = rackRem.indexOf(L);
    if (idx === -1 && L !== "?") idx = rackRem.indexOf("?");  // joker en remplacement
    if (idx !== -1) rackRem.splice(idx, 1);
  }
  // Total voyelles + consonnes restantes (rack + sac)
  let v = 0, c = 0;
  for (const L of rackRem) {
    if (L === "?") continue;
    if (VOWELS.has(L)) v++; else c++;
  }
  for (const [L, n] of Object.entries(bag)) {
    if (L === "?" || !n) continue;
    if (VOWELS.has(L)) v += n; else c += n;
  }
  // Un joker encore disponible (reliquat ou sac) peut servir de voyelle OU de
  // consonne : tant qu'il en reste un, la partie peut continuer même si un type
  // réel est épuisé (cf. règle FFSC du joker en fin de partie). Le coup n'est
  // donc « terminal » que s'il ne reste plus aucun joker pour combler.
  const jokersLeft = rackRem.filter(L => L === "?").length + (bag["?"] || 0);
  if (v === 0 || c === 0) return jokersLeft > 0 ? 0 : 1;
  return 0;
}

function scoreQPosition(move) {
  const qIdx = move.word.indexOf("Q");
  if (qIdx === -1) return 0;
  // Pénalité si Q est au début ou à la fin du mot (bloque l'extension d'un côté)
  if (qIdx === 0 || qIdx === move.word.length - 1) return -1;
  return 0;
}

// Renvoie 1 si le mot peut être rallongé d'une lettre AVANT (préfixe valide L+word)
// ET d'une lettre APRÈS (suffixe valide word+L). Sinon 0.
// Utile au 1er coup pour privilégier les mots ouverts des 2 côtés.
function scoreExtBothSides(word, dict) {
  let frontOK = false, backOK = false;
  for (let code = 65; code <= 90; code++) {
    const L = String.fromCharCode(code);
    if (!frontOK && dict.has(L + word)) frontOK = true;
    if (!backOK  && dict.has(word + L)) backOK  = true;
    if (frontOK && backOK) return 1;
  }
  return 0;
}

// Fréquence de chaque lettre en 1ʳᵉ OU dernière position des mots de 8 lettres
// de l'ODS (calculée une fois, mémorisée sur l'objet dict).
function edge8Freq(dict) {
  if (dict._edge8) return dict._edge8;
  const m = {};
  const list = (dict.byLen && dict.byLen.get(8)) || [];
  for (const w of list) {
    m[w[0]] = (m[w[0]] || 0) + 1;
    m[w[7]] = (m[w[7]] || 0) + 1;
  }
  dict._edge8 = m;
  return m;
}

// 1er coup, mot de 3 lettres : score de la lettre posée sur la case centrale
// selon sa fréquence en bord de mot de 8 lettres (0 pour les autres longueurs).
function centerLetterScore(move, dict, board) {
  if (move.word.length !== 3) return 0;
  const C = board.length >> 1;   // 7 pour une grille 15×15
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  for (let i = 0; i < move.word.length; i++) {
    if (move.row + i * dr === C && move.col + i * dc === C) {
      return edge8Freq(dict)[move.word[i]] || 0;
    }
  }
  return 0;
}

// Nombre de rallonges FINALES d'une lettre (word + L) présentes dans l'ODS.
function backExtCount(word, dict) {
  let n = 0;
  for (let code = 65; code <= 90; code++) {
    if (dict.has(word + String.fromCharCode(code))) n++;
  }
  return n;
}

function scoreDictExtensibility(word, dict) {
  // Compte les rallonges valides d'1 lettre (suffixe ou préfixe) dans l'ODS.
  // Une forme verbale conjuguable (DEMARIE → DEMARIES, DEMARIEE, DEMARIEZ…)
  // ou un mot pluriélisable obtient un score élevé.
  let count = 0;
  for (let code = 65; code <= 90; code++) {
    const L = String.fromCharCode(code);
    if (dict.has(word + L)) count++;
    if (dict.has(L + word)) count++;
  }
  return count;
}

// Cases TW (mots compte triple) du plateau standard.
const TW_CELLS = [
  [0,0],[0,7],[0,14],
  [7,0],[7,14],
  [14,0],[14,7],[14,14],
];

// Compte le nombre de cases TW encore libres (non occupées) pour lesquelles
// le coup crée une nouvelle "ligne d'accès" : une tuile nouvellement posée
// partage la même ligne OU la même colonne que la case TW.
// Ex : KIPS pose une lettre en ligne O (row 14) → ouvre l'accès aux TW en
// O1 (14,0) et O8 (14,7) qui sont dans la même ligne.
function scoreTWAccess(board, move) {
  const dr = move.dir === "V" ? 1 : 0;
  const dc = move.dir === "H" ? 1 : 0;
  // Coordonnées des tuiles nouvellement posées
  const newTiles = [];
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (!board[r][c]) newTiles.push([r, c]);
  }
  if (!newTiles.length) return 0;
  let count = 0;
  for (const [tr, tc] of TW_CELLS) {
    if (board[tr][tc]) continue; // déjà occupée → ne compte pas
    // Vérifier si une tuile nouvelle partage la ligne OU la colonne de cette TW
    const accessed = newTiles.some(([nr, nc]) => nr === tr || nc === tc);
    if (accessed) count++;
  }
  return count;
}

function scoreScrabbleOpenings(board, move) {
  // Compte le nombre de NOUVELLES lettres posées qui ouvrent un scrabble :
  // une lettre posée crée un "appui scrabble" si elle a >= 6 cases vides
  // contiguës dans la direction perpendiculaire (avant + après), permettant
  // de poser un mot de 7 lettres en utilisant cette lettre comme ancre.
  const newBoard = applyMove(board, move);
  const dr = move.dir === "V" ? 1 : 0;
  const dc = move.dir === "H" ? 1 : 0;
  // Direction perpendiculaire
  const pdr = move.dir === "V" ? 0 : 1;
  const pdc = move.dir === "V" ? 1 : 0;
  let count = 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue; // lettre déjà là
    let before = 0;
    let br = r - pdr, bc = c - pdc;
    while (br >= 0 && bc >= 0 && br < BOARD_SIZE && bc < BOARD_SIZE && !newBoard[br][bc]) {
      before++; br -= pdr; bc -= pdc;
    }
    let after = 0;
    let ar = r + pdr, ac = c + pdc;
    while (ar >= 0 && ac >= 0 && ar < BOARD_SIZE && ac < BOARD_SIZE && !newBoard[ar][ac]) {
      after++; ar += pdr; ac += pdc;
    }
    if (before + after >= 6) count++;
  }
  return count;
}

function scoreLeftPosition(move, dict) {
  // Pour le 1er coup : on préfère le mot le plus à gauche/haut POSSIBLE, MAIS
  // si le mot n'a PAS de rallonge initiale d'une lettre dans le dico, on doit
  // laisser au moins 2 cases libres devant lui (pour pouvoir placer des
  // scrabbles perpendiculaires plus tard). Sinon le côté est totalement fermé.
  // Exemple : AIIIRSS → IRISAIS n'a aucune rallonge initiale ; IRISAIS en H2
  // ne laisse qu'1 case libre devant (col 0) → impossible de tourner autour.
  // À H3, on a 2 cases libres → on garde des appuis pour scrabbler.
  const pos = move.dir === "H" ? move.col : move.row;
  // Test si le mot a une rallonge d'1 lettre par devant dans le dico
  let hasFrontExt = false;
  if (dict) {
    for (let code = 65; code <= 90; code++) {
      if (dict.has(String.fromCharCode(code) + move.word)) { hasFrontExt = true; break; }
    }
  }
  if (hasFrontExt) {
    // Rallonge devant : on peut coller le mot au bord (pos = 1 OK)
    return -pos;
  }
  // Pas de rallonge devant : on veut ≥ 2 cases devant
  if (pos < 2) {
    // Pénalité forte : la position 0 ou 1 ferme un côté du plateau
    return -1000 - (2 - pos);
  }
  return -pos;
}

function scoreExtensibility(board, move) {
  const dr = move.dir === "V" ? 1 : 0;
  const dc = move.dir === "H" ? 1 : 0;
  const startR = move.row, startC = move.col;
  const endR = startR + (move.word.length - 1) * dr;
  const endC = startC + (move.word.length - 1) * dc;
  let s = 0;
  // côté arrière : case avant le début doit exister ET être vide
  const pr = startR - dr, pc = startC - dc;
  if (pr >= 0 && pc >= 0 && pr < BOARD_SIZE && pc < BOARD_SIZE && !board[pr][pc]) s++;
  // côté avant : case après la fin doit exister ET être vide
  const nr = endR + dr, nc = endC + dc;
  if (nr >= 0 && nc >= 0 && nr < BOARD_SIZE && nc < BOARD_SIZE && !board[nr][nc]) s++;
  return s;
}

function scoreOpenness(board, move) {
  // Nombre de cases vides adjacentes aux NOUVELLES lettres
  const newBoard = applyMove(board, move);
  const dr = move.dir === "V" ? 1 : 0;
  const dc = move.dir === "H" ? 1 : 0;
  let count = 0;
  const seen = new Set();
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue; // pas nouvelle
    for (const [ddr, ddc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const ar = r + ddr, ac = c + ddc;
      if (ar < 0 || ar >= BOARD_SIZE || ac < 0 || ac >= BOARD_SIZE) continue;
      const key = `${ar},${ac}`;
      if (seen.has(key)) continue;
      if (!newBoard[ar][ac]) { seen.add(key); count++; }
    }
  }
  return count;
}

function scoreLeave(board, rack, move, bag) {
  // Lettres effectivement retirées du chevalet
  const dr = move.dir === "V" ? 1 : 0;
  const dc = move.dir === "H" ? 1 : 0;
  const used = []; // {letter, isBlank}
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (!board[r][c]) used.push({ letter: move.word[i], isBlank: (move.blanks || []).includes(i) });
  }
  // Construire le reliquat (copie du chevalet, on retire used)
  const leave = rack.slice();
  for (const u of used) {
    let idx = -1;
    if (u.isBlank) idx = leave.indexOf("?");
    else {
      idx = leave.indexOf(u.letter);
      if (idx === -1) idx = leave.indexOf("?");
    }
    if (idx !== -1) leave.splice(idx, 1);
  }
  // Évaluation
  let s = 0;
  // Équilibre voyelles / consonnes (idéal : 2-4 voyelles sur ≤6 lettres restantes)
  if (leave.length > 0) {
    const vowels = leave.filter(l => VOWELS.has(l) || l === "?").length;
    const cons = leave.length - vowels;
    if (vowels === 0 || cons === 0) s -= 5;
    else if (vowels >= 1 && vowels <= 4) s += 1;
  }
  // Q sans U (dans le reliquat + sac)
  const hasQ = leave.includes("Q");
  if (hasQ) {
    const hasU = leave.includes("U") || leave.includes("?") || (bag && bag.U > 0);
    if (!hasU) s -= 8;
  }
  // Trop de doublons
  const counts = {};
  for (const l of leave) counts[l] = (counts[l] || 0) + 1;
  for (const c of Object.values(counts)) if (c >= 3) s -= 2;
  // Légère préférence pour garder un joker
  if (leave.includes("?")) s += 1;
  return s;
}

// ============================================================

export function findTop(board, rack, dict, opts = {}) {
  const maxTilesUsed = opts.maxTilesUsed ?? rack.length;
  const bonuses = opts.bonuses || { 7: 50 };
  const isEmpty = board.every(row => row.every(c => !c));
  const seenMoves = new Set();         // dédupliquer
  const candidates = [];

  // Restriction optionnelle à une ZONE rectangulaire (supertop) : on limite les
  // ancres ET l'extension des mots à cette zone → recherche bien plus rapide.
  const zone = opts.zone || null;
  let anchors = isEmpty ? [[CENTER, CENTER]] : findAnchors(board);
  if (zone) anchors = anchors.filter(([r, c]) => r >= zone.r0 && r <= zone.r1 && c >= zone.c0 && c <= zone.c1);

  for (const dir of ["H", "V"]) {
    // FFSC : au 1er coup (plateau vide), on ne joue qu'horizontalement
    if (isEmpty && dir === "V") continue;
    // Mode Horizontal/Vertical : direction imposée pour ce coup.
    if (opts.forceDir && dir !== opts.forceDir) continue;
    const dr = dir === "V" ? 1 : 0;
    const dc = dir === "H" ? 1 : 0;
    for (const [ar, ac] of anchors) {
      // offsets de l'ancre dans le mot : on recule depuis l'ancre en comptant
      // uniquement les cases VIDES (= nouvelles tuiles du rack) ; on s'arrête
      // dès qu'on aurait besoin de plus de tuiles que le rack n'en contient,
      // ou qu'on sort du plateau.
      // (L'ancienne borne Math.min(rack.length, ac) était trop restrictive :
      //  elle ignorait les lettres déjà posées avant l'ancre, qui ne consomment
      //  pas de tuiles. Ex : MOTIVERAIS avec MOTIVER déjà en ligne O → offset 8
      //  mais seulement 2 nouvelles cases avant l'ancre.)
      let maxOffset = 0;
      {
        let newTilesNeeded = 0;
        const physicalMax = dir === "H" ? ac : ar;
        for (let step = 1; step <= physicalMax; step++) {
          const tr = ar - step * dr, tc = ac - step * dc;
          if (!board[tr][tc]) {
            newTilesNeeded++;
            if (newTilesNeeded > rack.length) break;
          }
          maxOffset = step;
        }
      }
      for (let offset = 0; offset <= maxOffset; offset++) {
        const startR = ar - offset * dr;
        const startC = ac - offset * dc;
        if (startR < 0 || startC < 0) break;
        // pour éviter doublons : la case juste avant le start doit être
        // hors plateau ou vide (sinon le mot ferait partie d'un mot plus long
        // qu'on trouvera depuis une autre ancre)
        // Zone : on ne démarre pas un mot avant le bord gauche/haut de la zone.
        if (zone && (startR < zone.r0 || startC < zone.c0)) break;
        const pr = startR - dr, pc = startC - dc;
        if (pr >= 0 && pc >= 0 && pr < BOARD_SIZE && pc < BOARD_SIZE && board[pr][pc]) {
          continue;
        }
        extend({
          board, dict, rack, dir, dr, dc,
          ar, ac, startR, startC,
          r: startR, c: startC,
          currentWord: "",
          blanksAt: [],
          tilesUsed: 0,
          maxTilesUsed,
          bonuses,
          jokerPays: opts.jokerPays,
          layout: opts.layout,
          anchorCovered: false,
          candidates, seenMoves, zone,
        });
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return opts.all ? candidates : candidates[0];
}

function findAnchors(board) {
  const out = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]) continue;
      const touches = [[1,0],[-1,0],[0,1],[0,-1]].some(([dr,dc]) => {
        const nr = r+dr, nc = c+dc;
        return nr>=0 && nr<BOARD_SIZE && nc>=0 && nc<BOARD_SIZE && board[nr][nc];
      });
      if (touches) out.push([r, c]);
    }
  }
  return out;
}

function extend(ctx) {
  const { board, dict, rack, dir, dr, dc, ar, ac, startR, startC,
          r, c, currentWord, blanksAt, tilesUsed, maxTilesUsed, bonuses,
          anchorCovered, candidates, seenMoves, zone } = ctx;

  // 1) Si on a un mot valide qui couvre l'ancre, et que la prochaine case
  //    est vide / hors plateau (ou hors zone) → c'est un candidat.
  const outZone = zone && (r < zone.r0 || r > zone.r1 || c < zone.c0 || c > zone.c1);
  const offBoard = r >= BOARD_SIZE || c >= BOARD_SIZE || outZone;
  const nextEmpty = offBoard || !board[r][c];
  if (anchorCovered && currentWord.length >= 2 && nextEmpty && dict.has(currentWord)) {
    const key = `${dir}|${startR},${startC}|${currentWord}|${blanksAt.join(",")}`;
    if (!seenMoves.has(key)) {
      seenMoves.add(key);
      const move = { word: currentWord, row: startR, col: startC, dir, blanks: [...blanksAt] };
      const result = scoreMove(board, move, dict, { bonuses, jokerPays: ctx.jokerPays, layout: ctx.layout });
      if (result.errors.length === 0) {
        candidates.push({ score: result.score, move, words: result.words, placedCount: result.placed.length });
      }
    }
  }

  if (offBoard) return;

  // 2) Élagage par préfixe
  if (currentWord && !dict.hasPrefix(currentWord)) return;

  // 3) Si la case est occupée : on doit utiliser la lettre existante (sans consommer du rack)
  const existing = board[r][c];
  if (existing) {
    extend({
      ...ctx,
      r: r + dr, c: c + dc,
      currentWord: currentWord + existing.letter,
      anchorCovered: anchorCovered || (r === ar && c === ac),
    });
    return;
  }

  // 3.5) Contrainte de tuiles maximum (formules 7sur8, 7et8, 789)
  if (tilesUsed >= maxTilesUsed) return;

  // 4) Case vide : essayer chaque lettre du chevalet (sans répéter)
  const tried = new Set();
  for (let i = 0; i < rack.length; i++) {
    const tile = rack[i];
    if (tile === "?") {
      for (let code = 65; code <= 90; code++) {
        const L = String.fromCharCode(code);
        if (tried.has("?" + L)) continue;
        tried.add("?" + L);
        const newRack = rack.slice(); newRack.splice(i, 1);
        extend({
          ...ctx,
          rack: newRack,
          r: r + dr, c: c + dc,
          currentWord: currentWord + L,
          blanksAt: [...blanksAt, currentWord.length],
          tilesUsed: tilesUsed + 1,
          anchorCovered: anchorCovered || (r === ar && c === ac),
        });
      }
    } else {
      if (tried.has(tile)) continue;
      tried.add(tile);
      const newRack = rack.slice(); newRack.splice(i, 1);
      extend({
        ...ctx,
        rack: newRack,
        r: r + dr, c: c + dc,
        currentWord: currentWord + tile,
        tilesUsed: tilesUsed + 1,
        anchorCovered: anchorCovered || (r === ar && c === ac),
      });
    }
  }
}
