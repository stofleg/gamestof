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

import { BOARD_SIZE, BOARD_BONUSES, CENTER, scoreMove, applyMove, LETTER_VALUE, VOWELS, CONSONANTS_FR, isSimplePath, isSnakeMove } from "./engine.js?v=362";

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
  tied.sort((a, b) => scoreDictExtensibility(b.move.word, dict, board, b.move)
                    - scoreDictExtensibility(a.move.word, dict, board, a.move));
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
    _fertCells: fertilityByCell(board, c.move, dict, opts.layout),
    _noJoker:   scoreJokerPreserved(c.move, bag, preserveJoker),
    _endsGame:  scoreEndsGame(rack, c.move, bag, board),  // 1 si ce coup termine la partie
    // « Joue le Q » = le Q fait partie des lettres POSÉES (pas d'un Q déjà sur le
    // plateau — DETROQUER via un Q existant ne « joue » pas le Q du tirage).
    _playsQ:    playsQFromRack(board, c.move) ? 1 : 0,
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
    // ----- Critères affinés (chantiers 1-5) -----
    _dictExtR:  scoreDictExtensibility(c.move.word, dict, board, c.move), // rallonges RÉELLEMENT jouables
    _dictExtBag: scoreDictExtensibilityBag(c.move.word, dict, board, c.move, bag), // idem, pondérées par le sac
    _bonusReach: scoreBonusReach(board, c.move, dict, opts.layout), // rallonges multi-lettres atteignant une TW/DW
    _twReal:    scoreTWAccessReal(board, c.move),          // accès TW : créés/conservés − bouchés
    _openDir:   scoreOpenDirection(board, c.move),         // ouverture vers la zone libre (biais haut/gauche)
    _supportL:  scoreSupportLetters(board, c.move, dict),  // qualité des lettres comme appuis (E ≫ X)
    _fert:      scoreSupportFertility(board, c.move, dict),// nb de scrabbles accrochables sur les appuis créés
    // Agrégations de la fertilité positionnelle (distinguent les anagrammes) :
    // meilleur appui créé, deux meilleurs, et total.
    _fertMax:   0, _fertTop2: 0, _fertPos: 0,   // renseignés juste après
    _ext:       scoreExtensibility(board, c.move),
    _scrab:     scoreScrabbleOpenings(board, c.move),   // nb d'appuis pour scrabble perpendiculaire
    _open:      scoreOpenness(board, c.move),
    _left:      scoreLeftPosition(c.move, dict),        // utile au 1er coup
    _leave:     scoreLeave(board, rack, c.move, bag),
  }));
  for (const c of scored) {
    const f = c._fertCells || [];
    c._fertMax = f[0] || 0;
    c._fertTop2 = (f[0] || 0) + (f[1] || 0);
    c._fertPos = f.reduce((s, x) => s + x, 0);
  }
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
  // ===== Score PONDÉRÉ (remplace la hiérarchie stricte) =====
  // Une hiérarchie lexicographique interdit tout compromis : un critère de rang 3
  // ne pouvait jamais compenser un critère de rang 2, même de justesse. Or la
  // pertinence d'un coup est faite d'arbitrages (« le critère 6 ne peut pas être
  // au dépens du 13, il faut un savant mélange des deux »).
  // Restent en VERROU hiérarchique, car non négociables : terminer la partie,
  // préserver le joker, jouer le Q (et pas en bout de mot).
  // Les autres critères sont normalisés en 0..1 puis pondérés.
  for (const c of scored) {
    const n = {
      dictExt: Math.min(1, (c._dictExtR || 0) / 20),   // rallonges réellement jouables
      twReal:  Math.max(-1, Math.min(1, (c._twReal || 0) / 6)),
      openDir: Math.max(-1, Math.min(1, (c._openDir || 0) * 1.6)),
      fert:    Math.min(1, (c._fert || 0) / 60000),
      dictExtBag: Math.min(1, (c._dictExtBag || 0) / 15),
      bonusReach: Math.min(1, Math.log1p(c._bonusReach || 0) / Math.log1p(60)),
      // Normalisation LOGARITHMIQUE : ces compteurs varient sur plusieurs ordres
      // de grandeur ; une division linéaire saturait à 1 et effaçait les écarts.
      fertPos: Math.min(1, Math.log1p(c._fertPos || 0) / Math.log1p(400000)),
      fertMax: Math.min(1, Math.log1p(c._fertMax || 0) / Math.log1p(120000)),
      fertTop2: Math.min(1, Math.log1p(c._fertTop2 || 0) / Math.log1p(200000)),
      supportL: c._supportL || 0,
      scrab:   Math.min(1, (c._scrab || 0) / 4),
      ext:     Math.min(1, (c._ext || 0) / 2),
      open:    Math.min(1, (c._open || 0) / 16),
      leave:   Math.max(-1, Math.min(1, (c._leave || 0) / 10)),
      // Spécifiques 1er coup
      extBoth: c._extBoth || 0,
      centerL: Math.min(1, (c._centerL || 0)),
      backExt: Math.min(1, (c._backExt || 0) / 10),
      left:    Math.max(-1, Math.min(1, (c._left || 0) / 8)),
    };
    c._pertinence = isFirstMove
      ? (2.0 * n.extBoth + 1.5 * n.dictExt + 1.2 * n.centerL + 1.0 * n.backExt
         + 0.9 * n.left + 0.6 * n.supportL + 0.4 * n.fert)
      // Modèle COMPACT calibré sur les 31 cas annotés (2 lots), puis validé en
      // croisé (calage sur un lot, test sur l'autre) : 6 features seulement, car
      // un modèle à 14 poids sur-apprenait (40 % de généralisation contre ~72 %
      // ici). Les features retenues sont celles que les raisons d'annotation
      // citent explicitement : ouverture de la grille, meilleur appui créé,
      // accès réels aux TW, rallonges pondérées par le sac, rallonges
      // multi-lettres atteignant une case bonus, reliquat.
      : (2.5 * n.open + 3.6 * n.fertMax + 1.4 * n.twReal
         + 2.6 * n.dictExtBag + 1.3 * n.bonusReach + 0.5 * n.leave);
  }
  scored.sort((a, b) =>
    // --- verrous non négociables ---
    b._endsGame - a._endsGame ||
    b._noJoker - a._noJoker ||
    b._playsQ - a._playsQ ||
    b._qPos - a._qPos ||
    // --- score de pertinence (compromis pondéré) ---
    b._pertinence - a._pertinence ||
    // --- départage stable (évite tout choix « arbitraire » à égalité parfaite) ---
    a.move.word.localeCompare(b.move.word) ||
    (a.move.row - b.move.row) || (a.move.col - b.move.col)
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

// Vrai si un Q figure parmi les lettres NOUVELLEMENT posées par ce coup.
function playsQFromRack(board, move) {
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (!board[r][c] && move.word[i] === "Q") return true;
  }
  return false;
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

function scoreDictExtensibility(word, dict, board = null, move = null) {
  // Compte les rallonges valides d'1 lettre (suffixe ou préfixe) dans l'ODS.
  // Une forme verbale conjuguable (DEMARIE → DEMARIES, DEMARIEE, DEMARIEZ…)
  // ou un mot pluriélisable obtient un score élevé.
  //
  // IMPORTANT : si le plateau et le coup sont fournis, on ne compte que les
  // rallonges RÉELLEMENT JOUABLES — il faut une case LIBRE juste avant (préfixe)
  // ou juste après (suffixe) le mot, dans sa direction. Sans cette vérification,
  // un mot coincé entre deux tuiles ou contre un bord héritait d'un score élevé
  // alors qu'aucune rallonge n'est possible (mesuré : 12 % des candidats gonflés).
  let canAfter = true, canBefore = true;
  if (board && move) {
    const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
    const free = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && !board[r][c];
    canBefore = free(move.row - dr, move.col - dc);
    canAfter = free(move.row + word.length * dr, move.col + word.length * dc);
  }
  let count = 0;
  for (let code = 65; code <= 90; code++) {
    const L = String.fromCharCode(code);
    if (canAfter && dict.has(word + L)) count++;
    if (canBefore && dict.has(L + word)) count++;
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

// ===== Rallonges pondérées par le SAC (cas 9 des annotations) =====
// Une rallonge n'a de valeur que si la lettre nécessaire peut encore ARRIVER en
// jeu : « il n'y a plus de C dans le sac et un seul G → une seule rallonge réelle
// contre tous les E restants ». On compte donc les rallonges d'1 lettre jouables
// (case libre) ET dont la lettre subsiste dans le sac (le joker compte pour tout).
function scoreDictExtensibilityBag(word, dict, board, move, bag) {
  if (!bag) return scoreDictExtensibility(word, dict, board, move);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const free = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && !board[r][c];
  const canBefore = free(move.row - dr, move.col - dc);
  const canAfter = free(move.row + word.length * dr, move.col + word.length * dc);
  const jokers = bag["?"] || 0;
  let count = 0;
  for (let code = 65; code <= 90; code++) {
    const L = String.fromCharCode(code);
    const avail = (bag[L] || 0) + jokers;
    if (!avail) continue;
    // Pondération douce : une lettre abondante (tous les E du sac) pèse plus
    // qu'une lettre unique.
    const w = Math.min(1, 0.5 + 0.25 * (bag[L] || 0));
    if (canAfter && dict.has(word + L)) count += w;
    if (canBefore && dict.has(L + word)) count += w;
  }
  return count;
}

// ===== Rallonge multi-lettres ATTEIGNANT une case bonus (cas 7 et 19) =====
// « 4 rallonges en 2 lettres devant LISERENT 15C permettent de rejoindre 15A »
// (case triple) : ce qui compte est le nombre de mots du dico qui prolongent le
// mot posé jusqu'à une case TW/DW encore libre, et la LONGUEUR du chemin (2
// lettres ≫ 4 lettres). Index inversé mémoïsé pour les prolongements par
// l'avant (mots finissant par X), recherche binaire pour l'arrière.
function reversedIndex(dict) {
  if (dict.__revIdx) return dict.__revIdx;
  const rev = (dict.words || []).map(w => w.split("").reverse().join("")).sort();
  try { Object.defineProperty(dict, "__revIdx", { value: rev, enumerable: false }); }
  catch { dict.__revIdx = rev; }
  return rev;
}
function countWithPrefix(sorted, prefix) {
  // nb d'entrées de `sorted` commençant par `prefix` ET de longueur exacte donnée
  // → on renvoie la tranche [lo, hi) et le filtrage longueur se fait chez l'appelant.
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < prefix) lo = m + 1; else hi = m; }
  const start = lo;
  const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
  lo = start; hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < end) lo = m + 1; else hi = m; }
  return [start, lo];
}
function scoreBonusReach(board, move, dict, layout = null) {
  const rows = layout || BOARD_BONUSES;
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const w = move.word;
  const bonusW = (r, c) => rows[r][c] === "T" ? 3 : rows[r][c] === "D" ? 1.5 : 0;
  let score = 0;
  // --- prolongement par l'AVANT (k lettres devant) : mots finissant par w ---
  const rev = reversedIndex(dict);
  const wRev = w.split("").reverse().join("");
  for (let k = 1; k <= 4; k++) {
    const sr = move.row - k * dr, sc = move.col - k * dc;
    if (sr < 0 || sc < 0) break;
    if (board[sr] && board[sr][sc]) break;             // chemin occupé
    // toutes les cases intermédiaires doivent être libres
    let clear = true;
    for (let j = 1; j <= k; j++) { const rr = move.row - j * dr, cc = move.col - j * dc; if (board[rr][cc]) { clear = false; break; } }
    if (!clear) break;
    const bw = bonusW(sr, sc);
    if (!bw) continue;                                 // la case atteinte n'est pas une TW/DW
    const [a, b] = countWithPrefix(rev, wRev);
    let n = 0;
    for (let i = a; i < b && n < 50; i++) if (rev[i].length === w.length + k) n++;
    score += bw * n / k;                               // plus court = plus probable
  }
  // --- prolongement par l'ARRIÈRE (k lettres après) : mots commençant par w ---
  for (let k = 1; k <= 4; k++) {
    const er = move.row + (w.length + k - 1) * dr, ec = move.col + (w.length + k - 1) * dc;
    if (er >= BOARD_SIZE || ec >= BOARD_SIZE) break;
    let clear = true;
    for (let j = 0; j < k; j++) { const rr = move.row + (w.length + j) * dr, cc = move.col + (w.length + j) * dc; if (board[rr][cc]) { clear = false; break; } }
    if (!clear) break;
    const bw = bonusW(er, ec);
    if (!bw) continue;
    const [a, b] = countWithPrefix(dict.words, w);
    let n = 0;
    for (let i = a; i < b && n < 50; i++) if (dict.words[i].length === w.length + k) n++;
    score += bw * n / k;
  }
  return score;
}

