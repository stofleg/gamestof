//  Grille puzzle — une grille finale est générée puis découpée en pièces
//  irrégulières, mélangées dans la réserve. Il faut la reconstituer : glisser
//  chaque pièce à sa place sur la grille vide. Une pièce peut être posée partout
//  où elle tient (même au mauvais endroit) et reprise ensuite ; la grille est
//  validée quand chaque case correspond à la solution.
import { chargeDico, grilleFinale, classeCase, jeton, appliqueTheme, melange, fmt } from "./grille-finale.js?v=380";

const $ = id => document.getElementById(id);
const N = 15;
let solution = null;      // board de la grille générée
let pieces = [];          // { id, cells: [[dr,dc]...], r0, c0 (place correcte), pose: {r,c}|null }
let occupe = [];          // occupe[r][c] = id de la pièce posée, ou null
let t0 = 0, minuteur = null, fini = false;

appliqueTheme();

// --- découpage en pièces irrégulières -----------------------------------------
/**
 * Croissance de régions : on sème des germes au hasard, puis chaque région
 * s'étend case par case vers une voisine libre, en tirant au sort la région qui
 * grandit (les plus petites d'abord). Les régions trop petites sont fondues dans
 * une voisine. Résultat : 25 à 30 pièces de 5 à 12 cases, aux contours variés.
 */
function decoupe(nGermes = 28, tailleMin = 5) {
  const reg = Array.from({ length: N }, () => Array(N).fill(-1));
  const tailles = [];
  const libres = melange([...Array(N * N).keys()]);
  for (let g = 0; g < nGermes; g++) {
    const k = libres[g]; reg[Math.floor(k / N)][k % N] = g; tailles.push(1);
  }
  const voisins = (r, c) => [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([y,x]) => y>=0 && y<N && x>=0 && x<N);
  let restant = N * N - nGermes;
  while (restant > 0) {
    // une région prise au hasard, pondérée vers les plus petites
    const ordre = melange([...tailles.keys()]).sort((a, b) => tailles[a] - tailles[b] + (Math.random() - .5) * 6);
    let grandi = false;
    for (const g of ordre) {
      const bord = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
        if (reg[r][c] === g) for (const [y, x] of voisins(r, c)) if (reg[y][x] === -1) bord.push([y, x]);
      if (!bord.length) continue;
      const [y, x] = bord[Math.floor(Math.random() * bord.length)];
      reg[y][x] = g; tailles[g]++; restant--; grandi = true; break;
    }
    if (!grandi) break;
  }
  // fusion des régions trop petites dans une voisine
  for (let passe = 0; passe < 4; passe++) {
    for (let g = 0; g < tailles.length; g++) {
      if (!tailles[g] || tailles[g] >= tailleMin) continue;
      const autour = new Map();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
        if (reg[r][c] === g) for (const [y, x] of voisins(r, c)) if (reg[y][x] !== g) autour.set(reg[y][x], 1);
      const cible = [...autour.keys()].sort((a, b) => tailles[a] - tailles[b])[0];
      if (cible == null) continue;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (reg[r][c] === g) reg[r][c] = cible;
      tailles[cible] += tailles[g]; tailles[g] = 0;
    }
  }
  // pièces : cases relatives à leur coin haut-gauche
  const out = [];
  for (let g = 0; g < tailles.length; g++) {
    if (!tailles[g]) continue;
    const cs = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (reg[r][c] === g) cs.push([r, c]);
    const r0 = Math.min(...cs.map(x => x[0])), c0 = Math.min(...cs.map(x => x[1]));
    out.push({ id: out.length, cells: cs.map(([r, c]) => [r - r0, c - c0]), r0, c0, pose: null });
  }
  return out;
}

// --- rendu ------------------------------------------------------------------------
function htmlPiece(p) {
  const h = Math.max(...p.cells.map(x => x[0])) + 1, w = Math.max(...p.cells.map(x => x[1])) + 1;
  const dans = new Set(p.cells.map(([r, c]) => r * N + c));
  let s = `<table>`;
  for (let r = 0; r < h; r++) {
    s += "<tr>";
    for (let c = 0; c < w; c++) {
      if (!dans.has(r * N + c)) { s += `<td class="trou"></td>`; continue; }
      const R = p.r0 + r, C = p.c0 + c, t = solution[R][C];
      s += `<td class="${classeCase(R, C)}${t ? " has-tile" : ""}" data-dr="${r}" data-dc="${c}">${jeton(t)}</td>`;
    }
    s += "</tr>";
  }
  return s + "</table>";
}

function dessineGrille() {
  let s = "<table>";
  for (let r = 0; r < N; r++) {
    s += "<tr>";
    for (let c = 0; c < N; c++) {
      const id = occupe[r][c];
      if (id == null) { s += `<td class="vide" data-r="${r}" data-c="${c}"></td>`; continue; }
      // la case montre le contenu de la pièce posée, pas forcément la solution
      const p = pieces[id], dr = r - p.pose.r, dc = c - p.pose.c;
      const R = p.r0 + dr, C = p.c0 + dc, t = solution[R][C];
      s += `<td class="${classeCase(R, C)}${t ? " has-tile" : ""} posee" data-r="${r}" data-c="${c}" data-id="${id}">${jeton(t)}</td>`;
    }
    s += "</tr>";
  }
  $("pzBoard").innerHTML = s + "</table>";
}

