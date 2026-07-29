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

import { BOARD_SIZE, BOARD_BONUSES, CENTER, scoreMove, applyMove, LETTER_VALUE, VOWELS, VOWELS_NO_Y, CONSONANTS_FR, isSimplePath, isSnakeMove } from "./engine.js?v=363";

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

// ===== SÉLECTION DE L'ISOTOP : critères pondérés ou tirage au sort =====
// Mesuré sur 2 × 500 parties simulées (mêmes graines de tirage) : les critères
// n'apportent rien de sensible au déroulement d'une partie — score, longueur,
// scrabbles et trouvabilité du top sont statistiquement identiques à un tirage au
// sort. Seule l'ouverture de la grille gagne ~5 % (p = 0,005), pour une taille
// d'effet de 0,16 écart-type. La raison est structurelle : dans 73 % des tours il
// n'y a qu'UN SEUL top, donc les critères n'ont voix au chapitre que sur 27 % des
// coups — plafond qu'aucun réglage ne peut franchir.
// D'où ce choix : ISOTOP_RANDOM = true → l'isotop est tiré au sort.
// Une seule ligne à repasser à false pour retrouver les critères pondérés (le code
// de `sortTiedIsotops` est conservé intact et reste utilisé par le mode éditeur).
// Le top est figé à la GÉNÉRATION du tournoi puis stocké : tous les joueurs d'un
// même tournoi voient donc bien le même top, l'aléa ne joue qu'une fois.
export const ISOTOP_RANDOM = true;

