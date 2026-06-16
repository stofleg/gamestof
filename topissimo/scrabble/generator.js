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
  bagTotalVowels, bagTotalConsonants, GAME_MODES,
} from "./engine.js";
import { findTopRanked } from "./topfinder.js";

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
  const withJoker = !!options.withJoker;

  let bag = { ...LETTER_BAG };
  let spareJokers = 0;
  if (withJoker) {
    spareJokers = bag["?"] || 0;
    bag["?"] = 0;
  }

  let board = emptyBoard();
  let rack = []; // [{letter, id}]
  let nextId = 1;
  const moves = [];
  let totalTopScore = 0;
  let moveNo = 1;

  const estimatedMoves = 28; // pour le calcul de progress

  while (true) {
    // Fin de partie : voyelles OU consonnes épuisées DANS LE POOL TOTAL
    // (chevalet conservé + sac restant). Sinon la partie continue.
    const VOWELS_SET = new Set(["A","E","I","O","U","Y"]);
    let v = bagTotalVowels(bag);
    let c = bagTotalConsonants(bag);
    for (const t of rack) {
      if (t.letter === "?") continue;
      if (VOWELS_SET.has(t.letter)) v++; else c++;
    }
    if (v === 0 || c === 0) break;

    // Compléter le chevalet
    const target = mode.rackSize;
    const jokerInRack = rack.some(t => t.letter === "?");
    const forceJoker = withJoker && spareJokers > 0 && !jokerInRack;
    const regularTarget = forceJoker ? target - 1 : target;
    const kept = rack.map(t => t.letter);
    const result = drawForDuplicate(bag, kept, moveNo, regularTarget);
    if (result.failed) break;
    bag = result.bag;
    // Rejet : le reliquat (hors jokers) a été remis dans le sac → on le retire
    // du chevalet et on garde uniquement les jokers conservés.
    if (result.fresh) rack = rack.filter(t => t.letter === "?");
    for (const L of (result.drawn || [])) rack.push({ letter: L, id: nextId++ });
    if (forceJoker) rack.push({ letter: "?", id: nextId++ });
    const freshRack = !!result.fresh;

    // Si on n'a pas pu compléter (sac vide), fin
    if (rack.length === 0) break;

    // Calcul du top
    const rackLetters = rack.map(t => t.letter);
    const top = findTopRanked(board, rackLetters, dict, bag, {
      maxTilesUsed: mode.maxPlayed,
      bonuses: mode.bonuses,
      preserveJoker: withJoker && spareJokers > 0,
    });

    if (!top) {
      // aucun coup possible — partie terminée
      break;
    }

    // Enregistrer le coup
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

    // Appliquer au plateau
    board = applyMove(board, top.move);

    // Mode joker : si joker utilisé, tenter remplacement par la lettre du sac
    if (withJoker && jokerUsedAsLetter !== null && spareJokers > 0) {
      if (bag[jokerUsedAsLetter] > 0) {
        bag[jokerUsedAsLetter]--;
        board[jokerCellPos.r][jokerCellPos.c] = { letter: jokerUsedAsLetter, isBlank: false };
        // Retirer cet index de blanks dans le coup stocké → jeton normal en review
        const stored = moves[moves.length - 1].top;
        stored.blanks = stored.blanks.filter(b => b !== jokerWordIdx);
      } else {
        spareJokers--;
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
  // On expose aussi l'état final du sac et du chevalet pour debug/vérification
  const finalRack = rack.map(t => t.letter);
  return { moves, totalTopScore, finalBag: bag, finalRack };
}
