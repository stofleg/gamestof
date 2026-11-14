// ============================================================
//  Grille cube : écran de jeu (entraînement). Moteur : cube.js.
//  La face active est affichée à plat, bordée d'un liseré de la face voisine (ou d'un mur),
//  avec des flèches pour tourner le cube (grisées derrière un mur). Le pivot montre un
//  instant les deux faces ensemble (mots à cheval sur l'arête).
// ============================================================
import { Dictionary } from "./dictionary.js?v=483";
import { LETTER_BAG, drawForDuplicate, bagTotalVowels, bagTotalConsonants, letterValue } from "./engine.js?v=483";
import {
  FACES, NOM_FACE, BONUS_CUBE, LIGNES, ligneDe, voisin, rangLigne, PIVOTS, cheminFaces,
  cubeVide, appliqueCoup, casesDuCoup, positionCoup, scoreCube, topCube, sacCube, JEUX_CUBE,
} from "./cube.js?v=483";

const $ = id => document.getElementById(id);
const TEMPS = 120;
const CLASSE = { ".": "", d: "dl", t: "tl", D: "dw", T: "tw", "*": "dw etoile" };
const VOY = new Set(["A", "E", "I", "O", "U", "Y"]);
const TITRES = { F: "Principale ★", R: "Droite", B: "Arrière", L: "Gauche", U: "Dessus", D: "Dessous" };

let dict = null;
const S = {
  cube: cubeVide(), bag: null, rack: [], pending: [], face: "F", cursor: null, coup: 0,
  top: null, best: null, cumul: 0, neg: 0, tops: 0, fin: false, debut: 0, topCells: [], anim: false,
};
let nextId = 1, minuteur = null;
// Toutes les actions du joueur passent par une file : une lettre tapée pendant que le cube
// tourne attend la fin du pivot et de la lettre précédente (ordre de saisie garanti).
let file = Promise.resolve();
const enFile = action => { file = file.then(action).catch(e => console.error(e)); return file; };

// ------------------------------------------------------------ rendu
const cle = cs => cs.join();
function tuile(cs) {
  const p = S.pending.find(x => x.f === cs[0] && x.r === cs[1] && x.c === cs[2]);
  if (p) return { letter: p.letter, isBlank: p.isBlank, pose: true, invalide: p.invalide };
  return S.cube[cs[0]][cs[1]][cs[2]];
}
function htmlCase(cs, extra = "") {
  const [f, r, c] = cs, t = tuile(cs);
  const cls = ["c", CLASSE[BONUS_CUBE[f][r][c]] || ""];
  if (f !== "F" && BONUS_CUBE[f][r][c] === "*") cls.push("dw");
  if (t) cls.push("has");
  if (S.topCells.some(x => cle(x) === cle(cs))) cls.push("top");
  const cur = !extra && S.cursor && cle([S.cursor.f, S.cursor.r, S.cursor.c]) === cle(cs);
  if (cur) cls.push("curseur");
  const j = t ? `<div class="jeton${t.isBlank ? " joker" : ""}${t.pose ? " pose" : ""}${t.invalide ? " invalide" : ""}">${t.letter}${t.isBlank ? "" : `<span>${letterValue(t.letter)}</span>`}</div>` : "";
  return `<div class="${cls.join(" ")} ${extra}" data-f="${f}" data-r="${r}" data-c="${c}">${j}${cur ? `<span class="dir">${S.cursor.dir === "H" ? "→" : "↓"}</span>` : ""}</div>`;
}
/** Grille 17×17 d'une face : liserés (cases voisines ou murs) autour des 15×15 cases. */
function htmlFace(f) {
  const bord = cs => cs ? htmlCase(cs, "liseret") : `<div class="mur"></div>`;
  let h = `<div class="face">`;
  h += `<div class="coin"></div>`;
  for (let c = 0; c < 15; c++) h += bord(voisin(f, 0, c, "V", -1));
  h += `<div class="coin"></div>`;
  for (let r = 0; r < 15; r++) {
    h += bord(voisin(f, r, 0, "H", -1));
    for (let c = 0; c < 15; c++) h += htmlCase([f, r, c]);
    h += bord(voisin(f, r, 14, "H", 1));
  }
  h += `<div class="coin"></div>`;
  for (let c = 0; c < 15; c++) h += bord(voisin(f, 14, c, "V", 1));
  return h + `<div class="coin"></div></div>`;
}
function dessine() {
  $("cadre").innerHTML = htmlFace(S.face);
  $("titreFace").textContent = TITRES[S.face];
  const p = PIVOTS[S.face];
  $("fGauche").disabled = !p.gauche; $("fDroite").disabled = !p.droite; $("fHaut").disabled = !p.haut; $("fBas").disabled = !p.bas;
  for (const [id, dirn] of [["fGauche", "gauche"], ["fDroite", "droite"], ["fHaut", "haut"], ["fBas", "bas"]])
    $(id).title = p[dirn] ? `Face ${NOM_FACE[p[dirn]]}` : "Mur : pas de passage de ce côté";
  dessineChevalet();
}
function dessineChevalet() {
  $("rack").innerHTML = S.rack.map(t => `<div class="t${t.used ? " used" : ""}${t.letter === "?" ? " joker" : ""}" data-id="${t.id}">${t.letter}${t.letter === "?" ? "" : `<span>${letterValue(t.letter)}</span>`}</div>`).join("");
}
function infos() {
  $("iCoup").textContent = S.coup || "—"; $("iCumul").textContent = S.cumul; $("iNeg").textContent = S.neg; $("iTops").textContent = S.tops;
}
function message(html, cls = "") { const m = $("msg"); m.innerHTML = html; m.className = "msg" + (cls ? " " + cls : ""); }

