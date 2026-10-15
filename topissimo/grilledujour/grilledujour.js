//  Grille du jour — page autonome.
//
//  Les grilles sont PRÉCALCULÉES (voir outils/genere-grilles.mjs) et la page lit
//  un lot tout prêt, la grille du jour étant choisie selon la date.
//
//  Saisie comme dans Topissimo : un clic sur une case place le curseur (second
//  clic = changement de sens), les lettres se tapent au clavier ou se touchent
//  sur le chevalet, elles sautent les cases déjà occupées, Retour arrière les
//  reprend, Entrée valide, Échap annule.
//
//  Le dictionnaire (4 Mo) n'est chargé qu'en arrière-plan, dans un worker, et
//  seulement pour pouvoir dire « ce mot existe mais n'est pas un scrabble ici ».
import { BOARD_BONUSES, letterValue } from "../scrabble/engine.js?v=375";

const $ = id => document.getElementById(id);
const LIGNES = "ABCDEFGHIJKLMNO";
let lot = [], grille = null, trouves = new Set(), iGrille = 0, enAttente = null;
let curseur = null;          // { row, col, dir }
let saisie = [];             // jetons tapés : { r, c, l }
let montre = null;           // Map(case → lettre) d'un scrabble trouvé, affiché en vert

// --- worker, pour la seule vérification au dictionnaire ---------------------
let worker = null;
try {
  worker = new Worker("./worker.js?v=375", { type: "module" });
  worker.onmessage = e => {
    const d = e.data || {};
    if (d.type === "verifie" && d.mot === enAttente) {
      message(d.connu
        ? `${d.mot} existe, mais ce n'est pas un scrabble de cette grille à cet endroit.`
        : `${d.mot} n'est pas dans le dictionnaire.`, "ko");
    }
  };
  worker.postMessage({ type: "init" });
} catch { worker = null; }

/** Repère Scrabble : lettre = ligne, chiffre = colonne ; horizontal = lettre d'abord. */
const repere = s => s.dir === "H" ? `${LIGNES[s.row]}${s.col + 1}` : `${s.col + 1}${LIGNES[s.row]}`;

/** Le plateau est stocké en 15 chaînes : point = vide, minuscule = joker posé. */
function litPlateau(lignes) {
  return lignes.map(l => [...l].map(ch =>
    ch === "." ? null : { letter: ch.toUpperCase(), isBlank: ch === ch.toLowerCase() }));
}

function charge(i) {
  iGrille = ((i % lot.length) + lot.length) % lot.length;
  const g = lot[iGrille];
  grille = {
    board: litPlateau(g.plateau),
    rack: [...g.rack],
    coup: g.coup,
    scrabbles: g.scrabbles.map(s => ({ word: s.m, row: s.l, col: s.c, dir: s.d, score: s.p })),
  };
  trouves = new Set(); montre = null; saisie = []; curseur = null;
  dessineGrille(); dessineListe();
  message("Clique sur une case, puis tape ton scrabble au clavier ou sur le chevalet.");
  for (const b of ["gdjValide", "gdjEfface", "gdjReveal", "gdjNew"]) $(b).disabled = false;
}

// --- rendu ------------------------------------------------------------------
const CLASSE = { ".": "normal", d: "dl", t: "tl", D: "dw", T: "tw", "*": "center" };
const tuile = (l, blanc, cls = "", attrs = "") =>
  `<div class="tile${blanc ? " blank" : ""}${cls ? " " + cls : ""}" ${attrs}>${l}`
  + `<span class="val">${blanc ? "" : letterValue(l)}</span></div>`;

const libre = (r, c) => r >= 0 && r < 15 && c >= 0 && c < 15 && !grille.board[r][c];
const tapee = (r, c) => saisie.find(p => p.r === r && p.c === c);

function dessineGrille() {
  let h = "<table>";
  for (let r = 0; r < 15; r++) {
    h += "<tr>";
    for (let c = 0; c < 15; c++) {
      const t = grille.board[r][c], p = tapee(r, c);
      const v = !p && montre && montre.get(r * 15 + c);
      const cls = [CLASSE[BOARD_BONUSES[r][c]] || "normal"];
      if (t || p || v) cls.push("has-tile");
      if (curseur && curseur.row === r && curseur.col === c)
        cls.push("cursor", curseur.dir === "H" ? "dir-h" : "dir-v");
      h += `<td class="${cls.join(" ")}" data-r="${r}" data-c="${c}">`
        + (t ? tuile(t.letter, t.isBlank) : p ? tuile(p.l, false, "pending")
           : v ? tuile(v, false, "pending") : "") + "</td>";
    }
    h += "</tr>";
  }
  $("gdjBoard").innerHTML = h + "</table>";
  // chevalet : les lettres déjà tapées sont grisées
  const reste = [...grille.rack];
  for (const p of saisie) { const k = reste.indexOf(p.l); if (k >= 0) reste[k] = null; }
  $("gdjRack").innerHTML = reste.map((l, i) => l
    ? tuile(l, false, "", `data-l="${l}"`)
    : tuile(grille.rack[i] ?? "", false, "used")).join("");
}