// ===== Accès RÉEL aux cases TW (chantier 5) =====
// L'ancien scoreTWAccess se contente d'un contact ligne/colonne : un coup qui
// BOUCHE le chemin vers la TW scorait quand même. Ici on exige un chemin LIBRE
// entre une tuile d'appui et la case TW, et on mesure le DELTA (avant → après) :
//   • conserver / créer un accès  → positif ;
//   • boucher un accès existant   → négatif.
// Un « accès » = une case TW libre alignée avec au moins une tuile posée, avec
// toutes les cases intermédiaires libres (donc un mot peut réellement y courir).
function twAccessSet(bd) {
  const acc = new Set();
  for (const [tr, tc] of TW_CELLS) {
    if (bd[tr][tc]) continue;                       // TW déjà occupée
    for (let i = 0; i < BOARD_SIZE; i++) {
      // Appui sur la même LIGNE que la TW
      if (bd[tr][i]) {
        const [a, b] = i < tc ? [i + 1, tc] : [tc, i - 1];
        let clear = true;
        for (let k = a; k <= b; k++) if (bd[tr][k]) { clear = false; break; }
        if (clear) { acc.add(`${tr},${tc}`); break; }
      }
      // Appui sur la même COLONNE que la TW
      if (bd[i][tc]) {
        const [a, b] = i < tr ? [i + 1, tr] : [tr, i - 1];
        let clear = true;
        for (let k = a; k <= b; k++) if (bd[k][tc]) { clear = false; break; }
        if (clear) { acc.add(`${tr},${tc}`); break; }
      }
    }
  }
  return acc;
}
function scoreTWAccessReal(board, move) {
  const before = twAccessSet(board);
  const after = twAccessSet(applyMove(board, move));
  let gained = 0, lost = 0;
  for (const k of after) if (!before.has(k)) gained++;
  for (const k of before) if (!after.has(k)) lost++;
  // Les accès CONSERVÉS comptent aussi (ton cas 12 : « on conserve A15, H15 et
  // on ajoute O1 et O15 »), mais moins qu'un accès nouvellement créé.
  const kept = [...after].filter(k => before.has(k)).length;
  return 2 * gained + kept - 3 * lost;
}

