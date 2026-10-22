//  Grille Tetris — une grille finale est générée puis découpée en pièces de
//  Tetris qui tombent une à une (dans un ordre qui permet de les poser de bas en
//  haut). Le joueur les déplace et les tourne pour reconstituer la grille. Il
//  peut recommencer la grille à tout moment : le chrono continue, son temps
//  final cumule les essais ratés et l'essai réussi.
import { chargeDico, grilleFinale, classeCase, jeton, appliqueTheme, fmt } from "./grille-finale.js?v=376";
import { decoupeTetris, tourne } from "./tetris-pieces.js?v=376";

const $ = id => document.getElementById(id);
const N = 15;
const CHUTE_MS = 1000;
let solution = null;
let pieces = [];        // chaque pièce : liste de [r, c] dans la solution
let pose = [];          // pose[r][c] = [R, C] (case source de la solution) ou null
let rang = 0;           // pièce en cours
let chute = null;       // { cs: [[dr, dc, R, C]...], r, c }
let t0 = 0, minuteur = null, gravite = null, echecs = 0, enJeu = false;

appliqueTheme();

const contenu = (R, C) => ({ cls: classeCase(R, C), t: solution[R][C] });
const td = (R, C, extra = "") => {
  const { cls, t } = contenu(R, C);
  return `<td class="${cls}${t ? " has-tile" : ""}${extra}">${jeton(t)}</td>`;
};

// --- pièces -------------------------------------------------------------------------
function nouvellePiece(i) {
  const src = pieces[i];
  const r0 = Math.min(...src.map(x => x[0])), c0 = Math.min(...src.map(x => x[1]));
  let cs = src.map(([R, C]) => [R - r0, C - c0, R, C]);
  for (let k = Math.floor(Math.random() * 4); k > 0; k--) cs = tournePiece(cs);
  return cs;
}
function tournePiece(cs) {
  const t = tourne(cs.map(x => [x[0], x[1]]));
  return cs.map((x, i) => [t[i][0], t[i][1], x[2], x[3]]);
}
const largeur = cs => Math.max(...cs.map(x => x[1])) + 1;
const libre = (cs, r, c) => cs.every(([dr, dc]) => {
  const y = r + dr, x = c + dc;
  return x >= 0 && x < N && y < N && (y < 0 || !pose[y][x]);
});

function htmlApercu(cs) {
  const h = Math.max(...cs.map(x => x[0])) + 1, w = largeur(cs);
  const m = new Map(cs.map(x => [x[0] * N + x[1], x]));
  let s = "<table>";
  for (let r = 0; r < h; r++) {
    s += "<tr>";
    for (let c = 0; c < w; c++) { const x = m.get(r * N + c); s += x ? td(x[2], x[3]) : `<td class="trou"></td>`; }
    s += "</tr>";
  }
  return `<div class="board piece">${s}</table></div>`;
}

// --- rendu ---------------------------------------------------------------------------
let suivante = null;
function dessine() {
  const enChute = new Map();
  if (chute) for (const [dr, dc, R, C] of chute.cs) enChute.set((chute.r + dr) * N + chute.c + dc, [R, C]);
  let s = "<table>";
  for (let r = 0; r < N; r++) {
    s += "<tr>";
    for (let c = 0; c < N; c++) {
      const f = enChute.get(r * N + c), p = pose[r][c];
      if (f) s += td(f[0], f[1], " chute");
      else if (p) s += td(p[0], p[1]);
      else s += `<td class="vide"></td>`;
    }
    s += "</tr>";
  }
  $("pzBoard").innerHTML = s + "</table>";
}
function dessineCote() {
  $("ttNext").innerHTML = suivante ? htmlApercu(suivante) : "";
  $("ttCompte").textContent = `${rang} / ${pieces.length}`;
  $("ttEchecs").textContent = echecs;
}

