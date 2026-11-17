// ============================================================
//  Grille cube : écran de jeu (entraînement). Moteur : cube.js.
//  Le cube est toujours affiché en 3D (légèrement de biais). Les flèches le tournent d'un
//  huitième de tour : arrêt possible sur une arête, les deux faces sont alors visibles et
//  jouables. Gauche/droite quand le cube est droit ; haut/bas seulement depuis la face
//  principale (k multiple de 8). Chaque face a un contour discret, plus foncé sur les arêtes sans passage.
// ============================================================
import { Dictionary } from "./dictionary.js?v=497";
import { LETTER_BAG, drawForDuplicate, bagTotalVowels, bagTotalConsonants, letterValue } from "./engine.js?v=497";
import {
  FACES, NOM_FACE, BONUS_CUBE, LIGNES, ligneDe, voisin, rangLigne, PIVOTS, cheminFaces,
  cubeVide, appliqueCoup, casesDuCoup, positionCoup, scoreCube, topCube, sacCube, JEUX_CUBE, coupRegleCube,
} from "./cube.js?v=497";
import * as noel from "./noel.js?v=497";

const $ = id => document.getElementById(id);
const TEMPS = 240;   // 4 minutes par coup
const CLASSE = { ".": "", d: "dl", t: "tl", D: "dw", T: "tw", "*": "dw etoile" };
const VOY = new Set(["A", "E", "I", "O", "U", "Y"]);
const TITRES = { F: "Principale ★", R: "Droite", B: "Arrière", L: "Gauche", U: "Dessus", D: "Dessous" };
const ORDRE = ["F", "R", "B", "L", "U", "D"];