export function findTopRanked(board, rack, dict, bag = null, opts = {}) {
  const all = findTop(board, rack, dict, { all: true, ...opts }) || [];
  if (!all.length) return null;
  const top = all[0].score;
  const tied = all.filter(c => c.score === top);
  const isotopWords = [...new Set(tied.map(c => c.move.word))];
  if (tied.length === 1) return { ...tied[0], isotops: 1, isotopWords };

  if (ISOTOP_RANDOM) {
    const pick = tied[Math.floor(Math.random() * tied.length)];
    return { ...pick, isotops: tied.length, isotopWords };
  }
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
    _dictExt:   scoreDictExtensibility(c.move.word, dict), // rallonges 1 lettre dans le dico
    // 1er coup : pour un mot de 3 lettres, on privilégie le placement qui pose
    // sur le centre la lettre la PLUS fréquente en bord (début/fin) de mot de 8
    // lettres — c'est par le centre que passe le futur scrabble vertical (8A/8H).
    // Ex. DEY : on centre sur E (fréquent en bord de 8) plutôt que Y (rare).
    _centerL:   isFirstMove ? centerLetterScore(c.move, dict, board) : 0,
    // À nombre de rallonges égal, on préfère les rallonges FINALES (le mot est
    // posé à gauche, sens de lecture). Ex. SENTIRA (rallonge finale) > ENTRAIS
    // (benjamins) pour AEINRST.
    _twAccess:  scoreTWAccess(board, c.move),              // nb de cases TW libres atteignables après ce coup
    // ----- Critères affinés (chantiers 1-5) -----
    _dictExtR:  scoreDictExtensibility(c.move.word, dict, board, c.move), // rallonges RÉELLEMENT jouables
    _dictExtBag: scoreDictExtensibilityBag(c.move.word, dict, board, c.move, bag), // idem, pondérées par le sac
    _bonusReach: scoreBonusReach(board, c.move, dict, opts.layout), // rallonges multi-lettres atteignant une TW/DW
    _nonuple:   scoreNonuple(board, c.move, dict),         // probabilité de nonuple créée (mots de 8 lettres au bon rang)
    _collante:  scoreCollante(board, c.move, dict),        // facilité de coller un mot parallèle
    _endL:      scoreEndLetters(board, c.move, dict),      // lettres extrêmes ouvrantes/fermantes (généralise « Q en bout »)
    _appui:     scoreAppuiQuality(board, c.move, dict),
    _lateral:   scoreLateralAccess(board, c.move, dict),   // peut-on jouer À CÔTÉ ? (E ouvre, P ferme)
    _bonusPivot: scoreBonusPivot(board, c.move, dict),     // pivot en 2 lettres vers une DW/TW bordant une extrémité
    _bagBal:    scoreBagBalance(board, c.move, bag, opts.moveNo), // équilibre voyelles/consonnes du sac (au-delà du coup 15)
    _quadBal:   scoreQuadrantBalance(board, c.move),       // ouverture par quarts de grille (pose-t-on là où c'est vide ?)
    _edgeKill:  countEdgeCondemned(c.move.word, dict, board, c.move), // nb d'axes de bord condamnés (case morte en colonne 1/15 ou ligne A/O)
    // --- 1er coup : hiérarchie dédiée (position → rallonges → accès H1/H15) ---
    _fmPos:     isFirstMove ? firstMovePosScore(c.move) : 0,
    _fmReach:   isFirstMove ? firstMoveReachTW(c.move, dict) : 0,
    // Base de l'étage hiérarchique : rallonges à la fois jouables (case libre) ET
    // disponibles (lettre encore dans le sac / le reliquat, ou joker).
    _extPlayable: countPlayableExtensions(c.move.word, dict, board, c.move, bag, rack),
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
      nonuple: Math.min(1, Math.log1p(c._nonuple || 0) / Math.log1p(9000)),
      collante: Math.min(1, (c._collante || 0) / 40),
      appui: c._appui || 0,
      quadBal: Math.min(1, (c._quadBal || 0) / 2.5),
      endL: c._endL || 0,
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
      centerL: Math.min(1, (c._centerL || 0)),
      left:    Math.max(-1, Math.min(1, (c._left || 0) / 8)),
    };
    c._pertinence = isFirstMove
      // 1er coup : la POSITION (règle 1) et les RALLONGES (règle 2) sont traitées
      // en étages hiérarchiques ci-dessous ; ne reste ici que la règle 3 (accès aux
      // triples H1/H15 par benjamin, superbenjamin ou rallonge finale), complétée
      // par quelques appoints de moindre importance.
      ? (3.0 * Math.min(1, (c._fmReach || 0) / 12)
         + 0.4 * n.supportL + 0.3 * n.fert)
      // Modèle COMPACT calibré sur 45 cas annotés (3 lots), validé en croisé
      // (calage sur 2 lots, test sur le 3e) : peu de features, car un modèle à 14
      // poids sur-apprenait. Toutes correspondent à un critère cité explicitement
      // dans les annotations.
      //   collante : « la collante est plus facile sous VA que sous VU » ;
      //   nonuple  : mesuré NEUTRE sur le corpus actuel (il est largement
      //              redondant avec l'accès aux triples) mais conservé à poids
      //              modéré pour son sens de jeu — au-delà de 2, il dégrade.
      // NB : le comptage fin des rallonges (dictExtBag) est CONSERVÉ ici en plus de
      // l'étage. Ce n'est pas un doublon : l'étage ne distingue que trois paliers
      // (aucune / 1-2 / 3 et plus) ; à l'intérieur d'un palier, le comptage pondéré
      // par le sac départage encore utilement. Mesuré : le retirer coûte 2 cas
      // (36/45 → 34/45), tout le déficit venant du lot 2.
      // `endL` (lettres extrêmes ouvrantes/fermantes, qui généralise « Q pas en bout
      // de mot ») est calculé mais NON pondéré : mesuré non contributif, son meilleur
      // poids est 0 et il dégrade dès 1,0 — les rallonges capturent déjà l'essentiel
      // de cette idée (un mot finissant par V ou W n'a pas de rallonge).
      // `appui` applique la règle formalisée des lettres d'appui (écarte pivots,
      // collantes et lettres gênées par une diagonale, exige ≥8 cases libres, puis
      // départage sur la fréquence des lettres retenues). Elle relève de
      // l'ouverture de la grille, critère prépondérant, d'où un poids notable.
      // ===== SCORE UNIQUE, BARÈME SUR ÉCHELLE UNIFORME (milieu de partie) =====
      // Hormis les deux verrous, TOUS les critères sont convertis en points et
      // additionnés : le meilleur total gagne, sans étage intermédiaire.
      // Chaque critère est d'abord ramené sur 0..1 (bornes ci-dessous), de sorte que
      // son poids se lise directement comme « nombre de points maximum apportés ».
      // Les poids sont donc COMPARABLES entre eux : 8,7 pèse trois fois plus que 2,6.
      // Mesuré équivalent au barème en unités naturelles (38/45) mais lisible.
      // Chaque critère est ramené sur 0..1 par un cadrage min→max reflétant les
      // valeurs réellement rencontrées (un critère dont les valeurs utiles vont de
      // 0,25 à 1 est recadré sur toute la plage, sinon un quart des points serait
      // acquis d'office et ne départagerait rien).
      // Les poids suivent l'ORDRE D'IMPORTANCE fixé pour le jeu, en décroissance
      // forte — profil retenu parmi six testés (linéaire, douce, ÷2, écart au
      // sommet, plateau) : c'est celui qui exploite le mieux cet ordre.
      : (15   * Math.min(1, (c._extPlayable || 0) * ((c._edgeKill || 0) > 0 ? 0.5 : 1) / 4)  // rallonges (½ si un axe de bord est condamné)
        + 10  * n.twReal                                        // accès réels aux triples (peut être négatif)
        +  7  * Math.max(0, (n.quadBal - 0.03) / 0.97)          // ouverture par quarts de grille
        +  5  * Math.max(0, (n.open - 0.25) / 0.75)             // ouverture brute (cases vides adjacentes)
        +  3.5 * Math.min(1, n.bonusReach / 0.79)               // portée bonus (rallonge multi-lettres vers une TW/DW)
        +  2.5 * n.fertMax                                      // meilleur appui créé
        +  1.7 * n.appui                                        // appuis filtrés (hors pivot/collante/diagonale, ≥8 cases)
        +  1.2 * Math.max(0, (n.collante - 0.21) / 0.79)        // facilité de collante
        +  0.6 * Math.min(1, (c._bonusPivot || 0) / 30)         // meilleur pivot en 2 lettres vers une DW/TW bordante
        +  0.8 * n.nonuple                                      // nonuple probable
        +  0.4 * Math.min(1, (c._dictExtBag || 0) / 4)          // rallonges pondérées par le sac
        );
  }
  // Au 1er COUP seulement, le nombre de rallonges reste un étage au-dessus du
  // score : la grille est vide, les autres critères sont peu discriminants, et la
  // règle de départ est explicite (rallonge d'abord, puis position).
  // En milieu de partie il n'y a PLUS d'étage : tous les critères, rallonges
  // comprises, sont convertis en points dans _pertinence (voir plus haut).
  for (const c of scored) {
    c._extTier = isFirstMove ? (c._dictExt || 0) : 0;
  }
  scored.sort((a, b) =>
    // --- verrous non négociables ---
    b._endsGame - a._endsGame ||
    b._noJoker - a._noJoker ||
    // --- 1er coup uniquement : nombre de rallonges, avant la position ---
    b._extTier - a._extTier ||
    // --- 1er coup : parmi les candidats restants, le placement (à gauche, ou la
    //     bonne lettre sur l'étoile pour les mots de 2-3 lettres) ---
    b._fmPos - a._fmPos ||
    // --- score de pertinence (compromis pondéré), quantifié au pas TIE_EPS :
    //     deux candidats dont les scores tiennent dans le même palier sont
    //     considérés comme indécidables au score, et c'est l'équilibre
    //     voyelles/consonnes du sac qui les départage (fin de partie seulement).
    //     La quantification garde le comparateur transitif.
    Math.round(b._pertinence / TIE_EPS) - Math.round(a._pertinence / TIE_EPS) ||
    b._bagBal - a._bagBal ||
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



// Renvoie 1 si le mot peut être rallongé d'une lettre AVANT (préfixe valide L+word)
// ET d'une lettre APRÈS (suffixe valide word+L). Sinon 0.
// Utile au 1er coup pour privilégier les mots ouverts des 2 côtés.

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

// ===== Rallonges JOUABLES ET DISPONIBLES (base de l'étage hiérarchique) =====
// Une rallonge ne « compte » que si elle est doublement possible :
//   • physiquement — la case avant / après le mot est libre sur la grille ;
//   • matériellement — la lettre nécessaire est encore disponible (sac, chevalet
//     conservé ou joker). Une rallonge en C alors qu'il n'y a plus de C en jeu
//     n'est pas une rallonge.
// Les lettres à exemplaire unique dans le sac (J K Q W X Y Z) ne comptent que
// pour MOITIÉ : « le Z, qui est une lettre très rare, ne peut pas faire basculer
// à lui seul la balance des rallonges ». BIPE admet E R S Z (4 → 3,5) et ne
// dépasse donc plus EMBUA / PAUMA sur le seul mérite du Z.
const RARE_LETTERS = new Set(["J", "K", "Q", "W", "X", "Y", "Z"]);
function countPlayableExtensions(word, dict, board, move, bag, rack) {
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const free = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && !board[r][c];
  const canBefore = free(move.row - dr, move.col - dc);
  const canAfter = free(move.row + word.length * dr, move.col + word.length * dc);
  if (!canBefore && !canAfter) return 0;
  // Lettres encore disponibles : sac + reliquat du chevalet (hors lettres posées).
  let avail = null;
  if (bag) {
    avail = { ...bag };
    for (const L of (rack || [])) avail[L] = (avail[L] || 0) + 1;
    // retirer les lettres consommées par ce coup
    for (let i = 0; i < word.length; i++) {
      const r = move.row + i * dr, c = move.col + i * dc;
      if (board[r][c]) continue;
      const L = (move.blanks || []).includes(i) ? "?" : word[i];
      if (avail[L] > 0) avail[L]--;
    }
  }
  const jokers = avail ? (avail["?"] || 0) : 1;
  let n = 0;
  for (let code = 65; code <= 90; code++) {
    const L = String.fromCharCode(code);
    if (avail && !(avail[L] || 0) && !jokers) continue;   // lettre épuisée
    const w = RARE_LETTERS.has(L) ? 0.5 : 1;
    if (canAfter && dict.has(word + L)) n += w;
    if (canBefore && dict.has(L + word)) n += w;
  }
  return n;
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
  // Index des collantes : pour une lettre L déjà posée,
  //   twoAfter[L]  = nb de lettres X telles que L+X soit un mot de 2 lettres
  //                  (X se colle en dessous / à droite) ;
  //   twoBefore[L] = nb de X telles que X+L soit un mot de 2 lettres ;
  //   three[L|p]   = nb de mots de 3 lettres ayant L en position p.
  // « Si le mot n'est en pivot que sur une lettre, on regarde les mots de 2
  // lettres au-dessus et en dessous ; si on colle sur au moins deux lettres, ce
  // sont les lettres transformant ces mots de 2 en mots de 3 qui comptent. »
  const twoAfter = {}, twoBefore = {}, three = new Map();
  // Fréquence d'une lettre en DÉBUT et en FIN de mot (sur les mots de 4 lettres et
  // plus). Généralise l'ancien critère « Q pas en bout de mot » : une lettre rare
  // en finale (Q, V, W, B) ferme le mot — même logique, mais valable pour toutes
  // les lettres au lieu d'un cas codé en dur.
  const startFreq = {}, endFreq = {};
  let maxStart = 1, maxEnd = 1;
  for (const w of (dict.words || [])) {
    const len = w.length;
    if (len >= 4) {
      startFreq[w[0]] = (startFreq[w[0]] || 0) + 1;
      endFreq[w[len - 1]] = (endFreq[w[len - 1]] || 0) + 1;
    }
    if (len === 2) {
      twoAfter[w[0]] = (twoAfter[w[0]] || 0) + 1;
      twoBefore[w[1]] = (twoBefore[w[1]] || 0) + 1;
      continue;
    }
    if (len === 3) {
      for (let i = 0; i < 3; i++) {
        const k = `${w[i]}|${i + 1}`;
        three.set(k, (three.get(k) || 0) + 1);
      }
      continue;
    }
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
  for (const L in startFreq) maxStart = Math.max(maxStart, startFreq[L]);
  for (const L in endFreq) maxEnd = Math.max(maxEnd, endFreq[L]);
  const idx = { supportFreq, posCount, maxFreq, twoAfter, twoBefore, three,
                startFreq, endFreq, maxStart, maxEnd };
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

// ============================================================
//  PREMIER COUP — hiérarchie dédiée
//  Ordre d'importance (règles de jeu explicitées) :
//    1. RALLONGE d'une lettre, initiale ou finale (étage par paliers).
//    2. POSITION, entre les candidats restants : mot de 4 lettres et plus → le
//       plus à gauche possible ; mot de 3 lettres → position centrée, sauf si un
//       décalage permet de poser sur l'étoile une lettre de AEILNRST ; mot de
//       2 lettres → on privilégie aussi la bonne lettre sur l'étoile.
//    3. ACCÈS À H1 / H15 (les deux triples de la ligne de départ) : par benjamin
//       (lettres devant, GUI-MAUVE), superbenjamin (devant et derrière,
//       PRE-TENDU-MENT) ou rallonge finale (INDEX-ENT).
// ============================================================
const CORE8 = new Set(["A", "E", "I", "L", "N", "R", "S", "T"]);

// Règle 1 — score de position. Valeurs discrètes : cet étage doit trancher net.
function firstMovePosScore(move) {
  const n = move.word.length;
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  // Index, dans le mot, de la lettre posée sur l'étoile centrale.
  const starIdx = dr ? CENTER - move.row : CENTER - move.col;
  const starCore = starIdx >= 0 && starIdx < n && CORE8.has(move.word[starIdx]);
  const start = dr ? move.row : move.col;
  if (n >= 4) {
    // Le plus à gauche (ou le plus haut) possible : start minimal.
    return 100 - start * 4;
  }
  // Mots de 2 et 3 lettres : une lettre de AEILNRST sur l'étoile prime.
  let s = starCore ? 60 : 0;
  // À défaut, pour un mot de 3 lettres, la position centrée (étoile au milieu).
  if (n === 3 && start === CENTER - 1) s += 12;
  return s;
}

// Règle 3 — accès aux triples H1 / H15 de la ligne de départ, par prolongement du
// mot vers l'avant (benjamin), l'arrière (rallonge finale) ou les deux
// (superbenjamin). On compte les mots du dictionnaire qui réalisent ce
// prolongement, en pondérant par 1/nombre de lettres à ajouter : un benjamin de
// 3 lettres est bien plus probable qu'un prolongement de 6.
function firstMoveReachTW(move, dict) {
  const n = move.word.length;
  const start = move.dir === "V" ? move.row : move.col;
  const kFront = start;                     // lettres nécessaires pour atteindre la case 1
  const kBack = BOARD_SIZE - 1 - (start + n - 1);   // ... pour atteindre la case 15
  const w = move.word;
  let score = 0;
  // --- vers H1 : mots FINISSANT par w, de longueur n + kFront ---
  if (kFront > 0 && kFront <= 7) {
    const rev = reversedIndex(dict);
    const wRev = w.split("").reverse().join("");
    const [a, b] = countWithPrefix(rev, wRev);
    let cnt = 0;
    for (let i = a; i < b; i++) if (rev[i].length === n + kFront) cnt++;
    score += cnt / kFront;
  }
  // --- vers H15 : mots COMMENÇANT par w, de longueur n + kBack ---
  if (kBack > 0 && kBack <= 7) {
    const [a, b] = countWithPrefix(dict.words, w);
    let cnt = 0;
    for (let i = a; i < b; i++) if (dict.words[i].length === n + kBack) cnt++;
    score += cnt / kBack;
  }
  // --- superbenjamin : un mot de 15 lettres contenant w à la bonne position,
  //     donc atteignant les DEUX triples d'un coup. Rare, donc fortement valorisé.
  if (kFront > 0 && kBack > 0 && kFront + n + kBack === BOARD_SIZE) {
    const [a, b] = countWithPrefix(dict.words, w.slice(0, 1));
    let cnt = 0;
    for (let i = a; i < b && cnt < 3; i++) {
      const cand = dict.words[i];
      if (cand.length === BOARD_SIZE && cand.substr(kFront, n) === w) cnt++;
    }
    score += 3 * cnt;
  }
  return score;
}

// ===== CONDAMNATION D'UNE LIGNE / COLONNE DE BORD =====
// « A, B et C condamnent la colonne 1 » : si le mot posé laisse, juste avant ou
// juste après lui, une case VIDE située sur un bord (colonne 1 ou 15, ligne A ou O)
// et qu'AUCUNE lettre ne peut y être posée — parce qu'il n'existe aucune rallonge
// valide du mot — alors cette case devient morte. Or elle commande tout l'axe du
// bord, donc l'accès aux DEUX triples de cet axe : c'est une faute lourde, pas un
// simple malus. Renvoie le nombre d'axes de bord ainsi condamnés.
function countEdgeCondemned(word, dict, board, move) {
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const inside = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  const onEdge = (r, c) => r === 0 || r === BOARD_SIZE - 1 || c === 0 || c === BOARD_SIZE - 1;
  let n = 0;
  // Case juste AVANT le mot
  const br = move.row - dr, bc = move.col - dc;
  if (inside(br, bc) && !board[br][bc] && onEdge(br, bc)) {
    let can = false;
    for (let code = 65; code <= 90 && !can; code++) {
      if (dict.has(String.fromCharCode(code) + word)) can = true;
    }
    if (!can) n++;
  }
  // Case juste APRÈS le mot
  const ar = move.row + word.length * dr, ac = move.col + word.length * dc;
  if (inside(ar, ac) && !board[ar][ac] && onEdge(ar, ac)) {
    let can = false;
    for (let code = 65; code <= 90 && !can; code++) {
      if (dict.has(word + String.fromCharCode(code))) can = true;
    }
    if (!can) n++;
  }
  return n;
}

// ===== OUVERTURE / FERMETURE PAR QUARTS DE GRILLE (règle formalisée) =====
// La grille est découpée en quatre quarts (haut-gauche, haut-droit, bas-gauche,
// bas-droit). Un coup « ouvre » le jeu quand il pose ses lettres dans un quart
// encore peu peuplé, et le « ferme » quand il s'entasse là où il y a déjà tout.
// Exemple donné : à critères prédominants égaux, entre un coup qui ajoute 4
// lettres dans un quart qui en compte déjà 15 et un coup qui en ajoute 5 dans un
// quart qui n'en compte que 3, on préfère le second.
// On somme donc, par quart impacté, les lettres ajoutées pondérées par la rareté
// du quart : added / (1 + déjà présentes).
// Cette formulation couvre aussi le cas du 2e coup (« si vertical, ouvrir vers le
// haut ; si horizontal, vers la droite ») : le quart vide est simplement celui qui
// pèse le plus lourd dans la pondération.
function quadOf(r, c) { return (r <= 7 ? 0 : 2) + (c <= 7 ? 0 : 1); }
function scoreQuadrantBalance(board, move) {
  const counts = [0, 0, 0, 0];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c]) counts[quadOf(r, c)]++;
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const added = [0, 0, 0, 0];
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (!board[r][c]) added[quadOf(r, c)]++;
  }
  let s = 0;
  for (let q = 0; q < 4; q++) if (added[q]) s += added[q] / (1 + counts[q]);
  return s;
}