// ------------------------------------------------------------ pivot du cube
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROT = { droite: ["rotateY(90deg)", "rotateY(-45deg)", "rotateY(-90deg)"], gauche: ["rotateY(-90deg)", "rotateY(45deg)", "rotateY(90deg)"],
  haut: ["rotateX(90deg)", "rotateX(-45deg)", "rotateX(-90deg)"], bas: ["rotateX(-90deg)", "rotateX(45deg)", "rotateX(90deg)"] };
/** Pivote vers la face voisine `sens` ; `pause` : temps d'arrêt à mi-chemin (deux faces visibles). */
async function pivote(sens, pause = 650) {
  const cible = PIVOTS[S.face][sens];
  if (!cible || S.anim) return false;
  S.anim = true;
  const w = $("cadre").offsetWidth, h = $("cadre").offsetHeight, demi = (sens === "haut" || sens === "bas" ? h : w) / 2;
  const scene = $("scene"), prisme = $("prisme");
  scene.style.width = w + "px"; scene.style.height = h + "px";
  prisme.style.transition = "none";
  prisme.style.transform = `translateZ(${-demi}px)`;
  prisme.innerHTML = `<div class="pf cadre" style="transform: translateZ(${demi}px)">${htmlFace(S.face)}</div>`
    + `<div class="pf cadre" style="transform: ${ROT[sens][0]} translateZ(${demi}px)">${htmlFace(cible)}</div>`;
  scene.classList.add("on");
  $("cadre").style.visibility = "hidden";
  await sleep(20);
  prisme.style.transition = "";
  prisme.style.transform = `translateZ(${-demi}px) ${ROT[sens][1]}`;
  await sleep(380 + pause);
  prisme.style.transform = `translateZ(${-demi}px) ${ROT[sens][2]}`;
  await sleep(400);
  S.face = cible;
  dessine();
  $("cadre").style.visibility = "";
  scene.classList.remove("on");
  S.anim = false;
  return true;
}
async function allerVers(face, pause = 0) { for (const s of cheminFaces(S.face, face)) await pivote(s, pause); }

