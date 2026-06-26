// ============================================================
//  Recalcul des négatifs des parties joker (migration corrective)
//
//  Contexte : avant le correctif v119, en partie pré-tirée le joker pouvait
//  être remplacé à tort par une vraie lettre (state.bag non suivi). Le plateau
//  divergeait → les coups joués étaient sur-évalués → des négatifs POSITIFS
//  (impossible : on ne peut pas battre le top) ont été enregistrés.
//
//  Ce module reconstruit le plateau CORRECT (tops stockés + blanks, qui sont
//  justes car la génération l'était) et re-score chaque coup joué dessus, pour
//  produire des négatifs fidèles (toujours ≤ 0).
// ============================================================

import { emptyBoard, applyMove, scoreMove, GAME_MODES } from "./engine.js?v=247";

// Parse une étiquette de position FFSC en {row, col, dir}.
//   horizontal "H8"  → lettre (ligne) puis nombre (colonne+1)
//   vertical   "8H"  → nombre (colonne+1) puis lettre (ligne)
const ROW_LETTERS = "ABCDEFGHIJKLMNO";
function parsePos(label) {
  if (!label) return null;
  const m1 = /^([A-O])(\d{1,2})$/.exec(label);   // horizontal
  if (m1) return { row: ROW_LETTERS.indexOf(m1[1]), col: (+m1[2]) - 1, dir: "H" };
  const m2 = /^(\d{1,2})([A-O])$/.exec(label);   // vertical
  if (m2) return { row: ROW_LETTERS.indexOf(m2[2]), col: (+m2[1]) - 1, dir: "V" };
  return null;
}

// Combinaisons de `k` éléments parmi `arr`.
function combos(arr, k) {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const res = [];
  (function rec(start, acc) {
    if (acc.length === k) { res.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  })(0, []);
  return res;
}

// Re-score le mot joué `word` à la position donnée sur `board`, en déduisant le
// MEILLEUR placement de joker(s) à partir du chevalet `rack` (comme le faisait
// le jeu via bestJokerVariant). Retourne le score (ou 0 si invalide/impossible).
function scorePlayedBest(board, word, pos, rackLetters, bonuses) {
  const { row, col, dir } = pos;
  const dr = dir === "V" ? 1 : 0, dc = dir === "H" ? 1 : 0;
  // Indices (dans le mot) des lettres NOUVELLEMENT posées (case vide).
  const placedIdx = [];
  for (let i = 0; i < word.length; i++) {
    const r = row + i * dr, c = col + i * dc;
    if (r < 0 || r > 14 || c < 0 || c > 14) return 0;
    if (!board[r][c]) placedIdx.push(i);
  }
  if (placedIdx.length === 0) return 0;

  // Inventaire du chevalet
  const jokerCount = rackLetters.filter(l => l === "?").length;
  const avail = {};
  for (const l of rackLetters) if (l !== "?") avail[l] = (avail[l] || 0) + 1;

  let best = -1;
  const maxBlanks = Math.min(jokerCount, placedIdx.length);
  for (let nb = 0; nb <= maxBlanks; nb++) {
    for (const blankSet of combos(placedIdx, nb)) {
      // Lettres réelles requises = placées non-blanches
      const need = {};
      let ok = true;
      for (const i of placedIdx) {
        if (blankSet.includes(i)) continue;
        const L = word[i];
        need[L] = (need[L] || 0) + 1;
        if (need[L] > (avail[L] || 0)) { ok = false; break; }
      }
      if (!ok) continue;
      const r = scoreMove(board, { word, row, col, dir, blanks: blankSet }, null, { bonuses });
      if (!r.errors.length && r.score > best) best = r.score;
    }
  }
  return best < 0 ? 0 : best;
}

/**
 * Recalcule les négatifs d'un résultat à partir de la séquence de tops stockée.
 * @param {object} game  prepared_games row : { mode, moves: [{top:{...}}] }
 * @param {Array}  details  feuille de route stockée (result.details)
 * @returns {{ sumNeg, totalScore, details, changed }}
 */
export function recomputeResult(game, details) {
  const mode = GAME_MODES[game.mode] || GAME_MODES.duplicate;
  const bonuses = mode.bonuses;
  const moves = game.moves || [];
  let board = emptyBoard();
  let sumNeg = 0, totalScore = 0;
  const out = [];

  for (let i = 0; i < details.length; i++) {
    const h = { ...details[i] };
    // Top canonique : priorité au top stocké dans le coup de la partie (source
    // de vérité), repli sur celui de la feuille de route.
    const topMove = moves[i]?.top || h.top;
    const topScore = topMove?.score || 0;

    let playerScore = 0;
    if (h.played) {
      const pos = parsePos(h.playedPos);
      if (pos) {
        playerScore = scorePlayedBest(board, h.played, pos, (h.rack || "").split(""), bonuses);
      } else {
        // Pas de position exploitable : on retombe sur l'ancien score borné au top.
        playerScore = Math.min(h.playerScore || 0, topScore);
      }
    }
    // Sécurité : un score joueur ne peut pas dépasser le top.
    if (playerScore > topScore) playerScore = topScore;

    // Règle spéciale premier coup : si le joueur a joué le même mot que le top
    // (quelle que soit la position), il est crédité du top (négatif = 0).
    const topWord = (topMove?.word || "").toUpperCase();
    const playedWord = (h.played || "").toUpperCase();
    const firstMoveTopWord = i === 0 && topWord && playedWord === topWord;
    if (firstMoveTopWord) playerScore = topScore;

    const neg = playerScore - topScore;
    h.playerScore = playerScore;
    h.neg = neg;
    // Corriger le statut après recalcul : top ssi score == top, sinon on efface
    // un éventuel "top" fantôme (ex : même mot mais position différente, hors 1er coup).
    if (h.played) {
      h.status = (topMove && playerScore === topScore) ? "top" : (h.status === "top" ? "" : (h.status || ""));
    }

    sumNeg += neg;
    totalScore += playerScore;
    // Appliquer le top au plateau pour le coup suivant (blanks corrects).
    if (topMove && topMove.word) {
      board = applyMove(board, {
        word: topMove.word, row: topMove.row, col: topMove.col,
        dir: topMove.dir, blanks: topMove.blanks || [],
      });
    }
    out.push(h);
  }

  return { sumNeg, totalScore, details: out };
}