// ===== ACCÈS LATÉRAL : peut-on jouer À CÔTÉ de chaque lettre posée ? =====
// « Avec PAUMA on ne peut pas jouer à gauche du P pour rejoindre la case 4A » : une
// lettre posée borde un espace libre dans l'axe perpendiculaire, et c'est ELLE qui
// devra terminer (espace à gauche / en haut) ou commencer (espace à droite / en bas)
// le futur mot. Or très peu de mots finissent par P, alors que beaucoup finissent
// par E — le E ouvre donc le jeu là où le P le ferme.
// On mesure, lettre par lettre, la fréquence de la lettre dans la bonne position
// (finale ou initiale), pondérée par l'espace réellement disponible de ce côté.
// Contrairement à scoreAppuiQuality, qui moyenne sur les lettres retenues, ce
// critère additionne : une seule très bonne lettre bien placée suffit à ouvrir.
function scoreLateralAccess(board, move, dict) {
  const { startFreq, endFreq, maxStart, maxEnd } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const pdr = dr ? 0 : 1, pdc = dr ? 1 : 0;      // axe perpendiculaire
  let s = 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue;                   // lettre déjà en place
    const L = move.word[i];
    let before = 0, after = 0;
    for (let k = 1; k <= 7; k++) {
      const rr = r - k * pdr, cc = c - k * pdc;
      if (rr < 0 || cc < 0 || board[rr][cc]) break;
      before++;
    }
    for (let k = 1; k <= 7; k++) {
      const rr = r + k * pdr, cc = c + k * pdc;
      if (rr >= BOARD_SIZE || cc >= BOARD_SIZE || board[rr][cc]) break;
      after++;
    }
    // Espace en amont → la lettre servira de FIN de mot ; en aval → de DÉBUT.
    if (before >= 2) s += ((endFreq[L] || 0) / maxEnd) * Math.min(before, 6) / 6;
    if (after >= 2) s += ((startFreq[L] || 0) / maxStart) * Math.min(after, 6) / 6;
  }
  return s;
}

