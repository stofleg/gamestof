// ============================================================
//  Générateur de partie pré-tirée
//
//  Joue toute la partie en arrière-plan : à chaque coup, tire un
//  chevalet selon la règle FFSC, calcule le top, applique le top,
//  jusqu'à épuisement (voyelles ou consonnes).
//  Retourne la séquence complète, prête à être stockée en base.
// ============================================================

import {
  emptyBoard, LETTER_BAG, drawForDuplicate, applyMove,
  bagTotalVowels, bagTotalConsonants, GAME_MODES, randomBoardLayout, snakeEndpointsAfter, gigogneRackSize,
  bagFor, valuesFor, setLetterValues, LETTER_VALUE, isCrossingCell, wordHiddenCount,
  drawVowelRack, MARATHON_GAMES,
} from "./engine.js?v=348";
import { findTopRanked, findTop, snakeBestTop } from "./topfinder.js?v=348";

const VOWELS_GEN = new Set(["A", "E", "I", "O", "U", "Y"]);

/**
 * Génère une partie complète.
 *
 * @param {object} dict — Dictionary chargé
 * @param {object} options
 * @param {string} options.mode — duplicate | 7sur8 | 7et8 | 789
 * @param {boolean} options.withJoker — mode joker (6 lettres + 1 joker imposé)
 * @param {(progress:number)=>void} [onProgress] — callback (0..1) pour l'UI
 * @returns {object} { moves: [...], totalTopScore }
 */