// ------------------------------------------------------------ partie
async function nouvellePartie() {
  clearInterval(minuteur);
  Object.assign(S, { cube: cubeVide(), bag: sacCube(JEUX_CUBE, LETTER_BAG),   // 6 jeux de jetons, un par face rack: [], pending: [], face: "F", cursor: { f: "F", r: 7, c: 7, dir: "H" },
    coup: 0, top: null, best: null, cumul: 0, neg: 0, tops: 0, fin: false, topCells: [] });
  infos();
  nouveauCoup();
}
function nouveauCoup() {
  const kept = S.rack.map(t => t.letter);
  let v = bagTotalVowels(S.bag), c = bagTotalConsonants(S.bag);
  for (const L of kept) { if (L === "?") continue; if (VOY.has(L)) v++; else c++; }
  const jok = (S.bag["?"] || 0) + kept.filter(l => l === "?").length, ys = (S.bag.Y || 0) + kept.filter(l => l === "Y").length;
  if ((v === 0 || c === 0) && !jok && !ys) return finPartie();
  const res = drawForDuplicate(S.bag, kept, S.coup + 1, 7, {});
  if (res.failed) return finPartie();
  S.bag = res.bag;
  let lettres = res.fresh ? kept.filter(l => l === "?") : kept;
  lettres = lettres.concat(res.drawn || []);
  if (!lettres.length) return finPartie();
  S.coup++;
  S.rack = lettres.map(letter => ({ letter, used: false, id: nextId++ }));
  S.pending = []; S.best = null; S.top = null;
  infos(); dessine();
  message("Calcul du top…");
  setTimeout(() => {
    S.top = topCube(S.cube, S.rack.map(t => t.letter), dict, { maxTilesUsed: 7 });
    if (!S.top) return finPartie();
    message(S.coup === 1 ? "Premier coup : il passe par l'étoile de la face principale." : "À toi de jouer.");
    S.debut = Date.now();
    clearInterval(minuteur);
    minuteur = setInterval(tic, 250); tic();
  }, 30);
}
function tic() {
  const reste = Math.max(0, TEMPS - (Date.now() - S.debut) / 1000);
  $("cLabel").textContent = `COUP ${S.coup}`; $("cTemps").textContent = `${Math.ceil(reste)}s`;
  if (reste <= 0) finCoup("timeout");
}
/** Fin du coup : top trouvé, temps écoulé ou « Voir le top ». Le top officiel est posé. */
async function finCoup(statut, joue = null) {
  if (!S.top || S.fin) return;
  clearInterval(minuteur);
  const top = S.top, mv = top.move;
  const score = statut === "top" ? top.score : (S.best?.score || 0);
  S.cumul += score; S.neg += score - top.score; if (statut === "top") S.tops++;
  // lettres du top retirées du chevalet (le reliquat reste pour le coup suivant)
  const restants = S.rack.map(t => t.letter);
  casesDuCoup(mv).forEach((cs, i) => {
    if (S.cube[cs[0]][cs[1]][cs[2]]) return;
    let k = restants.indexOf(mv.blanks.includes(i) ? "?" : mv.word[i]);
    if (k < 0) k = restants.indexOf("?");
    if (k >= 0) restants.splice(k, 1);
  });
  S.cube = appliqueCoup(S.cube, mv);
  S.topCells = casesDuCoup(mv);
  S.pending = []; S.top = null;
  S.rack = restants.map(letter => ({ letter, used: false, id: nextId++ }));
  infos();
  const lib = `<span class="top">✅ Top : <b>${mv.word}</b> — ${top.score} pts, ${positionCoup(mv)}${top.isotops > 1 ? ` (${top.isotops} isotops)` : ""}</span>`;
  message(statut === "top" ? `${lib}Bravo, tu as trouvé le top !` : `${lib}${statut === "timeout" ? "⏱ Temps écoulé" : "Top révélé"} — tu marques ${score} pts${S.best ? ` (${S.best.word})` : ""}.`, statut === "top" ? "ok" : "");
  // la vue va montrer le top (face de sa 1re lettre), sans arrêt aux étapes
  await allerVers(S.topCells[0][0], 0);
  S.cursor = null;
  dessine();
  setTimeout(nouveauCoup, statut === "top" ? 600 : 1500);
}
function finPartie() {
  S.fin = true; clearInterval(minuteur);
  $("cTemps").textContent = "—";
  message(`<b>Partie terminée</b> en ${S.coup} coups : ${S.cumul} points, négatif ${S.neg}, ${S.tops} tops trouvés.`, "ok");
}