// ===== QUALITÉ DES LETTRES D'APPUI (règle formalisée) =====
// Toutes les lettres d'un mot ne sont pas des appuis utilisables pour un futur
// scrabble. On les trie ainsi :
//   • lettre en PIVOT (contact avec une lettre de la grille) ou en COLLANTE
//     (plusieurs contacts) → mauvais appui, écartée ;
//   • lettre ayant une lettre de la grille EN DIAGONALE → écartée aussi : un mot
//     perpendiculaire partant de cette lettre buterait sur la diagonale, qui
//     impose alors un mot croisé — c'est une contrainte de plus ;
//   • lettres restantes → il faut au moins 8 cases libres dans l'axe
//     perpendiculaire, réparties de part et d'autre (3+5, 6+2, 2+6…), pour qu'un
//     scrabble puisse réellement s'y accrocher.
// Le départage se fait ensuite sur la FRÉQUENCE de ces lettres dans la langue :
// TAXEE (appuis T, A) vaut mieux que EXEAT (appuis E, X), le X étant rare.
function scoreAppuiQuality(board, move, dict) {
  const { supportFreq, maxFreq } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const pdr = dr ? 0 : 1, pdc = dr ? 1 : 0;   // axe perpendiculaire
  const on = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && !!board[r][c];
  let total = 0, kept = 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue;                       // lettre déjà en place
    // Pivot / collante : contact orthogonal avec une lettre préexistante.
    if (on(r - 1, c) || on(r + 1, c) || on(r, c - 1) || on(r, c + 1)) continue;
    // Contrainte diagonale.
    if (on(r - 1, c - 1) || on(r - 1, c + 1) || on(r + 1, c - 1) || on(r + 1, c + 1)) continue;
    // Place disponible dans l'axe perpendiculaire.
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
    if (before + after < 8) continue;                // pas de quoi loger un scrabble
    total += (supportFreq[move.word[i]] || 0) / maxFreq;
    kept++;
  }
  return kept ? total / kept : 0;                    // qualité MOYENNE des appuis retenus
}