let dict = null;
const S = {
  cube: cubeVide(), bag: null, rack: [], pending: [], cursor: null, coup: 0,
  top: null, best: null, cumul: 0, neg: 0, tops: 0, fin: false, debut: 0, topCells: [], anim: false,
  pause: false, entreCoups: false, resteDebut: TEMPS, emballe: false,
};
/** Vue du cube : k = huitièmes de tour horizontaux (vers la droite), p = huitièmes vers le haut (-2..2). */
const V = { k: 0, p: 0 };
let nextId = 1, minuteur = null;
// Toutes les actions du joueur passent par une file : une lettre tapée pendant que le cube
// tourne attend la fin de la rotation et de la lettre précédente (ordre de saisie garanti).
let file = Promise.resolve();
const enFile = action => { file = file.then(action).catch(e => console.error(e)); return file; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ géométrie de la vue
const NORMALE = { F: [0, 0, 1], R: [1, 0, 0], B: [0, 0, -1], L: [-1, 0, 0], U: [0, -1, 0], D: [0, 1, 0] };
/** Composante vers l'observateur de la normale d'une face (repère CSS), pour la vue (k, p). */
function versMoi(f, k = V.k, p = V.p) {
  const a = -k * Math.PI / 4, b = -p * Math.PI / 4, [x, y, z] = NORMALE[f];
  const z1 = -x * Math.sin(a) + z * Math.cos(a);
  return y * Math.sin(b) + z1 * Math.cos(b);
}
const VISIBLE = .3;   // de face (1) ou sur une arête (0,71)
const visibles = (k = V.k, p = V.p) => ORDRE.filter(f => versMoi(f, k, p) > VISIBLE);
// La face pleine reste bien de face (carrée) : l'œil est placé au-dessus du cube (perspective-origin),
// on voit donc une partie du dessus sans incliner la face. Aucun biais : les pivots sont bien droits.
const transformee = () => `rotateX(${-V.p * 45}deg) rotateY(${-V.k * 45}deg)`;
const droit = () => ((V.k % 8) + 8) % 8 === 0;

// ------------------------------------------------------------ rendu
const cle = cs => cs.join();
function tuile(cs) {
  const p = S.pending.find(x => x.f === cs[0] && x.r === cs[1] && x.c === cs[2]);
  if (p) return { letter: p.letter, isBlank: p.isBlank, pose: true, invalide: p.invalide };
  return S.cube[cs[0]][cs[1]][cs[2]];
}
function htmlCase(cs) {
  const [f, r, c] = cs, t = tuile(cs);
  const cls = ["c", CLASSE[BONUS_CUBE[f][r][c]] || ""];
  if (f !== "F" && BONUS_CUBE[f][r][c] === "*") cls.push("dw");
  if (t) cls.push("has");
  if (S.topCells.some(x => cle(x) === cle(cs))) cls.push("top");
  const cur = S.cursor && cle([S.cursor.f, S.cursor.r, S.cursor.c]) === cle(cs);
  if (cur) cls.push("curseur");
  const j = t ? `<div class="jeton${t.isBlank ? " joker" : ""}${t.pose ? " pose" : ""}${t.invalide ? " invalide" : ""}">${t.letter}${t.isBlank ? "" : `<span>${letterValue(t.letter)}</span>`}</div>` : "";
  return `<div class="${cls.join(" ")}" data-f="${f}" data-r="${r}" data-c="${c}">${j}${cur ? `<span class="dir">${S.cursor.dir === "H" ? "→" : "↓"}</span>` : ""}</div>`;
}
/** Dessus (ou dessous) aperçu mais inaccessible : le cube est tourné (on n'y monte que depuis la
 *  face principale). Les faces latérales ne sont jamais grisées. */
function interdite(f, vis) {
  return (f === "U" || f === "D") && !vis.includes(f) && !droit();
}
/** Une face 15×15 ; contour plus foncé (murs) là où aucune ligne ne continue. */
function htmlFace(f, vis) {
  const murs = [];
  if (!voisin(f, 0, 7, "V", -1)) murs.push("mur-h");
  if (!voisin(f, 14, 7, "V", 1)) murs.push("mur-b");
  if (!voisin(f, 7, 0, "H", -1)) murs.push("mur-g");
  if (!voisin(f, 7, 14, "H", 1)) murs.push("mur-d");
  let h = `<div class="face ${f} ${murs.join(" ")}${vis.includes(f) ? "" : " cachee"}${interdite(f, vis) ? " interdite" : ""}" data-face="${f}">`;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) h += htmlCase([f, r, c]);
  return h + `<i class="givre" aria-hidden="true"></i></div>`;   // voile de givre (thème de Noël)
}
function titreVue(vis) {
  const tri = vis.slice().sort((a, b) => versMoi(b) - versMoi(a));
  return tri.length === 1 ? TITRES[tri[0]] : "Arête " + tri.map(f => TITRES[f].replace(" ★", "")).join(" · ");
}
function majFleches() {
  const g = V.p === 0, hb = droit();
  $("fGauche").disabled = !g; $("fDroite").disabled = !g;
  $("fHaut").disabled = !(hb && V.p < 2); $("fBas").disabled = !(hb && V.p > -2);
  const mur = "Mur : on ne tourne dans ce sens que depuis la face principale";
  $("fGauche").title = g ? "Tourner d'un huitième de tour" : "Revenir d'abord à la face principale";
  $("fDroite").title = $("fGauche").title;
  $("fHaut").title = $("fHaut").disabled ? mur : "Tourner vers le dessus";
  $("fBas").title = $("fBas").disabled ? mur : "Tourner vers le dessous";
}
// ------------------------------------------------------------ cadeau à ouvrir
// Au début de chaque partie, le cube est emballé : papier cadeau sur les 6 faces, deux rubans
// qui se croisent sur le devant, un nœud sur le dessus et une étiquette. « Ouvrir le cadeau »
// fait sauter le nœud, glisser les rubans, tomber le papier… et la grille apparaît.
const MOTIF_PAPIER = ["F", "R", "B", "L", "U", "D"];
const RUBAN_V = new Set(["F", "U", "B", "D"]), RUBAN_H = new Set(["F", "R", "B", "L"]);
function htmlEmballage() {
  let h = MOTIF_PAPIER.map(f => `<div class="papier ${f}">${RUBAN_V.has(f) ? `<i class="ruban rv"></i>` : ""}${RUBAN_H.has(f) ? `<i class="ruban rh"></i>` : ""}`
    + (f === "F" ? `<div class="etiquette">Joyeux Noël !<small>Ouvre-moi</small></div>` : "") + `</div>`).join("");
  return h + `<div class="noeud"><svg viewBox="0 0 200 120" aria-hidden="true">
    <defs><linearGradient id="orNoeud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".5" stop-color="#e8c35a"/><stop offset="1" stop-color="#b8892a"/></linearGradient></defs>
    <path d="M96 70 L60 118 L74 118 L84 104 L92 118 Z M104 70 L140 118 L126 118 L116 104 L108 118 Z" fill="#c99a3a"/>
    <path d="M98 64 C70 20 18 18 22 52 C26 84 76 78 98 64 Z" fill="url(#orNoeud)" stroke="#a87a22" stroke-width="2"/>
    <path d="M102 64 C130 20 182 18 178 52 C174 84 124 78 102 64 Z" fill="url(#orNoeud)" stroke="#a87a22" stroke-width="2"/>
    <path d="M92 60 C70 40 44 36 40 52 M108 60 C130 40 156 36 160 52" stroke="#fff3c9" stroke-width="3" fill="none" opacity=".7"/>
    <ellipse cx="100" cy="64" rx="13" ry="15" fill="url(#orNoeud)" stroke="#a87a22" stroke-width="2"/>
  </svg></div>`;
}
let ouverture = null;   // résolue quand le joueur ouvre le cadeau
async function emballe() {
  S.emballe = true; S.ouvert = false; S.pause = false; S.entreCoups = false;
  clearInterval(minuteur);
  oublie();                 // nouvelle partie : l'ancienne sauvegarde disparaît
  majPause();
  Object.assign(S, { cube: cubeVide(), rack: [], pending: [], cursor: null, top: null, topCells: [], fin: false, coup: 0, cumul: 0, neg: 0, tops: 0 });
  if (V.k || V.p) await anime(0, 0, Math.abs(V.k % 8) + Math.abs(V.p));
  V.k = 0; V.p = 0;
  infos(); dessine();
  $("cTemps").textContent = "—";
  $("bOuvrir").hidden = false; $("rack").hidden = true;
  message(dict ? "🎁 Un cadeau t'attend… Ouvre-le pour commencer la partie !" : "Chargement du dictionnaire…");
  $("bOuvrir").disabled = !dict;
  return new Promise(ok => { ouverture = ok; });
}
async function ouvreCadeau() {
  if (!S.emballe || !dict || S.ouvert) return;
  S.ouvert = true;
  $("bOuvrir").disabled = true; $("bOuvrir").hidden = true;
  noel.ouverture();
  const cube = $("cube");
  cube.classList.add("deballe");                       // CSS : nœud, rubans, puis papier
  etincelles();
  await sleep(2100);
  S.emballe = false;
  cube.classList.remove("deballe");
  $("rack").hidden = false;
  dessine(); majPause();
  ouverture?.(); ouverture = null;
}
/** Pluie d'étoiles dorées qui jaillit autour du cube quand le papier tombe. */
function etincelles() {
  const vue = $("vue"), r = vue.getBoundingClientRect();
  for (let i = 0; i < 46; i++) {
    const e = document.createElement("span");
    e.className = "etincelle"; e.textContent = ["✦", "✧", "★", "❄"][i % 4];
    const a = Math.random() * Math.PI * 2, d = r.width * (.3 + Math.random() * .45);
    e.style.left = r.width / 2 + "px"; e.style.top = r.height / 2 + "px";
    e.style.setProperty("--dx", `${Math.cos(a) * d}px`); e.style.setProperty("--dy", `${Math.sin(a) * d}px`);
    e.style.animationDelay = `${1.05 + Math.random() * .35}s`;
    e.style.color = ["#ffe08a", "#fff", "#ffd23f", "#ff8ad8", "#9fe7ff"][i % 5];
    e.style.fontSize = `${12 + Math.random() * 16}px`;
    vue.appendChild(e);
    setTimeout(() => e.remove(), 3600);
  }
}