function dessineListe() {
  $("gdjList").innerHTML = grille.scrabbles.map((s, i) => {
    const vu = trouves.has(s.word);
    return `<li class="${vu ? "found" : ""}" data-i="${i}">
      <span class="w ${vu ? "" : "masked"}">${vu ? s.word : "·".repeat(s.word.length)}</span>
      <span class="pos">${vu ? repere(s) : ""}</span>
      <span class="sc">${vu ? s.score + " pts" : "—"}</span>
    </li>`;
  }).join("");
  const n = trouves.size, t = grille.scrabbles.length;
  $("gdjSub").textContent = `${n}/${t} trouvé${n > 1 ? "s" : ""} · coup ${grille.coup} de la partie`
    + (iGrille === indexDuJour() ? " · grille du jour" : ` · grille ${iGrille + 1}/${lot.length}`);
}

function message(txt, cls = "") { const m = $("gdjMsg"); m.className = "gdj-msg " + cls; m.textContent = txt; }

/** Numéro de grille correspondant à la date, pour que la journée en donne toujours la même. */
function indexDuJour() {
  const j = Math.floor(Date.now() / 86400000);
  return lot.length ? j % lot.length : 0;
}

// --- saisie sur la grille -----------------------------------------------------
const pas = () => curseur.dir === "H" ? [0, 1] : [1, 0];

/** Avance le curseur jusqu'à la prochaine case libre (en sautant les lettres posées). */
function avance() {
  const [dr, dc] = pas();
  let r = curseur.row + dr, c = curseur.col + dc;
  while (r < 15 && c < 15 && (grille.board[r][c] || tapee(r, c))) { r += dr; c += dc; }
  curseur = { ...curseur, row: Math.min(r, 14), col: Math.min(c, 14), hors: r > 14 || c > 14 };
}

function cliqueCase(r, c) {
  if (!grille || grille.board[r][c]) return;          // case occupée : intouchable
  montre = null;
  if (tapee(r, c)) {                                   // reprendre à partir de ce jeton
    const k = saisie.findIndex(p => p.r === r && p.c === c);
    const meme = curseur && curseur.row === r && curseur.col === c;
    saisie = saisie.slice(0, k);
    curseur = { row: r, col: c, dir: meme ? (curseur.dir === "H" ? "V" : "H") : curseur?.dir || "H" };
  } else if (curseur && curseur.row === r && curseur.col === c && !saisie.length) {
    curseur = { row: r, col: c, dir: curseur.dir === "H" ? "V" : "H" };
  } else {
    saisie = [];
    curseur = { row: r, col: c, dir: "H" };
  }
  message("");
  dessineGrille();
}

function tape(l) {
  if (!grille || !curseur || curseur.hors) return;
  if (saisie.length >= 7) return;
  const dispo = grille.rack.filter(x => x === l).length - saisie.filter(p => p.l === l).length;
  if (dispo <= 0) { message(`Pas de ${l} disponible sur le chevalet.`, "ko"); return; }
  if (!libre(curseur.row, curseur.col) || tapee(curseur.row, curseur.col)) avance();
  if (curseur.hors) return;
  saisie.push({ r: curseur.row, c: curseur.col, l });
  avance();
  message("");
  dessineGrille();
}

function retour() {
  const p = saisie.pop();
  if (!p) return;
  curseur = { ...curseur, row: p.r, col: p.c, hors: false };
  dessineGrille();
}

function efface() {
  if (saisie.length) curseur = { ...curseur, row: saisie[0].r, col: saisie[0].c, hors: false };
  saisie = []; montre = null;
  message("");
  dessineGrille();
}