// ===== Qualité des lettres EXTRÊMES du mot posé =====
// Remplace l'ancien « Q pas en bout de mot », cas particulier codé en dur : le
// principe est général, « c'est la même logique que la probabilité d'un mot se
// terminant par V, W ou B ». Une lettre rare en finale (ou en initiale) ferme le
// mot ; on ne le mesure que sur les extrémités OUVERTES (case libre au-delà),
// puisqu'une extrémité bloquée par une tuile ne se prolongera de toute façon pas.
function scoreEndLetters(board, move, dict) {
  const { startFreq, endFreq, maxStart, maxEnd } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const w = move.word;
  const free = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && !board[r][c];
  let s = 0, n = 0;
  if (free(move.row - dr, move.col - dc)) {
    s += (startFreq[w[0]] || 0) / maxStart; n++;
  }
  if (free(move.row + w.length * dr, move.col + w.length * dc)) {
    s += (endFreq[w[w.length - 1]] || 0) / maxEnd; n++;
  }
  return n ? s / n : 0;
}

// ===== NONUPLE probable =====
// Un nonuple = mot de 8 lettres reliant DEUX cases mot-compte-triple : sur le
// plateau standard, les segments concernés sont les demi-lignes A et O et les
// demi-colonnes 1 et 15 (8 cases chacune). Règle donnée par l'annotation : ce qui
// départage, c'est la position de la lettre dans la langue — « entre E et V en A7,
// on choisit E car il y a plus de mots de 8 lettres avec un E en rang 7 ».
// On compte donc, pour chaque lettre posée dans un tel segment (les 7 autres cases
// devant être libres), le nombre de mots de 8 lettres portant cette lettre à ce rang.
const NONUPLE_SEGMENTS = (() => {
  const segs = [];
  const line = (r, c0) => Array.from({ length: 8 }, (_, i) => [r, c0 + i]);
  const col = (c, r0) => Array.from({ length: 8 }, (_, i) => [r0 + i, c]);
  for (const r of [0, 14]) { segs.push(line(r, 0)); segs.push(line(r, 7)); }
  for (const c of [0, 14]) { segs.push(col(c, 0)); segs.push(col(c, 7)); }
  return segs;
})();
function scoreNonuple(board, move, dict) {
  const { posCount } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const placed = [];
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (!board[r][c]) placed.push({ r, c, L: move.word[i] });
  }
  if (!placed.length) return 0;
  const after = applyMove(board, move);
  let best = 0;
  for (const seg of NONUPLE_SEGMENTS) {
    for (const p of placed) {
      const idx = seg.findIndex(([sr, sc]) => sr === p.r && sc === p.c);
      if (idx === -1) continue;
      // Les 7 autres cases du segment doivent être libres APRÈS le coup : sinon le
      // mot de 8 lettres ne pourra plus s'y déployer.
      let free = true;
      for (let k = 0; k < 8; k++) {
        if (k === idx) continue;
        const [sr, sc] = seg[k];
        if (after[sr][sc]) { free = false; break; }
      }
      if (!free) continue;
      best = Math.max(best, posCount.get(`${p.L}|${idx + 1}|8`) || 0);
    }
  }
  return best;
}