// ------------------------------------------------------------ saisie
function avance(cur, delta = 1) {
  let cs = [cur.f, cur.r, cur.c];
  for (let n = 0; n < 60; n++) {
    cs = voisin(cs[0], cs[1], cs[2], cur.dir, delta);
    if (!cs) return null;   // mur ou bord
    if (!S.cube[cs[0]][cs[1]][cs[2]] && !S.pending.some(p => p.f === cs[0] && p.r === cs[1] && p.c === cs[2])) return { f: cs[0], r: cs[1], c: cs[2], dir: cur.dir };
  }
  return null;
}
async function suitCurseur() {
  if (S.cursor && S.cursor.f !== S.face) await allerVers(S.cursor.f, 0);
  else dessine();
}
async function pose(L, tileId = null) {
  if (!S.top || S.fin) return;
  if (!S.cursor) return message("Touche d'abord une case de la grille.", "err");
  let cur = S.cursor;
  if (S.cube[cur.f][cur.r][cur.c]) { cur = avance(cur); if (!cur) return; }
  let t = tileId != null ? S.rack.find(x => x.id === tileId && !x.used) : S.rack.find(x => !x.used && x.letter === L);
  if (!t && tileId == null) t = S.rack.find(x => !x.used && x.letter === "?");
  if (!t) return message(`Pas de ${L} dans ton tirage.`, "err");
  let isBlank = t.letter === "?";
  if (isBlank && (!L || L === "?")) { L = await choisitJoker(); if (!L) return; }
  // la vue ne tourne que si la lettre tombe vraiment sur une autre face (mot à cheval)
  if (cur.f !== S.face) await allerVers(cur.f, 0);
  t.used = true;
  S.pending.push({ f: cur.f, r: cur.r, c: cur.c, letter: L, isBlank, id: t.id });
  S.cursor = avance(cur) || null;
  dessine();
}
async function retire() {
  const p = S.pending.pop(); if (!p) return;
  S.rack.find(t => t.id === p.id).used = false;
  S.cursor = { f: p.f, r: p.r, c: p.c, dir: S.cursor?.dir || "H" };
  await suitCurseur();
}
async function efface() {
  if (!S.pending.length) return;
  const p0 = S.pending[0];
  for (const p of S.pending) S.rack.find(t => t.id === p.id).used = false;
  S.pending = [];
  S.cursor = { f: p0.f, r: p0.r, c: p0.c, dir: S.cursor?.dir || "H" };
  await suitCurseur();
}
/** Coup formé par les lettres posées : même ligne (horizontale ou verticale du cube), sans trou. */
function coupDesPoses() {
  if (!S.pending.length) return null;
  const essais = S.pending.length === 1 ? [S.cursor?.dir || "H", S.cursor?.dir === "V" ? "H" : "V"] : ["H", "V"];
  for (const dir of essais) {
    const lk = S.pending.map(p => ligneDe(p.f, p.r, p.c, dir));
    if (!lk.every(x => x[0] === lk[0][0])) continue;
    const L = LIGNES[lk[0][0]], n = L.cases.length;
    if (S.pending.length === 1) {   // une seule lettre : il faut un voisin dans ce sens
      const [f, r, c] = [S.pending[0].f, S.pending[0].r, S.pending[0].c];
      const occ = d => { const v = voisin(f, r, c, dir, d); return v && S.cube[v[0]][v[1]][v[2]]; };
      if (!occ(-1) && !occ(1) && dir === essais[0] && essais.length > 1) continue;
    }
    // début : la lettre posée d'où les autres sont « en avant » au plus court (bande en boucle)
    const ks = lk.map(x => x[1]);
    let depart = ks[0], span = Infinity;
    for (const k0 of ks) { const s = Math.max(...ks.map(k => (L.cyclique ? (k - k0 + n) % n : k - k0))); if (s >= 0 && s < span && ks.every(k => (L.cyclique ? true : k >= k0))) { span = s; depart = k0; } }
    const lettre = k => { const cs = rangLigne(L, k); if (!cs) return null; const p = S.pending.find(x => x.f === cs[0] && x.r === cs[1] && x.c === cs[2]); return p ? { letter: p.letter, isBlank: p.isBlank } : S.cube[cs[0]][cs[1]][cs[2]]; };
    let a = depart; while (lettre(a - 1) && depart - (a - 1) < n) a--;
    let b = depart + span; while (lettre(b + 1) && (b + 1) - a < n) b++;
    let word = "", blanks = [];
    for (let k = a; k <= b; k++) { const t = lettre(k); if (!t) return { erreur: "Les lettres doivent former un seul mot, sans trou." }; if (t.isBlank && S.pending.some(p => cle([p.f, p.r, p.c]) === cle(rangLigne(L, k)))) blanks.push(word.length); word += t.letter; }
    return { move: { ligne: lk[0][0], debut: L.cyclique ? ((a % n) + n) % n : a, word, blanks } };
  }
  return { erreur: "Les lettres doivent être alignées sur une même ligne du cube." };
}
async function valide() {
  if (!S.top || S.fin || !S.pending.length) return;
  const c = coupDesPoses();
  if (!c || c.erreur) return message(c?.erreur || "Pose invalide.", "err");
  const r = scoreCube(S.cube, c.move, dict, { bonuses: { 7: 50 } });
  if (r.errors.length) {
    const inv = new Set((r.invalides || []).map(cle));
    S.pending.forEach(p => { p.invalide = inv.has(cle([p.f, p.r, p.c])); });
    dessine();
    message(`❌ ${r.errors[0]}`, "err");
    setTimeout(() => enFile(async () => { S.pending.forEach(p => delete p.invalide); await efface(); }), 1100);
    return;
  }
  if (r.score >= S.top.score) return finCoup("top", c.move);
  if (!S.best || r.score > S.best.score) S.best = { score: r.score, word: c.move.word };
  message(`<b>${c.move.word}</b> — ${r.score} pts (${positionCoup(c.move)}). Le top fait plus : cherche encore !<br>Meilleur essai : ${S.best.word} ${S.best.score} pts.`);
  await efface();
}
function choisitJoker() {
  return new Promise(ok => {
    $("pickerGrille").innerHTML = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(l => `<button type="button" data-l="${l}">${l}</button>`).join("");
    $("picker").hidden = false;
    $("picker").onclick = e => { const b = e.target.closest("button"); $("picker").hidden = true; ok(b ? b.dataset.l : null); };
  });
}