/** Mot complet formé par la saisie : on prolonge par les lettres déjà en place. */
function motForme() {
  const dir = saisie.length > 1
    ? (saisie[0].r === saisie[1].r ? "H" : "V") : curseur.dir;
  const [dr, dc] = dir === "H" ? [0, 1] : [1, 0];
  const at = (r, c) => grille.board[r]?.[c]?.letter || tapee(r, c)?.l;
  let r = saisie[0].r, c = saisie[0].c;
  while (r - dr >= 0 && c - dc >= 0 && at(r - dr, c - dc)) { r -= dr; c -= dc; }
  const row = r, col = c;
  let mot = "";
  while (r < 15 && c < 15 && at(r, c)) { mot += at(r, c); r += dr; c += dc; }
  // les jetons tapés doivent tous appartenir à ce mot, sans trou
  const dedans = saisie.every(p => dir === "H"
    ? p.r === row && p.c >= col && p.c < col + mot.length
    : p.c === col && p.r >= row && p.r < row + mot.length);
  return dedans ? { mot, row, col, dir } : null;
}

function valide() {
  if (!grille || !saisie.length) return;
  if (saisie.length < 7) { message("Un scrabble pose les sept lettres du chevalet.", "ko"); return; }
  const f = motForme();
  if (!f) { message("Les lettres doivent former un seul mot, sur une même ligne.", "ko"); return; }
  const cible = grille.scrabbles.find(s =>
    s.word === f.mot && s.row === f.row && s.col === f.col && s.dir === f.dir);
  if (!cible) {
    enAttente = f.mot;
    if (worker) worker.postMessage({ type: "verifie", mot: f.mot });
    else message(`${f.mot} n'est pas un scrabble de cette grille à cet endroit.`, "ko");
    return;
  }
  if (trouves.has(cible.word)) { message(`${cible.word}, déjà trouvé.`); efface(); return; }
  trouves.add(cible.word);
  montrer(cible);
  saisie = []; curseur = null;
  dessineGrille(); dessineListe();
  const fini = trouves.size === grille.scrabbles.length;
  message(`${cible.word} en ${repere(cible)} — ${cible.score} points.` + (fini ? "  Grille terminée." : ""), "ok");
}

/** Affiche un scrabble trouvé en vert sur le plateau. */
function montrer(s) {
  montre = new Map();
  const [dr, dc] = s.dir === "H" ? [0, 1] : [1, 0];
  for (let i = 0; i < s.word.length; i++) {
    const r = s.row + i * dr, c = s.col + i * dc;
    if (!grille.board[r][c]) montre.set(r * 15 + c, s.word[i]);
  }
}

// --- événements -------------------------------------------------------------
$("gdjBoard").addEventListener("click", e => {
  const td = e.target.closest("td[data-r]");
  if (td) cliqueCase(+td.dataset.r, +td.dataset.c);
});
$("gdjRack").addEventListener("click", e => {
  const t = e.target.closest(".tile[data-l]");
  if (t) tape(t.dataset.l);
});
document.addEventListener("keydown", e => {
  if (!grille || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (/^[a-zA-Z]$/.test(k)) { tape(k.toUpperCase()); e.preventDefault(); }
  else if (k === "Backspace") { retour(); e.preventDefault(); }
  else if (k === "Enter") { valide(); e.preventDefault(); }
  else if (k === "Escape") { efface(); }
  else if (k === " " && curseur && !saisie.length) {
    curseur = { ...curseur, dir: curseur.dir === "H" ? "V" : "H" }; dessineGrille(); e.preventDefault();
  }
});
$("gdjValide").onclick = valide;
$("gdjEfface").onclick = efface;
$("gdjNew").onclick = () => charge(iGrille + 1);
$("gdjReveal").onclick = () => {
  if (!grille) return;
  grille.scrabbles.forEach(s => trouves.add(s.word));
  saisie = []; curseur = null;
  dessineGrille(); dessineListe(); message("Tout est révélé. Clique sur un mot pour le voir sur la grille.");
};
$("gdjList").onclick = e => {
  const li = e.target.closest("li[data-i]");
  if (!li || !grille) return;
  const s = grille.scrabbles[+li.dataset.i];
  if (trouves.has(s.word)) { saisie = []; curseur = null; montrer(s); dessineGrille(); }
};

(async function init() {
  $("gdjSub").textContent = "chargement…";
  try {
    const r = await fetch("./grilles.json?v=375");
    if (!r.ok) throw new Error("lot introuvable");
    lot = (await r.json()).grilles || [];
    if (!lot.length) throw new Error("lot vide");
  } catch (err) {
    $("gdjSub").textContent = "aucune grille disponible — relancer outils/genere-grilles.mjs";
    return;
  }
  charge(indexDuJour());
})();