// --- déroulement ---------------------------------------------------------------------
function lance() {
  if (rang >= pieces.length) { fin(); return; }
  const cs = suivante || nouvellePiece(rang);
  suivante = rang + 1 < pieces.length ? nouvellePiece(rang + 1) : null;
  const h = Math.max(...cs.map(x => x[0])) + 1;
  chute = { cs, r: -h + 1, c: Math.floor((N - largeur(cs)) / 2) };
  if (!libre(cs, chute.r, chute.c)) { chute = null; rate("Plus de place pour la pièce suivante."); return; }
  dessine(); dessineCote();
}
function descend() {
  if (!chute) return false;
  if (libre(chute.cs, chute.r + 1, chute.c)) { chute.r++; dessine(); return true; }
  verrouille(); return false;
}
function verrouille() {
  const { cs, r, c } = chute;
  if (cs.some(([dr]) => r + dr < 0)) { chute = null; rate("La pile dépasse du plateau."); return; }
  for (const [dr, dc, R, C] of cs) pose[r + dr][c + dc] = [R, C];
  chute = null; rang++;
  lance();
}
/** Grille complète : identique à la solution, case par case. */
function fin() {
  const ok = pose.every((ligne, r) => ligne.every((p, c) => {
    if (!p) return false;
    const a = contenu(p[0], p[1]), b = contenu(r, c);
    return a.cls === b.cls && !!a.t === !!b.t && (!a.t || (a.t.letter === b.t.letter && !!a.t.isBlank === !!b.t.isBlank));
  }));
  if (!ok) { rate("La grille est remplie, mais elle ne correspond pas à la solution."); return; }
  arrete();
  clearInterval(minuteur);
  const s = (performance.now() - t0) / 1000;
  $("pzChrono").textContent = fmt(s);
  $("pzMsg").textContent = `Grille reconstituée en ${fmt(s)}` + (echecs ? ` (dont ${echecs} essai${echecs > 1 ? "s" : ""} raté${echecs > 1 ? "s" : ""})` : "") + " !";
  $("pzBoard").classList.add("gagne");
  dessine();
}
function rate(msg) {
  arrete(); echecs++; dessineCote();
  $("pzMsg").textContent = `${msg} Recommencez la grille (le chrono continue).`;
  $("pzBoard").classList.add("rate");
  dessine();
}
function arrete() { enJeu = false; clearInterval(gravite); }

/** (Re)commence la même grille ; le chrono n'est pas remis à zéro. */
function essai() {
  arrete();
  $("pzBoard").classList.remove("rate", "gagne");
  pose = Array.from({ length: N }, () => Array(N).fill(null));
  rang = 0; suivante = null; chute = null; enJeu = true;
  $("pzMsg").textContent = "Placez chaque pièce à sa place dans la grille.";
  lance();
  gravite = setInterval(descend, CHUTE_MS);
}

document.addEventListener("keydown", e => {
  if (!enJeu || !chute) return;
  const k = e.key;
  if (k === "ArrowLeft" && libre(chute.cs, chute.r, chute.c - 1)) chute.c--;
  else if (k === "ArrowRight" && libre(chute.cs, chute.r, chute.c + 1)) chute.c++;
  else if (k === "ArrowUp") {
    const t = tournePiece(chute.cs);
    // petit décalage latéral si la rotation heurte un bord ou une pièce
    for (const d of [0, -1, 1, -2, 2]) if (libre(t, chute.r, chute.c + d)) { chute.cs = t; chute.c += d; break; }
  }
  else if (k === "ArrowDown") { descend(); }
  else if (k === " ") { while (descend()) ; e.preventDefault(); return; }
  else return;
  e.preventDefault();
  if (chute) dessine();
});

$("ttRelance").onclick = () => {
  if (enJeu) echecs++;          // abandon en cours d'essai (un échec constaté est déjà compté)
  essai(); dessineCote(); $("ttRelance").blur();
};

let dict = null;
async function nouvelle() {
  $("pzNew").disabled = $("ttRelance").disabled = true;
  $("pzMsg").textContent = "Génération de la grille…";
  arrete(); clearInterval(minuteur);
  if (!dict) dict = await chargeDico();
  await new Promise(r => setTimeout(r, 20));
  solution = grilleFinale(dict).board;
  pieces = decoupeTetris();
  echecs = 0;
  t0 = performance.now();
  minuteur = setInterval(() => { $("pzChrono").textContent = fmt((performance.now() - t0) / 1000); }, 250);
  essai(); dessineCote();
  $("pzNew").disabled = $("ttRelance").disabled = false;
  $("pzNew").blur();
}
$("pzNew").onclick = nouvelle;
nouvelle();