// ===== COLLANTE : facilité de coller un mot parallèle =====
// « Plus facile sous VA que sous VU » : ce qui compte est, pour chaque lettre
// posée, le nombre de lettres qui peuvent venir au contact en formant un mot de
// 2 lettres valide (au-dessus et en dessous). Et quand le contact porte sur
// PLUSIEURS lettres consécutives, ce sont les lettres transformant ces mots de 2
// en mots de 3 qui comptent → on ajoute alors la composante « mots de 3 lettres ».
function scoreCollante(board, move, dict) {
  const { twoAfter, twoBefore, three } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const pdr = dr ? 0 : 1, pdc = dr ? 1 : 0;   // axe perpendiculaire (celui de la collante)
  let total = 0, n = 0, runLen = 0, runScore = 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) { runLen = 0; continue; }   // lettre déjà là : coupe la série
    const L = move.word[i];
    const freeUp = r - pdr >= 0 && c - pdc >= 0 && !board[r - pdr][c - pdc];
    const freeDown = r + pdr < BOARD_SIZE && c + pdc < BOARD_SIZE && !board[r + pdr][c + pdc];
    if (!freeUp && !freeDown) { runLen = 0; continue; }
    // Perméabilité en mots de 2 lettres, des deux côtés disponibles.
    let s = (freeDown ? (twoAfter[L] || 0) : 0) + (freeUp ? (twoBefore[L] || 0) : 0);
    // Contact sur ≥2 lettres consécutives : on regarde aussi les mots de 3 lettres.
    runLen++;
    if (runLen >= 2) {
      s += 0.35 * (((three.get(`${L}|2`) || 0) + (three.get(`${L}|1`) || 0) + (three.get(`${L}|3`) || 0)) / 3);
      runScore += s;
    }
    total += s; n++;
  }
  if (!n) return 0;
  // Moyenne par lettre (la collante bute sur le maillon faible), majorée si une
  // série de contacts est possible.
  return total / n + 0.4 * (runScore / n);
}