function dessine() {
  const vis = visibles();
  $("cube").innerHTML = ORDRE.map(f => htmlFace(f, vis)).join("") + (S.emballe ? htmlEmballage() : "");
  $("cube").style.transform = transformee();
  $("titreFace").textContent = $("cFace").textContent = titreVue(vis);
  $("vue").classList.toggle("emballe", !!S.emballe);
  $("vue").classList.toggle("en-pause", !!S.pause);
  majFleches();
  dessineChevalet();
}

function dessineChevalet() {
  // tirage rangé dans l'ordre alphabétique, joker(s) à la fin
  const ordre = S.rack.slice().sort((a, b) => (a.letter === "?") - (b.letter === "?") || a.letter.localeCompare(b.letter));
  $("rack").innerHTML = ordre.map(t => `<div class="t${t.used ? " used" : ""}${t.letter === "?" ? " joker" : ""}" data-id="${t.id}">${t.letter}${t.letter === "?" ? "" : `<span>${letterValue(t.letter)}</span>`}</div>`).join("");
}
function infos() {
  $("iCoup").textContent = S.coup || "—"; $("iCumul").textContent = S.cumul; $("iNeg").textContent = S.neg; $("iTops").textContent = S.tops;
}
function message(html, cls = "") { const m = $("msg"); m.innerHTML = html; m.className = "msg" + (cls ? " " + cls : ""); }