function dessineReserve() {
  $("pzTray").innerHTML = pieces.filter(p => !p.pose)
    .map(p => `<div class="board piece" data-id="${p.id}">${htmlPiece(p)}</div>`).join("");
}

// --- glisser-déposer ----------------------------------------------------------------
let prise = null;   // { p, el, dr, dc, dx, dy }

function prend(p, e, dr, dc) {
  const el = document.createElement("div");
  el.className = "board piece drag";
  el.innerHTML = htmlPiece(p);
  document.body.appendChild(el);
  const cell = el.querySelector(`td[data-dr="${dr}"][data-dc="${dc}"]`).getBoundingClientRect();
  const box = el.getBoundingClientRect();
  prise = { p, el, dr, dc, dx: cell.left - box.left + cell.width / 2, dy: cell.top - box.top + cell.height / 2 };
  bouge(e);
}
function bouge(e) {
  if (!prise) return;
  prise.el.style.left = (e.clientX - prise.dx) + "px";
  prise.el.style.top = (e.clientY - prise.dy) + "px";
}
function lache(e) {
  if (!prise) return;
  const { p, el, dr, dc } = prise;
  el.remove(); prise = null;
  const sous = document.elementFromPoint(e.clientX, e.clientY)?.closest("#pzBoard td");
  if (sous) {
    const r = +sous.dataset.r - dr, c = +sous.dataset.c - dc;
    if (tient(p, r, c)) pose(p, r, c);
  }
  dessineGrille(); dessineReserve(); verifie();
}
function tient(p, r, c) {
  return p.cells.every(([dr, dc]) => {
    const y = r + dr, x = c + dc;
    return y >= 0 && y < N && x >= 0 && x < N && (occupe[y][x] == null || occupe[y][x] === p.id);
  });
}
function retire(p) {
  if (!p.pose) return;
  for (const [dr, dc] of p.cells) occupe[p.pose.r + dr][p.pose.c + dc] = null;
  p.pose = null;
}
function pose(p, r, c) {
  retire(p);
  p.pose = { r, c };
  for (const [dr, dc] of p.cells) occupe[r + dr][c + dc] = p.id;
}

$("pzTray").addEventListener("pointerdown", e => {
  if (fini) return;
  const td = e.target.closest("td[data-dr]"), el = e.target.closest(".piece");
  if (!td || !el) return;
  e.preventDefault();
  prend(pieces[+el.dataset.id], e, +td.dataset.dr, +td.dataset.dc);
});
$("pzBoard").addEventListener("pointerdown", e => {
  if (fini) return;
  const td = e.target.closest("td.posee");
  if (!td) return;
  e.preventDefault();
  const p = pieces[+td.dataset.id];
  const dr = +td.dataset.r - p.pose.r, dc = +td.dataset.c - p.pose.c;
  retire(p); dessineGrille();
  prend(p, e, dr, dc);
});
window.addEventListener("pointermove", bouge);
window.addEventListener("pointerup", lache);
// clic droit sur une pièce posée : elle retourne dans la réserve
$("pzBoard").addEventListener("contextmenu", e => {
  const td = e.target.closest("td.posee");
  if (!td) return;
  e.preventDefault();
  retire(pieces[+td.dataset.id]); dessineGrille(); dessineReserve();
});

// --- partie ----------------------------------------------------------------------------
/** Grille reconstituée : chaque case affiche le même contenu que la solution. */
function verifie() {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const id = occupe[r][c];
    if (id == null) return;
    const p = pieces[id], R = p.r0 + r - p.pose.r, C = p.c0 + c - p.pose.c;
    const a = solution[R][C], b = solution[r][c];
    if (classeCase(R, C) !== classeCase(r, c)) return;
    if (!!a !== !!b || (a && (a.letter !== b.letter || !!a.isBlank !== !!b.isBlank))) return;
  }
  fini = true;
  clearInterval(minuteur);
  const s = (performance.now() - t0) / 1000;
  $("pzChrono").textContent = fmt(s);
  $("pzMsg").textContent = `Grille reconstituée en ${fmt(s)} !`;
  $("pzBoard").classList.add("gagne");
}

let dict = null;
async function nouvelle() {
  $("pzNew").disabled = true;
  $("pzMsg").textContent = "Génération de la grille…";
  fini = false; clearInterval(minuteur);
  $("pzBoard").classList.remove("gagne");
  if (!dict) dict = await chargeDico();
  await new Promise(r => setTimeout(r, 20));
  solution = grilleFinale(dict).board;
  pieces = melange(decoupe());
  pieces.forEach((p, i) => p.id = i);
  occupe = Array.from({ length: N }, () => Array(N).fill(null));
  dessineGrille(); dessineReserve();
  $("pzMsg").textContent = `${pieces.length} pièces à replacer — clic droit sur une pièce posée pour la reprendre.`;
  t0 = performance.now();
  minuteur = setInterval(() => { $("pzChrono").textContent = fmt((performance.now() - t0) / 1000); }, 250);
  $("pzNew").disabled = false;
}
$("pzNew").onclick = nouvelle;
nouvelle();