// ===== Ouverture ORIENTÉE vers la zone libre (chantier 4) =====
// Ta règle : « toute la grille est sous la ligne H, il faut ouvrir la partie
// supérieure ; on écrit du haut vers le bas, donc plus on monte mieux c'est »
// (cas 10) et « la partie est très à gauche, B ouvre sur la droite » (cas 14).
// On mesure donc si le coup se développe vers la zone VIDE du plateau, avec un
// biais de lecture haut → bas et gauche → droite.
function scoreOpenDirection(board, move) {
  // Barycentre des tuiles déjà posées (la « masse » du plateau).
  let n = 0, sr = 0, sc = 0;
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    if (board[r][c]) { n++; sr += r; sc += c; }
  }
  if (!n) return 0;                                  // 1er coup : géré par _left/_centerL
  const cr = sr / n, cc = sc / n;
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  let s = 0, nt = 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue;                       // on ne juge que les tuiles POSÉES
    nt++;
    // Aller vers le côté le moins occupé (distance signée au barycentre),
    // avec un bonus pour « monter » et pour « aller à gauche » (sens de lecture).
    const up = (cr - r) / BOARD_SIZE;                // >0 si on monte au-dessus de la masse
    const left = (cc - c) / BOARD_SIZE;              // >0 si on va à gauche de la masse
    s += 1.3 * up + 0.7 * left;
  }
  return nt ? s / nt : 0;
}