// ------------------------------------------------------------ rotations du cube
/** Anime la vue vers (k, p) ; `pas` = nombre de huitièmes parcourus (durée). */
async function anime(k, p, pas) {
  if (k === V.k && p === V.p) return;
  S.anim = true;
  V.k = k; V.p = p;
  $("cube").style.transitionDuration = `${Math.min(.3 + .17 * pas, .9)}s`;
  dessine();
  await sleep(Math.min(300 + 170 * pas, 900) + 40);
  S.anim = false;
}
/** Flèche : un huitième de tour (gauche/droite si le cube est droit, haut/bas depuis la face principale). */
async function pivote(sens) {
  if (S.anim || S.pause || S.emballe) return false;
  if ((sens === "gauche" || sens === "droite") && V.p !== 0) return false;
  if ((sens === "haut" || sens === "bas") && !droit()) return false;
  const dk = sens === "droite" ? 1 : sens === "gauche" ? -1 : 0, dp = sens === "haut" ? 1 : sens === "bas" ? -1 : 0;
  if (Math.abs(V.p + dp) > 2) return false;
  await anime(V.k + dk, V.p + dp, 1);
  return true;
}
/** Tourne au plus court pour rendre visibles les faces voulues (la 1re obligatoirement) ;
 *  `deFace` : la 1re face bien en face (pas sur une arête). */
async function voir(faces, deFace = false) {
  faces = [...new Set(faces)];
  if (!deFace && faces.every(f => visibles().includes(f))) return;
  const base = Math.round(V.k / 8) * 8;   // face principale la plus proche
  const cands = [];
  for (let k = V.k - 8; k <= V.k + 8; k++) cands.push([k, 0]);
  for (const p of [-2, -1, 1, 2]) cands.push([base, p]);
  let best = null;
  for (const [k, p] of cands) {
    const vis = visibles(k, p);
    if (!vis.includes(faces[0]) || (deFace && versMoi(faces[0], k, p) < .99)) continue;
    const n = faces.filter(f => vis.includes(f)).length;
    const cout = (p === V.p && (p === 0 || k === V.k)) ? Math.abs(k - V.k) + Math.abs(p - V.p) : Math.abs(V.p) + Math.abs(k - V.k) + Math.abs(p);
    if (!best || n > best.n || (n === best.n && cout < best.cout)) best = { k, p, n, cout };
  }
  if (best) await anime(best.k, best.p, best.cout);
}
async function allerVers(face) { await voir([face], true); }