// ===== PIVOT VERS UNE CASE MOT COMPTE DOUBLE / TRIPLE =====
// « Si la première ou la dernière lettre de deux isotops se trouve à côté d'une
// case DW ou TW, on privilégie l'isotop qui offre le plus de possibilités de mots
// de 2 lettres permettant de rejoindre cette case (le meilleur pivot). »
// Cas 6 du lot 2 : le E de EMBUA borde la DW et accepte 12 mots de 2 lettres
// finissant par E (BE CE DE HE JE LE ME NE RE SE TE VE) ; le P de PAUMA, aucun.
// Seuls les multiplicateurs de MOT comptent (T/D majuscules), pas les cases
// lettre compte double/triple.
function scoreBonusPivot(board, move, dict) {
  const { twoAfter, twoBefore } = supportIndex(dict);
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  const pdr = dr ? 0 : 1, pdc = dr ? 1 : 0;   // axe perpendiculaire
  const free = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && !board[r][c];
  const mult = (r, c) => {
    const b = BOARD_BONUSES[r][c];
    return b === "T" ? 3 : b === "D" ? 2 : 0;   // MOT compte triple / double seulement
  };
  let total = 0;
  // Extrémités du mot posé : première et dernière lettre.
  for (const i of [0, move.word.length - 1]) {
    const r = move.row + i * dr, c = move.col + i * dc;
    const L = move.word[i];
    // En amont sur l'axe perpendiculaire : le mot de 2 lettres FINIT par L.
    const ur = r - pdr, uc = c - pdc;
    if (free(ur, uc) && mult(ur, uc)) total += mult(ur, uc) * (twoBefore[L] || 0);
    // En aval : le mot de 2 lettres COMMENCE par L.
    const dr2 = r + pdr, dc2 = c + pdc;
    if (free(dr2, dc2) && mult(dr2, dc2)) total += mult(dr2, dc2) * (twoAfter[L] || 0);
  }
  return total;
}