// ===== Index dictionnaire pour la qualité des appuis (chantiers 2 & 3) =====
// Construit UNE FOIS par dictionnaire (mémoïsé sur l'objet dict), à partir des
// mots de 7 à 9 lettres (les scrabbles) :
//   • supportFreq[L]        : fréquence de la lettre L dans ces mots → « E excellent
//     appui, X mauvais » (tes cas 5, 9, 17) ;
//   • posCount["L|p|len"]   : nb de mots de longueur `len` ayant L en position p,
//     ce qui permet de compter les scrabbles RÉELLEMENT accrochables sur un appui
//     compte tenu de la place libre de part et d'autre (ton cas 7).
function supportIndex(dict) {
  if (dict.__supportIdx) return dict.__supportIdx;
  const supportFreq = {}, posCount = new Map();
  let maxFreq = 1;
  for (const w of (dict.words || [])) {
    const len = w.length;
    if (len < 7 || len > 9) continue;
    const seen = new Set();
    for (let i = 0; i < len; i++) {
      const L = w[i];
      const k = `${L}|${i + 1}|${len}`;
      posCount.set(k, (posCount.get(k) || 0) + 1);
      if (!seen.has(L)) { seen.add(L); supportFreq[L] = (supportFreq[L] || 0) + 1; }
    }
  }
  for (const L in supportFreq) maxFreq = Math.max(maxFreq, supportFreq[L]);
  const idx = { supportFreq, posCount, maxFreq };
  try { Object.defineProperty(dict, "__supportIdx", { value: idx, enumerable: false }); }
  catch { dict.__supportIdx = idx; }
  return idx;
}