// ------------------------------------------------------------ partie
async function nouvellePartie() {
  clearInterval(minuteur);
  await emballe();          // chaque partie commence par un cadeau à ouvrir
  clearInterval(minuteur);
  // 6 jeux de jetons, un par face
  Object.assign(S, { cube: cubeVide(), bag: sacCube(JEUX_CUBE, LETTER_BAG), rack: [], pending: [], cursor: { f: "F", r: 7, c: 7, dir: "H" },
    coup: 0, top: null, best: null, cumul: 0, neg: 0, tops: 0, fin: false, topCells: [] });
  infos();
  noel.nouvellePartie();
  nouveauCoup();
}
function nouveauCoup() {
  const kept = S.rack.map(t => t.letter);
  let v = bagTotalVowels(S.bag), c = bagTotalConsonants(S.bag);
  for (const L of kept) { if (L === "?") continue; if (VOY.has(L)) v++; else c++; }
  const jok = (S.bag["?"] || 0) + kept.filter(l => l === "?").length, ys = (S.bag.Y || 0) + kept.filter(l => l === "Y").length;
  if ((v === 0 || c === 0) && !jok && !ys) return finPartie();
  const res = drawForDuplicate(S.bag, kept, coupRegleCube(S.coup + 1), 7, {});   // 2 et 2 jusqu'au coup 109, puis 1 et 1
  if (res.failed) return finPartie();
  S.bag = res.bag;
  let lettres = res.fresh ? kept.filter(l => l === "?") : kept;
  lettres = lettres.concat(res.drawn || []);
  if (!lettres.length) return finPartie();
  S.coup++;
  S.rack = lettres.map(letter => ({ letter, used: false, id: nextId++ }));
  S.pending = []; S.best = null; S.top = null; S.entreCoups = false;
  infos(); dessine();
  message("Calcul du top…");
  setTimeout(() => {
    S.top = topCube(S.cube, S.rack.map(t => t.letter), dict, { maxTilesUsed: 7 });
    if (!S.top) return finPartie();
    message(S.coup === 1 ? "Premier coup : il passe par l'étoile de la face principale." : "À toi de jouer.");
    if (S.pause) { S.resteDebut = TEMPS; afficheChrono(); sauve(); }
    else { demarreChrono(TEMPS); sauve(); }
  }, 30);
}
// ------------------------------------------------------------ chrono, pause, sauvegarde
// Le temps du coup ne s'écoule que pendant le jeu : en pause, ou quand le joueur quitte la page
// (onglet caché, fermeture, mise en veille du téléphone), il est figé et la partie est enregistrée.
// En revenant, on retrouve la partie en pause, au même coup, avec le temps qui restait.
let dernierSave = 0;
const resteCoup = () => S.pause || !S.top ? S.resteDebut : Math.max(0, S.resteDebut - (Date.now() - S.debut) / 1000);
function demarreChrono(sec) { S.resteDebut = sec; S.debut = Date.now(); clearInterval(minuteur); minuteur = setInterval(tic, 250); tic(); }
function afficheChrono() {
  const sec = Math.ceil(resteCoup());
  $("cLabel").textContent = S.pause ? `COUP ${S.coup} · PAUSE` : `COUP ${S.coup}`;
  $("cTemps").textContent = S.top ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "—";
}
function tic() {
  afficheChrono();
  if (S.pause || !S.top) return;
  if (resteCoup() <= 0) return finCoup("timeout");
  if (Date.now() - dernierSave > 5000) sauve();
}
const pseudo = () => (localStorage.getItem("currentPseudo") || "invite").toLowerCase();
const CLE_PARTIE = () => `topissimo:cube-partie:${pseudo()}`;
/** Enregistre la partie (états stables seulement : coup en cours avec son top, entre deux coups, fin). */
function sauve() {
  if (S.emballe || (!S.top && !S.entreCoups && !S.fin)) return;
  const d = { v: 1, cube: S.cube, bag: S.bag, rack: S.rack.map(t => t.letter), coup: S.coup, top: S.top, best: S.best,
    cumul: S.cumul, neg: S.neg, tops: S.tops, fin: S.fin, topCells: S.topCells, entreCoups: S.entreCoups,
    reste: S.top ? resteCoup() : TEMPS, quand: Date.now() };
  try { localStorage.setItem(CLE_PARTIE(), JSON.stringify(d)); dernierSave = Date.now(); }
  catch (e) { console.error("Sauvegarde de la partie impossible", e); }
}
function oublie() { try { localStorage.removeItem(CLE_PARTIE()); } catch {} }
/** Reprend une partie enregistrée (en pause). Renvoie false s'il n'y en a pas. */
function restaure() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(CLE_PARTIE()) || "null"); } catch {}
  if (!d || d.v !== 1 || !d.cube || !d.bag) return false;
  Object.assign(S, { cube: d.cube, bag: d.bag, rack: d.rack.map(letter => ({ letter, used: false, id: nextId++ })), coup: d.coup, top: d.top, best: d.best,
    cumul: d.cumul, neg: d.neg, tops: d.tops, fin: !!d.fin, topCells: d.topCells || [], entreCoups: !!d.entreCoups, resteDebut: d.reste ?? TEMPS,
    pending: [], cursor: d.top ? { f: "F", r: 7, c: 7, dir: "H" } : null, emballe: false, ouvert: true, pause: !d.fin });
  $("bOuvrir").hidden = true; $("rack").hidden = false;
  infos(); dessine();
  if (S.fin) { finPartie(); return true; }
  majPause();
  message(`Partie retrouvée : coup ${S.coup}${S.top ? `, il restait ${Math.floor(Math.ceil(S.resteDebut) / 60)}:${String(Math.ceil(S.resteDebut) % 60).padStart(2, "0")}` : ""}. Clique sur « Reprendre » quand tu es prêt.`);
  return true;
}
function majPause() {
  $("voilePause").hidden = !S.pause;
  $("bPause").textContent = S.pause ? "▶ Reprendre" : "⏸ Pause";
  $("bPause").disabled = S.emballe || S.fin;
  $("bReprendre").disabled = !dict;
  $("bReprendre").textContent = dict ? "▶ Reprendre" : "Chargement…";
  $("pauseInfo").textContent = S.coup ? `Coup ${S.coup}${S.top ? ` · ${Math.floor(Math.ceil(S.resteDebut) / 60)}:${String(Math.ceil(S.resteDebut) % 60).padStart(2, "0")} restantes` : ""} · ${S.cumul} points` : "";
  $("vue").classList.toggle("en-pause", !!S.pause);
  afficheChrono();
}
/** Pause : le temps se fige, la grille et le tirage sont masqués, la partie est enregistrée. */
function pause() {
  if (S.emballe || S.fin) return;
  if (!S.pause) {
    if (S.top) S.resteDebut = resteCoup();
    S.pause = true; clearInterval(minuteur);
    if (S.pending.length) { for (const p of S.pending) { const t = S.rack.find(x => x.id === p.id); if (t) t.used = false; } S.pending = []; }
    dessine();
  }
  sauve(); majPause();
}
function reprendre() {
  if (!S.pause || !dict) return;
  S.pause = false; majPause(); dessine();
  if (S.top) { demarreChrono(S.resteDebut); message("C'est reparti !"); }
  else if (S.entreCoups && !S.fin) nouveauCoup();
}
// quitter la page (onglet, fermeture, veille) = pause automatique et enregistrement
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
addEventListener("pagehide", () => pause());
/** Fin du coup : top trouvé, temps écoulé ou « Voir le top ». Le top officiel est posé. */
async function finCoup(statut, joue = null) {
  if (!S.top || S.fin || (S.pause && statut !== "timeout")) return;
  clearInterval(minuteur);
  const top = S.top, mv = top.move;
  const posees = casesDuCoup(mv).filter(cs => !S.cube[cs[0]][cs[1]][cs[2]]).length;
  if (statut === "top" && posees < 7) noel.grelots();   // un scrabble a déjà eu son traîneau (valide)
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
  S.pending = []; S.top = null; S.entreCoups = true; S.resteDebut = TEMPS;
  S.rack = restants.map(letter => ({ letter, used: false, id: nextId++ }));
  sauve();
  infos();
  const lib = `<span class="top">✅ Top : <b>${mv.word}</b> — ${top.score} pts, ${positionCoup(mv)}${top.isotops > 1 ? ` (${top.isotops} isotops)` : ""}</span>`;
  message(statut === "top" ? `${lib}Bravo, tu as trouvé le top !` : `${lib}${statut === "timeout" ? "⏱ Temps écoulé" : "Top révélé"} — tu marques ${score} pts${S.best ? ` (${S.best.word})` : ""}.`, statut === "top" ? "ok" : "");
  // la vue montre le top (sur une arête s'il est à cheval sur deux faces)
  await voir(S.topCells.map(cs => cs[0]));
  S.cursor = null;
  dessine();
  setTimeout(() => { if (!S.pause && S.entreCoups) nouveauCoup(); }, statut === "top" ? 600 : 1500);
}
function finPartie() {
  S.fin = true; S.pause = false; S.entreCoups = false; clearInterval(minuteur);
  sauve(); majPause();
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
  if (S.cursor && !visibles().includes(S.cursor.f)) await voir([S.cursor.f]);
  dessine();
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
  if (!isBlank) L = t.letter;          // lettre touchée sur le chevalet (téléphone)
  if (isBlank && (!L || L === "?")) { L = await choisitJoker(); if (!L) return; }
  // la vue ne tourne que si la lettre tombe sur une face cachée (mot à cheval) : de préférence
  // jusqu'à l'arête, pour garder sous les yeux le début du mot
  if (!visibles().includes(cur.f)) await voir([cur.f, ...S.pending.map(p => p.f)]);
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
  if (!S.top || S.fin || S.pause || !S.pending.length) return;
  const c = coupDesPoses();
  if (!c || c.erreur) return message(c?.erreur || "Pose invalide.", "err");
  const r = scoreCube(S.cube, c.move, dict, { bonuses: { 7: 50 } });
  if (r.errors.length) {
    const inv = new Set((r.invalides || []).map(cle));
    S.pending.forEach(p => { p.invalide = inv.has(cle([p.f, p.r, p.c])); });
    dessine();
    message(`❌ ${r.errors[0]}`, "err");
    noel.rate();
    setTimeout(() => enFile(async () => { S.pending.forEach(p => delete p.invalide); await efface(); }), 1100);
    return;
  }
  if (S.pending.length === 7) noel.scrabble();             // scrabble : le traîneau passe dans le ciel
  if (r.score >= S.top.score) return finCoup("top", c.move);
  if (!S.best || r.score > S.best.score) { S.best = { score: r.score, word: c.move.word }; sauve(); }
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
  if (!$("picker").hidden || S.pause || S.emballe) return;
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
/** Place le curseur sur une case (même case touchée deux fois : on change de sens). */
function choisitCase(cs, dir = null) {
  if (S.pause || S.emballe || S.cube[cs.f][cs.r][cs.c] || !visibles().includes(cs.f)) return;
  if (!dir && S.cursor && S.cursor.f === cs.f && S.cursor.r === cs.r && S.cursor.c === cs.c && !S.pending.length) S.cursor.dir = S.cursor.dir === "H" ? "V" : "H";
  else {
    if (S.pending.length) { for (const p of S.pending) S.rack.find(t => t.id === p.id).used = false; S.pending = []; }
    S.cursor = { ...cs, dir: dir || S.cursor?.dir || "H" };
  }
  dessine();
}
// Téléphone (comme dans Topissimo) : un toucher place le curseur sur la case, un double toucher
// change le sens. La case est prise à l'endroit exact du doigt (touchend), sans attendre le clic
// simulé du navigateur ; le double toucher ne zoome plus la page.
let dernierToucher = { t: 0, k: null }, debutToucher = null;
$("vue").addEventListener("touchstart", e => { const t = e.touches[0]; debutToucher = { x: t.clientX, y: t.clientY }; }, { passive: true });
$("vue").addEventListener("touchend", e => {
  const t = e.changedTouches[0];
  if (!t || !debutToucher || Math.hypot(t.clientX - debutToucher.x, t.clientY - debutToucher.y) > 12) return;   // glissement : pas un toucher
  const d = document.elementFromPoint(t.clientX, t.clientY)?.closest("#cube .c[data-f]");
  if (!d) return;
  e.preventDefault();                                   // pas de clic simulé ni de zoom
  const cs = { f: d.dataset.f, r: +d.dataset.r, c: +d.dataset.c }, k = cle([cs.f, cs.r, cs.c]), now = Date.now();
  const double = now - dernierToucher.t < 350 && dernierToucher.k === k;
  dernierToucher = { t: double ? 0 : now, k };
  if (S.pause || S.emballe || !visibles().includes(cs.f)) return;
  enFile(async () => {
    if (double && S.cursor && !S.pending.length) { S.cursor = { ...cs, dir: S.cursor.dir === "H" ? "V" : "H" }; dessine(); }
    else choisitCase(cs, S.cursor?.dir || "H");
  });
}, { passive: false });
$("vue").addEventListener("click", e => {
  const d = e.target.closest(".c[data-f]");
  if (!d) return;
  const cs = { f: d.dataset.f, r: +d.dataset.r, c: +d.dataset.c };
  if (S.pause || S.emballe || !visibles().includes(cs.f)) return;
  enFile(async () => choisitCase(cs));
});
$("rack").addEventListener("click", e => { const t = e.target.closest(".t[data-id]"); if (t) enFile(() => pose(null, +t.dataset.id)); });
for (const [id, sens] of [["fGauche", "gauche"], ["fDroite", "droite"], ["fHaut", "haut"], ["fBas", "bas"]]) $(id).onclick = () => enFile(() => pivote(sens));
$("bTop").onclick = () => { if (!S.pause) enFile(() => finCoup("giveup")); };
$("bNouvelle").onclick = () => {
  if (S.emballe) return;
  if (S.coup > 0 && !S.fin && !confirm("Abandonner la partie en cours et en commencer une nouvelle ?")) return;
  enFile(() => nouvellePartie());
};
// Sur téléphone, les flèches rejoignent la barre de boutons sous le cube (le cube gagne la largeur).
const ecranEtroit = matchMedia("(max-width: 860px)");
function rangeFleches() {
  const ids = ["fGauche", "fHaut", "fBas", "fDroite"];
  if (ecranEtroit.matches) { const barre = $("actionsMob"); ids.slice().reverse().forEach(id => barre.prepend($(id))); }
  else ids.forEach(id => $("vue").appendChild($(id)));
}
ecranEtroit.addEventListener?.("change", rangeFleches); rangeFleches();
$("bPause").onclick = () => S.pause ? reprendre() : pause();
$("bReprendre").onclick = () => reprendre();
$("bOuvrir").onclick = () => ouvreCadeau();
$("cube").addEventListener("click", e => { if (S.emballe) { e.stopPropagation(); ouvreCadeau(); } });
$("mEff").onclick = () => enFile(retire); $("mAnn").onclick = () => enFile(efface); $("mVal").onclick = () => enFile(valide);

// tests automatiques (lecture seule)
window.__cube = { ouvre: ouvreCadeau, pause, reprendre, etat: () => S, vue: () => ({ ...V, visibles: visibles() }), pivote, valide, pose, allerVers, cases: m => casesDuCoup(m), dir: m => LIGNES[m.ligne].dir };

(async () => {
  noel.ambiance(true);   // la grille cube est la grille du tournoi de Noël
  dessine();
  // En préparation : réservé à stof (mode admin).
  const stof = (localStorage.getItem("currentPseudo") || "").toLowerCase() === "stof" && localStorage.getItem("topissimo:superadmin") === "1";
  if (!stof) { message("La grille cube est en préparation : elle n'est pas encore ouverte.", "err"); return; }
  // une partie enregistrée reprend là où elle en était (en pause) ; sinon, un cadeau à ouvrir
  const retrouvee = restaure();
  const partie = retrouvee ? null : nouvellePartie();   // le cadeau s'affiche tout de suite, le bouton attend le dictionnaire
  dict = await new Dictionary().load("ods9.txt");
  majPause();
  if (!retrouvee) {
    $("bOuvrir").disabled = false;
    message("🎁 Un cadeau t'attend… Ouvre-le pour commencer la partie !");
    await partie;
  }
})();
