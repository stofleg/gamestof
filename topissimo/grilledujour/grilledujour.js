//  Grille du jour — page autonome.
//
//  Les grilles sont PRÉCALCULÉES (voir outils/genere-grilles.mjs) : la règle
//  « un mot ↔ un emplacement » ne laisse passer que 6 % des positions, et la
//  recherche coûte environ trois minutes. Une grille par jour ne justifiant pas
//  une telle attente, la page lit un lot tout prêt et choisit selon la date.
//
//  Le dictionnaire (4 Mo) n'est chargé qu'en arrière-plan, dans un worker, et
//  seulement pour pouvoir dire « ce mot existe mais ne passe pas ici ». La page
//  est utilisable sans l'attendre.
import { BOARD_BONUSES, letterValue } from "../scrabble/engine.js?v=373";

const $ = id => document.getElementById(id);
const LIGNES = "ABCDEFGHIJKLMNO";
let lot = [], grille = null, trouves = new Set(), iGrille = 0, enAttente = null;

// --- worker, pour la seule vérification au dictionnaire ---------------------
let worker = null;
try {
  worker = new Worker("./worker.js?v=372", { type: "module" });
  worker.onmessage = e => {
    const d = e.data || {};
    if (d.type === "verifie" && d.mot === enAttente) {
      message(d.connu
        ? `${d.mot} est dans le dictionnaire, mais ne passe pas sur cette grille.`
        : `${d.mot} n'est pas un scrabble de cette grille.`, "ko");
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
  const g = lot[((i % lot.length) + lot.length) % lot.length];
  iGrille = ((i % lot.length) + lot.length) % lot.length;
  grille = {
    board: litPlateau(g.plateau),
    rack: [...g.rack],
    coup: g.coup,
    scrabbles: g.scrabbles.map(s => ({ word: s.m, row: s.l, col: s.c, dir: s.d, score: s.p })),
  };
  trouves = new Set(); posees = null;
  dessineGrille(); dessineListe(); message("");
  for (const b of ["gdjGo", "gdjReveal", "gdjNew"]) $(b).disabled = false;
  $("gdjInput").disabled = false; $("gdjInput").focus();
}

const CLASSE = { ".": "normal", d: "dl", t: "tl", D: "dw", T: "tw", "*": "center" };
const tuile = (l, blanc, cls = "") =>
  `<div class="tile${blanc ? " blank" : ""}${cls ? " " + cls : ""}">${l}`
  + `<span class="val">${blanc ? "" : letterValue(l)}</span></div>`;

/** Mot trouvé posé en vert sur le plateau, comme un coup en cours dans Topissimo. */
let posees = null;

function dessineGrille() {
  let h = "<table>";
  for (let r = 0; r < 15; r++) {
    h += "<tr>";
    for (let c = 0; c < 15; c++) {
      const t = grille.board[r][c];
      const p = posees && posees.get(r * 15 + c);
      const cls = [CLASSE[BOARD_BONUSES[r][c]] || "normal"];
      if (t || p) cls.push("has-tile");
      h += `<td class="${cls.join(" ")}">`
        + (t ? tuile(t.letter, t.isBlank) : p ? tuile(p, false, "pending") : "") + "</td>";
    }
    h += "</tr>";
  }
  $("gdjBoard").innerHTML = h + "</table>";
  $("gdjRack").innerHTML = grille.rack.map(l => tuile(l, false)).join("");
}

function souligne(s) {
  posees = new Map();
  const dr = s.dir === "V" ? 1 : 0, dc = s.dir === "H" ? 1 : 0;
  for (let i = 0; i < s.word.length; i++) {
    const r = s.row + i*dr, c = s.col + i*dc;
    if (!grille.board[r][c]) posees.set(r * 15 + c, s.word[i]);
  }
  dessineGrille();
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
  const j = Math.floor(Date.now() / 86400000);   // jours depuis 1970, heure locale ignorée
  return lot.length ? j % lot.length : 0;
}

function propose() {
  const mot = ($("gdjInput").value || "").trim().toUpperCase();
  $("gdjInput").value = "";
  if (!mot || !grille) return;
  const cible = grille.scrabbles.find(s => s.word === mot);
  if (!cible) {
    enAttente = mot;
    if (worker) worker.postMessage({ type: "verifie", mot });
    else message(`${mot} n'est pas un scrabble de cette grille.`, "ko");
    return;
  }
  if (trouves.has(cible.word)) { message(`${cible.word}, déjà trouvé.`); return; }
  trouves.add(cible.word);
  souligne(cible); dessineListe();
  const fini = trouves.size === grille.scrabbles.length;
  message(`${mot} en ${repere(cible)} — ${cible.score} points.` + (fini ? "  Grille terminée." : ""), "ok");
}

$("gdjGo").onclick = propose;
$("gdjInput").onkeydown = e => { if (e.key === "Enter") propose(); };
$("gdjNew").onclick = () => charge(iGrille + 1);
$("gdjReveal").onclick = () => {
  if (!grille) return;
  grille.scrabbles.forEach(s => trouves.add(s.word));
  dessineListe(); message("Tout est révélé.");
};
$("gdjList").onclick = e => {
  const li = e.target.closest("li[data-i]");
  if (!li || !grille) return;
  const s = grille.scrabbles[+li.dataset.i];
  if (trouves.has(s.word)) souligne(s);
};

(async function init() {
  $("gdjSub").textContent = "chargement…";
  try {
    const r = await fetch("./grilles.json?v=372");
    if (!r.ok) throw new Error("lot introuvable");
    lot = (await r.json()).grilles || [];
    if (!lot.length) throw new Error("lot vide");
  } catch (err) {
    $("gdjSub").textContent = "aucune grille disponible — relancer outils/genere-grilles.mjs";
    return;
  }
  charge(indexDuJour());
})();