export function generateGame(dict, options = {}, onProgress = null) {
  const modeKey = options.mode || "duplicate";
  const mode = GAME_MODES[modeKey] || GAME_MODES.duplicate;

  // Marathon : une « partie » = MARATHON_GAMES parties duplicate enchaînées. On
  // génère chaque sous-partie en duplicate et on concatène leurs coups ; le 1er
  // coup de chaque sous-partie (sauf la 1re) porte `newGame:true` (→ remise à zéro
  // du plateau au rejeu). Chaque coup est étiqueté de son n° de sous-partie `g`.
  if (mode.marathon) {
    const allMoves = [];
    let totalTop = 0;
    for (let g = 0; g < MARATHON_GAMES; g++) {
      const sub = generateGame(dict, { ...options, mode: "duplicate" }, null);
      (sub.moves || []).forEach((mv, i) => {
        allMoves.push({ ...mv, g: g + 1, ...(g > 0 && i === 0 ? { newGame: true } : {}) });
      });
      totalTop += sub.totalTopScore || 0;
      if (onProgress) onProgress((g + 1) / MARATHON_GAMES);
    }
    return { moves: allMoves, totalTopScore: totalTop };
  }
  const jokerPays = !!mode.jokerPays;          // mode « Joker payant »
  const alternateDir = !!mode.alternateDir;    // mode « Horizontal/Vertical »
  const dualTop = !!mode.dualTop;              // mode « Top/sous-top »
  const infJoker = !!mode.infJoker;           // mode « Double joker infini »
  const layout = mode.randomBoard ? randomBoardLayout() : null;   // mode « Grille random »
  // Le joker payant est une partie joker (jokers retirés du sac + recyclés).
  const withJoker = !!options.withJoker || jokerPays;

  // « À l'anglaise » : sac + valeurs anglais (table active pour le scoring).
  setLetterValues(valuesFor(modeKey));
  let bag = { ...bagFor(modeKey) };
  let spareJokers = 0;
  if (withJoker) {
    spareJokers = bag["?"] || 0;
    bag["?"] = 0;
  }
  if (infJoker) bag["?"] = 0;   // jokers infinis : sortis du sac (réinjectés à chaque tirage)

  let board = emptyBoard();
  let rack = []; // [{letter, id}]
  let nextId = 1;
  const moves = [];
  let totalTopScore = 0;
  let moveNo = 1;
  let snakeEnds = null;   // mode Snake : les 2 extrémités du serpent
  const hiddenSet = new Set();   // mode Lettre cachée : cases déjà retournées

  const estimatedMoves = 28; // pour le calcul de progress

  while (true) {
    // Sablier : partie limitée à 24 coups (le chrono décroissant atteint 5 s au 24e).
    if (mode.sablier && moves.length >= 24) break;
    // Double joker infini : la partie s'arrête quand il n'y a plus AUCUNE lettre
    // réelle (ni dans le sac, ni dans le chevalet) — tout a été posé sur la grille.
    if (infJoker) {
      // Fin quand on a posé la dernière voyelle OU la dernière consonne RÉELLE
      // (les jokers, infinis, ne comptent pas). On s'arrête si le pool réel
      // (sac + reliquat) n'a plus de voyelle ou plus de consonne.
      let _v = bagTotalVowels(bag), _c = bagTotalConsonants(bag);
      for (const t of rack) { if (t.letter === "?") continue; if (VOWELS_GEN.has(t.letter)) _v++; else _c++; }
      if (_v === 0 || _c === 0) break;
    }
    // Fin de partie : voyelles OU consonnes épuisées DANS LE POOL TOTAL
    // (chevalet conservé + sac restant). Sinon la partie continue.
    // §3.7 exception : si un joker ou le Y est dans le pool (≥2 lettres),
    // la partie ne peut pas s'arrêter — joker/Y peuvent servir de voyelle
    // ou de consonne selon le besoin.
    const VOWELS_SET = new Set(["A","E","I","O","U","Y"]);
    let v = bagTotalVowels(bag);
    let c = bagTotalConsonants(bag);
    for (const t of rack) {
      if (t.letter === "?") continue;
      if (VOWELS_SET.has(t.letter)) v++; else c++;
    }
    if (!infJoker && !mode.voyelles && (v === 0 || c === 0)) {
      // Règle de fin : dernière voyelle OU dernière consonne posée → fin, SAUF s'il
      // reste un joker (qui comble n'importe quel type) ou un Y (qui peut servir de
      // CONSONNE quand c'est la dernière consonne qui manque). La partie continue
      // tant que ce joker / ce Y n'est pas posé.
      const jokersInPool = (bag["?"] || 0) + rack.filter(t => t.letter === "?").length;
      const ysInPool = (bag["Y"] || 0) + rack.filter(t => t.letter === "Y").length;
      if (jokersInPool === 0 && ysInPool === 0) break;
    }

    // Compléter le chevalet (+ direction imposée éventuelle).
    // Gigogne : le tirage grandit d'un coup à l'autre (coup n → n+1 lettres).
    const target = mode.gigogne ? gigogneRackSize(moveNo) : mode.rackSize;
    // Gigogne : on peut poser autant de lettres qu'on en a (jusqu'à la taille du tirage).
    const maxTiles = mode.gigogne ? target : mode.maxPlayed;
    // Mode Horizontal/Vertical : H au coup 1, V au 2, H au 3, etc.
    const forceDir = alternateDir ? (moveNo % 2 === 1 ? "H" : "V") : undefined;
    let kept = [], freshRack = false, top = null, endNow = false, rackLetters = [];
    if (mode.voyelles) {
      // Tirage de voyelles seules (consommées du sac). On retente tant qu'aucun
      // coup n'est jouable ; le top se calcule avec un stock de consonnes libres.
      const bagSnap = { ...bag };
      let tries = 60;
      while (tries-- > 0) {
        bag = { ...bagSnap };
        const drawn = drawVowelRack(bag, moveNo);
        if (!drawn) { endNow = true; break; }
        rackLetters = drawn.slice();
        freshRack = true;
        top = findTopRanked(board, rackLetters, dict, bag, {
          maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses, freeCons: true,
        });
        if (top) break;
      }
    } else if (infJoker) {
      // 5 lettres réelles (reliquat conservé, pioche LIBRE sans règle V/C) + 2 jokers.
      rack = rack.filter(t => t.letter !== "?");
      kept = rack.map(t => t.letter);
      const needReal = Math.max(0, 5 - rack.length);
      const pool = [];
      for (const [l, n] of Object.entries(bag)) { if (l === "?") continue; for (let k = 0; k < n; k++) pool.push(l); }
      for (let k = 0; k < needReal && pool.length; k++) {
        const i = Math.floor(Math.random() * pool.length);
        const L = pool.splice(i, 1)[0];
        bag[L] = (bag[L] || 0) - 1;
        rack.push({ letter: L, id: nextId++ });
      }
      rack.push({ letter: "?", id: nextId++ }, { letter: "?", id: nextId++ });
      rackLetters = rack.map(t => t.letter);
      top = findTopRanked(board, rackLetters, dict, bag, { maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses });
    } else {
    // En H/V, si aucun coup n'existe dans la direction imposée, on REJETTE le
    // tirage et on en pioche un autre (rare). Sinon une seule tentative.
    const bagSnap = { ...bag };
    const rackSnap = rack.map(t => ({ ...t }));
    // H/V et Gigogne : on retente un tirage tant qu'aucun coup n'est jouable.
    let tries = (alternateDir || mode.gigogne) ? 40 : 1;
    while (tries-- > 0) {
      const jokerInRack = rack.some(t => t.letter === "?");
      const forceJoker = withJoker && spareJokers > 0 && !jokerInRack;
      const regularTarget = forceJoker ? target - 1 : target;
      kept = rack.map(t => t.letter);
      const result = drawForDuplicate(bag, kept, moveNo, regularTarget, { minVowels: mode.minVowels });
      if (result.failed) { endNow = true; break; }
      bag = result.bag;
      if (result.fresh) rack = rack.filter(t => t.letter === "?");
      for (const L of (result.drawn || [])) rack.push({ letter: L, id: nextId++ });
      if (forceJoker) rack.push({ letter: "?", id: nextId++ });
      freshRack = !!result.fresh;
      if (rack.length === 0) { endNow = true; break; }
      rackLetters = rack.map(t => t.letter);
      top = mode.snake
        ? snakeBestTop(board, rackLetters, dict, snakeEnds, { maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses, layout })
        : findTopRanked(board, rackLetters, dict, bag, {
            maxTilesUsed: maxTiles,
            bonuses: mode.bonuses,
            preserveJoker: withJoker && spareJokers > 0,
            jokerPays,
            forceDir,
            layout,
          });
      if (top || (!alternateDir && !mode.gigogne)) break;
      // Rejet : on restaure l'état AVANT pioche et on retente un tirage neuf.
      bag = { ...bagSnap };
      rack = rackSnap.map(t => ({ ...t }));
    }
    }
    if (endNow || !top) break;

    // Mode Top/sous-top : calculer aussi le SOUS-TOP (meilleur coup d'un score
    // strictement inférieur au top) + la liste des iso-sous-top (mêmes points).
    let subTop = null;
    if (dualTop) {
      const allCands = findTop(board, rackLetters, dict, {
        all: true, maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses, jokerPays, forceDir,
      }) || [];
      const lower = allCands.filter(c => c.score < top.score);
      if (lower.length) {
        const subScore = lower[0].score;
        const subWords = [...new Set(lower.filter(c => c.score === subScore).map(c => c.move.word))];
        const rep = lower[0].move;
        subTop = {
          word: rep.word, row: rep.row, col: rep.col, dir: rep.dir,
          blanks: rep.blanks || [], score: subScore, words: subWords,
        };
      }
    }

    // Enregistrer le coup (le jeton retourné est calculé APRÈS application, plus bas)
    moves.push({
      moveNo,
      rack: rackLetters.join(""),
      freshRack,
      kept: freshRack ? "" : kept.join(""),
      top: {
        word: top.move.word,
        row: top.move.row,
        col: top.move.col,
        dir: top.move.dir,
        blanks: top.move.blanks || [],
        score: top.score,
        words: top.words,
      },
      ...(subTop ? { subTop } : {}),
      ...(mode.snake ? { _ends: snakeEnds } : {}),   // extrémités du serpent AVANT ce coup
    });
    totalTopScore += top.score;

    // Identifier les nouvelles lettres posées
    const { word, row, col, dir, blanks } = top.move;
    const dr = dir === "V" ? 1 : 0;
    const dc = dir === "H" ? 1 : 0;
    let jokerUsedAsLetter = null;
    let jokerCellPos = null;
    let jokerWordIdx = -1;
    const usedLetters = [];
    for (let i = 0; i < word.length; i++) {
      const r = row + i * dr, c = col + i * dc;
      if (!board[r][c]) {
        const isBlank = blanks.includes(i);
        usedLetters.push({ letter: word[i], isBlank });
        if (isBlank && jokerUsedAsLetter === null) {
          jokerUsedAsLetter = word[i];
          jokerCellPos = { r, c };
          jokerWordIdx = i;
        }
      }
    }

    // Snake : mettre à jour les extrémités AVANT d'appliquer le coup au plateau.
    if (mode.snake) snakeEnds = snakeEndpointsAfter(snakeEnds, board, top.move);

    // Appliquer au plateau
    board = applyMove(board, top.move);

    // Lettre cachée : on retourne un jeton présent APRÈS ce coup (les lettres du
    // 1er coup deviennent candidates → le masquage démarre au 2e coup), en
    // excluant les jetons au croisement de deux mots et ceux déjà masqués. On le
    // mémorise sur ce coup pour rejouer à l'identique.
    if (mode.lettrecachee) {
      const occ = [];
      for (let r = 0; r < board.length; r++)
        for (let c = 0; c < board[r].length; c++)
          if (board[r][c] && !hiddenSet.has(r + "," + c) && !isCrossingCell(board, r, c)
              && wordHiddenCount(board, r, c, hiddenSet) < 2)
            occ.push([r, c]);
      if (occ.length) {
        const [hr, hc] = occ[Math.floor(Math.random() * occ.length)];
        moves[moves.length - 1].hidden = { row: hr, col: hc };
        hiddenSet.add(hr + "," + hc);
      }
    }

    // Mode joker (règle FFSC 3.8.1) : si le top utilise le joker, tenter le
    // remplacement par la lettre adéquate si elle est encore dans le sac.
    // Remplacement réussi → joker recyclé, spareJokers inchangé.
    // Remplacement impossible → joker posé définitivement sur la grille, spareJokers--.
    if (withJoker && jokerUsedAsLetter !== null && spareJokers > 0) {
      if (bag[jokerUsedAsLetter] > 0) {
        bag[jokerUsedAsLetter]--;
        board[jokerCellPos.r][jokerCellPos.c] = { letter: jokerUsedAsLetter, isBlank: false };
        // Retirer cet index de blanks dans le coup stocké → jeton normal en review
        const stored = moves[moves.length - 1].top;
        stored.blanks = stored.blanks.filter(b => b !== jokerWordIdx);
        // joker recyclé → spareJokers inchangé
      } else {
        spareJokers--;  // joker posé définitivement, lettre épuisée du sac
      }
    }

    // Retirer les lettres utilisées du chevalet
    for (const u of usedLetters) {
      let idx = -1;
      if (u.isBlank) idx = rack.findIndex(t => t.letter === "?");
      else {
        idx = rack.findIndex(t => t.letter === u.letter);
        if (idx === -1) idx = rack.findIndex(t => t.letter === "?");
      }
      if (idx !== -1) rack.splice(idx, 1);
    }

    if (onProgress) onProgress(Math.min(0.95, moveNo / estimatedMoves));
    moveNo++;
    if (moveNo > 40) break; // garde-fou
  }

  if (onProgress) onProgress(1);
  // Grille random : on grave la disposition des bonus sur le 1er coup (stockée
  // avec la partie, relue au jeu et à la review).
  if (layout && moves.length) moves[0]._layout = layout;
  // On expose aussi l'état final du sac et du chevalet pour debug/vérification
  const finalRack = rack.map(t => t.letter);

  // Validation post-génération : en mode joker, les coups où spareJokers > 0
  // doivent avoir un "?" dans le rack.
  // spareJokers décrémente seulement quand top.blanks non vide (joker posé sans remplacement).
  if (withJoker) {
    let simSpare = 2;
    const badMoves = [];
    for (const m of moves) {
      if (simSpare > 0 && !m.rack.includes("?")) badMoves.push(m);
      if ((m.top.blanks || []).length > 0 && simSpare > 0) simSpare--;
    }
    if (badMoves.length > 0) {
      const details = badMoves.map(m => `coup ${m.moveNo} : "${m.rack}"`).join(", ");
      console.error(`[generator] partie joker : joker absent du rack — ${details}`);
      setLetterValues(LETTER_VALUE);   // toujours revenir aux valeurs FR
      return { moves, totalTopScore, finalBag: bag, finalRack, jokerError: details };
    }
  }

  setLetterValues(LETTER_VALUE);   // toujours revenir aux valeurs FR
  return { moves, totalTopScore, finalBag: bag, finalRack };
}