// Chantier 2 : qualité MOYENNE des lettres posées comme futurs appuis (0..1).
function scoreSupportLetters(board, move, dict) {
  const { supportFreq, maxFreq } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  let s = 0, n = 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue;
    // Une lettre n'est un appui que si l'axe perpendiculaire offre de la place.
    const pdr = dr ? 0 : 1, pdc = dr ? 1 : 0;
    const free = (rr, cc) => rr >= 0 && rr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE && !board[rr][cc];
    if (!free(r - pdr, c - pdc) && !free(r + pdr, c + pdc)) continue;
    s += (supportFreq[move.word[i]] || 0) / maxFreq;
    n++;
  }
  return n ? s / n : 0;
}

// Chantier 3 : FERTILITÉ des appuis créés — nb de scrabbles (7-9 lettres)
// réellement accrochables sur chaque lettre posée, compte tenu de la place libre
// avant/après dans l'axe perpendiculaire. Remplace le simple « ≥6 cases vides »
// par une mesure lexicale (ton cas 7 : « voyelle + 2 consonnes » ≫ « 3 consonnes »).
function scoreSupportFertility(board, move, dict) {
  const { posCount } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const pdr = dr ? 0 : 1, pdc = dr ? 1 : 0;
  let total = 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue;
    // Place libre de part et d'autre, dans l'axe perpendiculaire.
    let before = 0, after = 0;
    for (let k = 1; k < BOARD_SIZE; k++) {
      const rr = r - k * pdr, cc = c - k * pdc;
      if (rr < 0 || cc < 0 || board[rr][cc]) break;
      before++;
    }
    for (let k = 1; k < BOARD_SIZE; k++) {
      const rr = r + k * pdr, cc = c + k * pdc;
      if (rr >= BOARD_SIZE || cc >= BOARD_SIZE || board[rr][cc]) break;
      after++;
    }
    const L = move.word[i];
    for (let len = 7; len <= 9; len++) {
      for (let p = 1; p <= len; p++) {
        if (p - 1 > before || len - p > after) continue;   // ne rentre pas dans l'espace
        total += posCount.get(`${L}|${p}|${len}`) || 0;
      }
    }
  }
  return total;
}

