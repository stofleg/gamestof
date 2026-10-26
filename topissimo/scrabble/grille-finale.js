//  Socle commun des formules à grille finale (« Grille puzzle ») : génère une
//  partie duplicate complète et renvoie sa grille finale, à reconstituer.
//  Le rendu d'une case reprend exactement le balisage de game.js (classes de
//  bonus, jetons), pour que game.css lui donne le même aspect que dans le jeu.
import { Dictionary } from "./dictionary.js?v=430";
import { generateGame } from "./generator.js?v=430";
import { emptyBoard, applyMove, BOARD_BONUSES, letterValue } from "./engine.js?v=430";

export async function chargeDico() {
  return new Dictionary().load("ods9.txt");
}

/** Grille finale d'une partie duplicate générée au hasard. */
export function grilleFinale(dict) {
  const partie = generateGame(dict, { mode: "duplicate" });
  let board = emptyBoard();
  for (const m of partie.moves) board = applyMove(board, m.top);
  return { board, coups: partie.moves.length, total: partie.totalTopScore };
}

const CLASSE = { ".": "normal", d: "dl", t: "tl", D: "dw", T: "tw", "*": "center" };
export const classeCase = (r, c) => CLASSE[BOARD_BONUSES[r][c]] || "normal";

/** Contenu HTML d'une case : jeton s'il y en a un, rien sinon. */
export function jeton(t) {
  if (!t) return "";
  return `<div class="tile${t.isBlank ? " blank" : ""}">${t.letter}`
    + `<span class="val">${t.isBlank ? "" : letterValue(t.letter)}</span></div>`;
}

/** Applique le thème transmis par l'URL (classique ou DupliJeu). */
export function appliqueTheme() {
  const th = new URLSearchParams(location.search).get("theme");
  document.body.classList.toggle("theme-duplijeu", th === "duplijeu");
}

/** Mélange de Fisher-Yates. */
export function melange(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Chrono affiché en m:ss. */
export const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
