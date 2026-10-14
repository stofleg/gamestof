//  Grille du jour — page autonome.
//  La recherche (une dizaine de secondes) tourne dans un worker, qui détient
//  aussi le dictionnaire ; la page ne le charge donc pas une seconde fois.
import { BOARD_BONUSES } from "../scrabble/engine.js?v=370";

const $ = id => document.getElementById(id);
const LIGNES = "ABCDEFGHIJKLMNO";
let grille = null, trouves = new Set(), enAttente = null;

const worker = new Worker("./worker.js?v=370", { type: "module" });

/** Repère Scrabble : lettre = ligne, chiffre = colonne ; horizontal = lettre d'abord. */
function repere(s) {
  const L = LIGNES[s.row], C = s.col + 1;
  return s.dir === "H" ? `${L}${C}` : `${C}${L}`;
}

function dessineGrille() {
  const cases = [];
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const t = grille.board[r][c];
    if (t) {
      cases.push(`<i class="L${t.isBlank ? " jk" : ""}" data-rc="${r},${c}">${t.letter}</i>`);
    } else {
      const b = BOARD_BONUSES[r][c];
      const cls = b === "*" ? "c" : (b === "." ? "" : b);
      const txt = { T: "MT", D: "MD", t: "LT", d: "LD", "*": "★" }[b] || "";
      cases.push(`<i class="${cls}" data-rc="${r},${c}">${txt}</i>`);
    }
  }
  $("gdjBoard").innerHTML = cases.join("");
  $("gdjRack").innerHTML = grille.rack.map(l => `<b>${l}</b>`).join("");
}

function souligne(s) {
  document.querySelectorAll(".gdj-board i.hit").forEach(e => e.classList.remove("hit"));
  const dr = s.dir === "V" ? 1 : 0, dc = s.dir === "H" ? 1 : 0;
  for (let i = 0; i < s.word.length; i++) {
    const e = document.querySelector(`.gdj-board i[data-rc="${s.row + i*dr},${s.col + i*dc}"]`);
    if (e) e.classList.add("hit");
  }
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
  $("gdjSub").textContent = `${n}/${t} trouvé${n > 1 ? "s" : ""} · coup ${grille.coup} de la partie`;
}

function message(txt, cls = "") { const m = $("gdjMsg"); m.className = "gdj-msg " + cls; m.textContent = txt; }

function propose() {
  const mot = ($("gdjInput").value || "").trim().toUpperCase();
  $("gdjInput").value = "";
  if (!mot || !grille) return;
  const cible = grille.scrabbles.find(s => s.word === mot);
  if (!cible) {
    enAttente = mot;                       // le worker dira s'il est au dictionnaire
    worker.postMessage({ type: "verifie", mot });
    return;
  }
  if (trouves.has(cible.word)) { message(`${cible.word}, déjà trouvé.`); return; }
  trouves.add(cible.word);
  souligne(cible);
  dessineListe();
  const fini = trouves.size === grille.scrabbles.length;
  message(`${mot} en ${repere(cible)} — ${cible.score} points.` + (fini ? "  Grille terminée." : ""), "ok");
}

function actif(oui) {
  for (const b of ["gdjGo", "gdjReveal", "gdjNew"]) $(b).disabled = !oui;
  $("gdjInput").disabled = !oui;
  if (oui) $("gdjInput").focus();
}

function nouvelle() {
  actif(false);
  grille = null; trouves = new Set();
  $("gdjList").innerHTML = "";
  $("gdjSub").textContent = "recherche d'une grille…";
  message("");
  worker.postMessage({ type: "grille" });
}

worker.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === "pret") { nouvelle(); return; }
  if (d.type === "avance") { $("gdjSub").textContent = `recherche d'une grille… ${d.parties} parties explorées`; return; }
  if (d.type === "grille") {
    if (!d.grille) { $("gdjSub").textContent = "aucune grille trouvée"; $("gdjNew").disabled = false; return; }
    grille = d.grille;
    dessineGrille(); dessineListe(); actif(true);
    return;
  }
  if (d.type === "verifie") {
    if (d.mot !== enAttente) return;
    message(d.connu
      ? `${d.mot} est dans le dictionnaire, mais ne passe pas sur cette grille.`
      : `${d.mot} n'est pas un scrabble de cette grille.`, "ko");
    return;
  }
  if (d.type === "erreur") { $("gdjSub").textContent = "erreur : " + d.message; $("gdjNew").disabled = false; }
};

$("gdjGo").onclick = propose;
$("gdjInput").onkeydown = e => { if (e.key === "Enter") propose(); };
$("gdjNew").onclick = nouvelle;
$("gdjReveal").onclick = () => {
  if (!grille) return;
  grille.scrabbles.forEach(s => trouves.add(s.word));
  dessineListe();
  message("Tout est révélé.");
};
$("gdjList").onclick = e => {
  const li = e.target.closest("li[data-i]");
  if (!li || !grille) return;
  const s = grille.scrabbles[+li.dataset.i];
  if (trouves.has(s.word)) souligne(s);
};
$("gdjSub").textContent = "chargement du dictionnaire…";
worker.postMessage({ type: "init" });