// ===== Potentiel d'une case comme APPUI (chantier 3 bis) =====
// Constat des annotations : sur deux anagrammes posés aux mêmes cases (TAXEE vs
// EXEAT, GANSENT vs GENANTS), toute mesure globale (somme/moyenne) est invariante
// par permutation — donc incapable de les distinguer. Or le jugement humain est
// POSITIONNEL : « le T et le A sont de meilleurs appuis EN LIGNE B ET C », « les
// départs de scrabble EN J9 ET L9 ». Ce qui compte est donc : quelle lettre tombe
// sur quelle case, et ce que la perpendiculaire de cette case permet.
// On évalue ici le potentiel de la perpendiculaire : valeur des cases bonus
// encore libres et atteignables depuis cette case.
const BONUS_WEIGHT = { T: 4, D: 2.5, t: 2, d: 1.2, "*": 0 };
function perpPotential(board, r, c, wordDir, layout = null) {
  const rows = layout || BOARD_BONUSES;
  const pdr = wordDir === "H" ? 1 : 0;   // perpendiculaire d'un mot horizontal = vertical
  const pdc = wordDir === "H" ? 0 : 1;
  let pot = 0;
  for (const sign of [-1, 1]) {
    for (let k = 1; k < BOARD_SIZE; k++) {
      const rr = r + sign * k * pdr, cc = c + sign * k * pdc;
      if (rr < 0 || rr >= BOARD_SIZE || cc < 0 || cc >= BOARD_SIZE) break;
      if (board[rr][cc]) break;                      // chemin bloqué au-delà
      if (k > 8) break;                              // hors de portée d'un scrabble
      pot += (BONUS_WEIGHT[rows[rr][cc]] || 0.12) / k;   // plus c'est loin, moins ça pèse
    }
  }
  return pot;
}