async function touche(k) {
  if (!$("picker").hidden) return;
  if (/^[a-zA-Z]$/.test(k)) await pose(k.toUpperCase());
  else if (k === "?") await pose("?");
  else if (k === "Backspace") await retire();
  else if (k === "Escape") await efface();
  else if (k === "Enter") await valide();
  else if (k === " " && S.cursor && !S.pending.length) { S.cursor.dir = S.cursor.dir === "H" ? "V" : "H"; dessine(); }
}
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey || !$("picker").hidden) return;
  if (!(/^[a-zA-Z?]$/.test(e.key) || ["Backspace", "Escape", "Enter", " "].includes(e.key))) return;
  e.preventDefault();
  const k = e.key;
  enFile(() => touche(k));
});
$("vue").addEventListener("click", e => {
  const d = e.target.closest(".c[data-f]");
  if (!d || d.classList.contains("liseret")) return;
  const cs = { f: d.dataset.f, r: +d.dataset.r, c: +d.dataset.c };
  enFile(async () => {
    if (S.cube[cs.f][cs.r][cs.c] || cs.f !== S.face) return;
    if (S.cursor && S.cursor.f === cs.f && S.cursor.r === cs.r && S.cursor.c === cs.c && !S.pending.length) S.cursor.dir = S.cursor.dir === "H" ? "V" : "H";
    else {
      if (S.pending.length) { for (const p of S.pending) S.rack.find(t => t.id === p.id).used = false; S.pending = []; }
      S.cursor = { ...cs, dir: S.cursor?.dir || "H" };
    }
    dessine();
  });
});
$("rack").addEventListener("click", e => { const t = e.target.closest(".t[data-id]"); if (t) enFile(() => pose(null, +t.dataset.id)); });
for (const [id, sens] of [["fGauche", "gauche"], ["fDroite", "droite"], ["fHaut", "haut"], ["fBas", "bas"]]) $(id).onclick = () => enFile(() => pivote(sens));
$("bTop").onclick = () => enFile(() => finCoup("giveup"));
$("bNouvelle").onclick = () => enFile(() => nouvellePartie());
$("mEff").onclick = () => enFile(retire); $("mAnn").onclick = () => enFile(efface); $("mVal").onclick = () => enFile(valide);

// tests automatiques (lecture seule)
window.__cube = { etat: () => S, pivote, valide, pose, allerVers, cases: m => casesDuCoup(m), dir: m => LIGNES[m.ligne].dir };

(async () => {
  dict = await new Dictionary().load("ods9.txt");
  nouvellePartie();
})();
