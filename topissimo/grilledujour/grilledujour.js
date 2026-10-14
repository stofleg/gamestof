//  Grille du jour — page autonome.
//  Charge le dictionnaire, cherche une position offrant 3 à 10 scrabbles variés,
//  et laisse proposer des mots jusqu'à les avoir tous trouvés.
import { Dictionary } from "../scrabble/dictionary.js?v=369";
import { BOARD_BONUSES } from "../scrabble/engine.js?v=369";
import { chercheGrille } from "../scrabble/grille-du-jour.js?v=369";

const $ = id => document.getElementById(id);
const LIGNES = "ABCDEFGHIJKLMNO";
let dict = null, grille = null, trouves = new Set();

/** Repère à la mode Scrabble : lettre = ligne, chiffre = colonne ;
 *  horizontal = lettre d'abord (H4), vertical = chiffre d'abord (4H). */
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

/** Met en relief les cases d'un scrabble trouvé. */
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
    const vars = vu && s.variantes.length ? `<span class="var">ou ${s.variantes.join(", ")}</span>` : "";
    return `<li class="${vu ? "found" : ""}" data-i="${i}">
      <span class="w ${vu ? "" : "masked"}">${vu ? s.word : "·".repeat(s.word.length)}</span>
      <span class="pos">${vu ? repere(s) : ""}</span>
      ${vars}
      <span class="sc">${vu ? s.score + " pts" : "—"}</span>
    </li>`;
  }).join("");
  const n = trouves.size, t = grille.scrabbles.length;
  $("gdjSub").textContent = `${n}/${t} trouvé${n > 1 ? "s" : ""} · coup ${grille.coup} de la partie`;
}

function propose() {
  const mot = ($("gdjInput").value || "").trim().toUpperCase();
  $("gdjInput").value = "";
  if (!mot) return;
  const msg = $("gdjMsg");
  const cible = grille.scrabbles.find(s => s.word === mot || s.variantes.includes(mot));
  if (!cible) {
    const estScrabble = dict.has(mot) && mot.length >= 7;
    msg.className = "gdj-msg ko";
    msg.textContent = estScrabble
      ? `${mot} est dans le dictionnaire, mais ne passe pas sur cette grille.`
      : `${mot} n'est pas un scrabble de cette grille.`;
    return;
  }
  if (trouves.has(cible.word)) {
    msg.className = "gdj-msg"; msg.textContent = `${cible.word}, déjà trouvé.`;
    return;
  }
  trouves.add(cible.word);
  msg.className = "gdj-msg ok";
  msg.textContent = `${mot} en ${repere(cible)} — ${cible.score} points.`
    + (mot !== cible.word ? ` (compté comme ${cible.word}, mêmes cases)` : "");
  souligne(cible);
  dessineListe();
  if (trouves.size === grille.scrabbles.length) {
    msg.textContent += "  Grille terminée.";
  }
}

async function nouvelle() {
  for (const b of ["gdjGo", "gdjReveal", "gdjNew"]) $(b).disabled = true;
  $("gdjInput").disabled = true;
  $("gdjSub").textContent = "recherche d'une grille…";
  $("gdjMsg").className = "gdj-msg"; $("gdjMsg").textContent = "";
  // laisse le navigateur peindre avant la recherche, qui bloque quelques secondes
  await new Promise(r => setTimeout(r, 30));
  const t0 = performance.now();
  grille = chercheGrille(dict);
  if (!grille) { $("gdjSub").textContent = "aucune grille trouvée, réessaie"; $("gdjNew").disabled = false; return; }
  console.log(`grille trouvée en ${((performance.now()-t0)/1000).toFixed(1)} s `
    + `(${grille.parties} partie(s), ${grille.ancres} ancres)`);
  trouves = new Set();
  dessineGrille(); dessineListe();
  for (const b of ["gdjGo", "gdjReveal", "gdjNew"]) $(b).disabled = false;
  $("gdjInput").disabled = false; $("gdjInput").focus();
}

(async function init() {
  dict = await new Dictionary().load("../scrabble/ods9.txt");
  $("gdjGo").onclick = propose;
  $("gdjInput").onkeydown = e => { if (e.key === "Enter") propose(); };
  $("gdjNew").onclick = nouvelle;
  $("gdjReveal").onclick = () => {
    grille.scrabbles.forEach(s => trouves.add(s.word));
    dessineListe();
    $("gdjMsg").className = "gdj-msg"; $("gdjMsg").textContent = "Tout est révélé.";
  };
  $("gdjList").onclick = e => {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    const s = grille.scrabbles[+li.dataset.i];
    if (trouves.has(s.word)) souligne(s);
  };
  await nouvelle();
})();