// Fertilité POSITIONNELLE, case par case : pour chaque lettre posée, combien de
// scrabbles peuvent s'accrocher dessus, pondéré par la qualité de la lettre et le
// potentiel de sa perpendiculaire. Renvoie la liste TRIÉE (décroissante).
// Agréger par SOMME dilue l'information (un bon appui unique se noie parmi les
// médiocres) ; on expose donc aussi le meilleur appui et les deux meilleurs, car
// le jugement humain retient surtout « la » case qui ouvre le jeu.
function fertilityByCell(board, move, dict, layout = null) {
  const { posCount, supportFreq, maxFreq } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const pdr = dr ? 0 : 1, pdc = dr ? 1 : 0;
  const out = [];
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue;
    let before = 0, after = 0;
    for (let k = 1; k < BOARD_SIZE; k++) {
      const rr = r - k * pdr, cc = c - k * pdc;
      if (rr < 0 || cc < 0 || board[rr][cc]) break;
      before++;
    }
    for (let k = 1; k < BOARD_SIZE; k++) {
      const rr = r + k * pdr, cc = c + k * pdc;
      if (rr >= BOARD_SIZE || cc >= BOARD_SIZE || board[rr][cc]) break;
      after++;
    }
    if (!before && !after) continue;                 // pas un appui
    const L = move.word[i];
    let fert = 0;
    for (let len = 7; len <= 9; len++)
      for (let p = 1; p <= len; p++) {
        if (p - 1 > before || len - p > after) continue;
        fert += posCount.get(`${L}|${p}|${len}`) || 0;
      }
    const q = (supportFreq[L] || 0) / maxFreq;        // qualité intrinsèque (E ≫ X)
    out.push(fert * (0.5 + q) * (1 + perpPotential(board, r, c, move.dir, layout)));
  }
  return out.sort((a, b) => b - a);
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
  // Mode Voyelles : le chevalet a 7 « cases » = voyelles tirées (rack) + le reste
  // en consonnes libres. Budget de consonnes = maxPlayed − nb de voyelles.
  const freeConsBudget = opts.freeCons ? Math.max(0, maxTilesUsed - rack.length) : 0;
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
        // Voyelles : les consonnes sont « libres » → le budget de tuiles neuves
        // n'est pas borné par le chevalet (voyelles) mais par maxTilesUsed.
        const tileBudget = opts.freeCons ? maxTilesUsed : rack.length;
        const physicalMax = dir === "H" ? ac : ar;
        for (let step = 1; step <= physicalMax; step++) {
          const tr = ar - step * dr, tc = ac - step * dc;
          if (!board[tr][tc]) {
            newTilesNeeded++;
            if (newTilesNeeded > tileBudget) break;
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
          freeCons: opts.freeCons,
          freeConsBudget,
          consUsed: 0,
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

// Cross-check : en plaçant L sur (r,c) dans le sens `dir`, le mot PERPENDICULAIRE
// formé avec les tuiles déjà posées doit être valide. S'il n'y a aucun voisin
// perpendiculaire, aucune contrainte (true). Élagage sûr, appliqué à tous les
// modes : scoreMove revalide de toute façon les mots croisés en fin de course.
function crossWordOk(board, r, c, L, dir, dict) {
  const pdr = dir === "H" ? 1 : 0;   // perpendiculaire = vertical si mot horizontal
  const pdc = dir === "H" ? 0 : 1;
  let ur = r - pdr, uc = c - pdc, up = "";
  while (ur >= 0 && uc >= 0 && board[ur][uc]) { up = board[ur][uc].letter + up; ur -= pdr; uc -= pdc; }
  let dr2 = r + pdr, dc2 = c + pdc, down = "";
  while (dr2 < BOARD_SIZE && dc2 < BOARD_SIZE && board[dr2][dc2]) { down += board[dr2][dc2].letter; dr2 += pdr; dc2 += pdc; }
  if (!up && !down) return true;   // pas de voisin perpendiculaire
  return dict.has(up + L + down);
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

  // 4bis) Voyelles : consonnes LIBRES (hors chevalet, non consommées) + voyelles
  //       issues du chevalet (consommées). Rack = voyelles seules. Élagage fort
  //       par cross-check : une lettre n'est retenue que si le mot perpendiculaire
  //       qu'elle formerait (avec les tuiles voisines) est valide (ou inexistant).
  if (ctx.freeCons) {
    const triedC = new Set();
    // Consonnes libres : on ne touche pas au chevalet, mais on est borné par le
    // budget (maxPlayed − nb de voyelles). Ex. 5 voyelles → au plus 2 consonnes.
    if ((ctx.consUsed || 0) < ctx.freeConsBudget) {
      for (const L of CONSONANTS_FR) {
        if (triedC.has(L)) continue;
        triedC.add(L);
        if (!crossWordOk(board, r, c, L, dir, dict)) continue;
        extend({
          ...ctx,
          r: r + dr, c: c + dc,
          currentWord: currentWord + L,
          tilesUsed: tilesUsed + 1,
          consUsed: (ctx.consUsed || 0) + 1,
          anchorCovered: anchorCovered || (r === ar && c === ac),
        });
      }
    }
    // Voyelles du chevalet : une par lettre distincte disponible (consommée).
    for (let i = 0; i < rack.length; i++) {
      const tile = rack[i];
      if (triedC.has(tile)) continue;
      triedC.add(tile);
      if (!crossWordOk(board, r, c, tile, dir, dict)) continue;
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
    return;
  }

  // 4) Case vide : essayer chaque lettre du chevalet (sans répéter)
  const tried = new Set();
  for (let i = 0; i < rack.length; i++) {
    const tile = rack[i];
    if (tile === "?") {
      for (let code = 65; code <= 90; code++) {
        const L = String.fromCharCode(code);
        if (tried.has("?" + L)) continue;
        tried.add("?" + L);
        if (!crossWordOk(board, r, c, L, dir, dict)) continue;
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
      if (!crossWordOk(board, r, c, tile, dir, dict)) continue;
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