// ===== ÉQUILIBRE VOYELLES / CONSONNES DU SAC (fin de partie) =====
// « Au-delà du coup 15, il faut consulter le sac pour garder un équilibre dans la
// répartition des voyelles d'un côté et des consonnes de l'autre. Si l'un des
// isotops permet de placer deux A alors qu'il en reste 7 dans le sac, plutôt que
// deux E quand il n'en reste que 3, on privilégie les A. »
// On se débarrasse donc en priorité des lettres encore ABONDANTES, ce qui laisse
// les lettres devenues rares disponibles pour la suite. Voyelles et consonnes sont
// traitées séparément : une moyenne par famille, puis la moyenne des familles
// présentes — sinon un mot riche en consonnes serait avantagé par son seul nombre.
const BALANCE_FROM_MOVE = 15;
// Pas de quantification du score de pertinence : en deçà, deux isotops sont jugés
// indécidables au score et passent à l'étage de départage (équilibre du sac).
const TIE_EPS = 0.5;
function scoreBagBalance(board, move, bag, moveNo) {
  if (!bag || !moveNo || moveNo <= BALANCE_FROM_MOVE) return 0;
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  let vSum = 0, vN = 0, cSum = 0, cN = 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (board[r][c]) continue;                          // lettre déjà sur la grille
    if ((move.blanks || []).includes(i)) continue;      // un joker n'a pas de famille
    const L = move.word[i];
    const left = bag[L] || 0;                           // exemplaires encore au sac
    if (VOWELS_NO_Y.has(L)) { vSum += left; vN++; }
    else { cSum += left; cN++; }
  }
  if (!vN && !cN) return 0;
  // Normalisation par famille : le A est la voyelle la plus nombreuse (9), le S la
  // consonne la plus nombreuse (6) — on ramène chaque moyenne sur [0,1].
  const parts = [];
  if (vN) parts.push(Math.min(1, (vSum / vN) / 9));
  if (cN) parts.push(Math.min(1, (cSum / cN) / 6));
  return parts.reduce((a, b) => a + b, 0) / parts.length;
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
