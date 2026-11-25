// ============================================================
//  Affichage 3D de la grille cube dans Topissimo (game.js). Les six faces sont des tables de
//  cases rendues par game.js (mêmes cases, jetons, badge, curseur et thèmes que la grille
//  classique) ; ce module les pose sur un cube CSS et gère les rotations d'un huitième de tour :
//  gauche/droite quand le cube est droit, haut/bas seulement depuis la face principale.
//  L'œil est placé un peu au-dessus (on aperçoit le dessus) ; une face pleine reste bien de face.
// ============================================================
import { voisin } from "./cube.js?v=509";

export const ORDRE = ["F", "R", "B", "L", "U", "D"];
export const TITRES = { F: "Principale ★", R: "Droite", B: "Arrière", L: "Gauche", U: "Dessus", D: "Dessous" };
const NORMALE = { F: [0, 0, 1], R: [1, 0, 0], B: [0, 0, -1], L: [-1, 0, 0], U: [0, -1, 0], D: [0, 1, 0] };
const V = { k: 0, p: 0 };          // huitièmes de tour : k horizontal (droite +), p vertical (haut +)
let enAnimation = false, rendu = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Fonction de rendu de game.js (appelée après chaque rotation). */
export function surRendu(fn) { rendu = fn; }
export function reinitialise() { V.k = 0; V.p = 0; }
export const vue = () => ({ ...V, anim: enAnimation });

/** Composante vers l'observateur de la normale d'une face, pour la vue (k, p). */
export function versMoi(f, k = V.k, p = V.p) {
  const a = -k * Math.PI / 4, b = -p * Math.PI / 4, [x, y, z] = NORMALE[f];
  const z1 = -x * Math.sin(a) + z * Math.cos(a);
  return y * Math.sin(b) + z1 * Math.cos(b);
}
export const visibles = (k = V.k, p = V.p) => ORDRE.filter(f => versMoi(f, k, p) > .3);
const droit = () => ((V.k % 8) + 8) % 8 === 0;
const transformee = () => `rotateX(${-V.p * 45}deg) rotateY(${-V.k * 45}deg)`;
const interdite = (f, vis) => (f === "U" || f === "D") && !vis.includes(f) && !droit();

function titreVue(vis) {
  const tri = vis.slice().sort((a, b) => versMoi(b) - versMoi(a));
  return tri.length === 1 ? TITRES[tri[0]] : "Arête " + tri.map(f => TITRES[f].replace(" ★", "")).join(" · ");
}
function murs(f) {
  const m = [];
  if (!voisin(f, 0, 7, "V", -1)) m.push("mur-h");
  if (!voisin(f, 14, 7, "V", 1)) m.push("mur-b");
  if (!voisin(f, 7, 0, "H", -1)) m.push("mur-g");
  if (!voisin(f, 7, 14, "H", 1)) m.push("mur-d");
  return m.join(" ");
}

/** Dessine le cube dans `div` (#board) ; `tableFace(f)` renvoie la table HTML d'une face. */
export function dessine(div, tableFace) {
  let zone = div.querySelector(".cube-zone");
  if (!zone) {
    div.innerHTML = `<div class="cube-zone">
      <div class="cube-titre" id="cubeTitre"></div>
      <div class="cube-vue" id="cubeVue">
        <div class="cube-scene"><div class="cube-3d" id="cube3d"></div></div>
        <button class="cube-fleche f-haut" data-sens="haut" type="button" aria-label="Tourner vers le dessus">▲</button>
        <button class="cube-fleche f-bas" data-sens="bas" type="button" aria-label="Tourner vers le dessous">▼</button>
        <button class="cube-fleche f-gauche" data-sens="gauche" type="button" aria-label="Tourner vers la gauche">◀</button>
        <button class="cube-fleche f-droite" data-sens="droite" type="button" aria-label="Tourner vers la droite">▶</button>
      </div></div>`;
    zone = div.querySelector(".cube-zone");
    zone.querySelectorAll(".cube-fleche").forEach(b => b.onclick = e => { e.stopPropagation(); pivote(b.dataset.sens); });
    // Toucher : un swipe sur le cube le fait tourner dans le sens du doigt (glisser vers la
    // gauche amène la face de droite, glisser vers le bas amène le dessus).
    const vueEl = zone.querySelector(".cube-vue");
    let dep = null;
    vueEl.addEventListener("touchstart", e => {
      if (e.touches.length !== 1) { dep = null; return; }
      const t = e.touches[0]; dep = { x: t.clientX, y: t.clientY, t: Date.now() };
    }, { passive: true });
    vueEl.addEventListener("touchmove", e => { if (dep) e.preventDefault(); }, { passive: false });   // la page ne défile pas pendant le geste
    vueEl.addEventListener("touchcancel", () => { dep = null; });
    vueEl.addEventListener("touchend", e => {
      const d = dep; dep = null;
      const t = e.changedTouches?.[0];
      if (!d || !t || Date.now() - d.t > 800) return;
      const dx = t.clientX - d.x, dy = t.clientY - d.y, ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.max(ax, ay) < 30) return;            // simple toucher : clic sur la case
      e.preventDefault();                           // pas de clic sur la case après un swipe
      const sens = ax > ay ? (dx < 0 ? "droite" : "gauche") : (dy < 0 ? "bas" : "haut");
      if (!enAnimation && raisonRefus(sens)) refus(sens); else pivote(sens);
    });
  }
  const vis = visibles();
  const cube = zone.querySelector("#cube3d");
  cube.innerHTML = ORDRE.map(f => `<div class="cube-face ${f} ${murs(f)}${vis.includes(f) ? "" : " cachee"}${interdite(f, vis) ? " interdite" : ""}" data-face="${f}">${tableFace(f)}<i class="givre" aria-hidden="true"></i></div>`).join("");
  cube.style.transform = transformee();
  zone.querySelector("#cubeTitre").textContent = titreVue(vis);
  const g = V.p === 0, hb = droit();
  const fl = s => zone.querySelector(`.cube-fleche[data-sens="${s}"]`);
  fl("gauche").disabled = !g; fl("droite").disabled = !g;
  fl("haut").disabled = !(hb && V.p < 2); fl("bas").disabled = !(hb && V.p > -2);
  const mur = "Mur : on ne tourne dans ce sens que depuis la face principale";
  fl("gauche").title = fl("droite").title = g ? "Tourner d'un huitième de tour" : "Revenir d'abord à la face principale";
  fl("haut").title = fl("haut").disabled ? mur : "Tourner vers le dessus";
  fl("bas").title = fl("bas").disabled ? mur : "Tourner vers le dessous";
}

async function anime(k, p, pas) {
  if (k === V.k && p === V.p) return;
  enAnimation = true;
  V.k = k; V.p = p;
  const cube = document.getElementById("cube3d");
  if (cube) cube.style.transitionDuration = `${Math.min(.3 + .17 * pas, .9)}s`;
  rendu?.();
  await sleep(Math.min(300 + 170 * pas, 900) + 40);
  enAnimation = false;
}
/** Pourquoi ce huitième de tour est interdit (null s'il est permis). */
function raisonRefus(sens) {
  const h = sens === "gauche" || sens === "droite";
  if (h && V.p !== 0) return "Pour tourner à gauche ou à droite, reviens d'abord à la face principale ★";
  if (!h && !droit()) return "Pour voir le dessus ou le dessous, reviens d'abord à la face principale ★";
  if (!h && Math.abs(V.p + (sens === "haut" ? 1 : -1)) > 2) return sens === "haut" ? "Tu vois déjà le dessus en entier" : "Tu vois déjà le dessous en entier";
  return null;
}
/** Swipe interdit : le cube rebondit dans le sens du geste, un panneau « sens interdit » apparaît
 *  sur le cube et une bulle dit quoi faire. */
let refusT = null;
function refus(sens) {
  const vueEl = document.getElementById("cubeVue");
  if (!vueEl) return;
  vueEl.querySelector(".cube-refus")?.remove();
  const scene = vueEl.querySelector(".cube-scene");
  scene.classList.remove("rebond", "r-gauche", "r-droite", "r-haut", "r-bas"); void scene.offsetWidth;
  // le doigt allait vers la gauche quand on demande la face de droite
  scene.classList.add("rebond", { droite: "r-gauche", gauche: "r-droite", haut: "r-bas", bas: "r-haut" }[sens]);
  const el = document.createElement("div");
  el.className = "cube-refus"; el.setAttribute("role", "status");
  el.innerHTML = `<span class="cube-interdit" aria-hidden="true"></span><span class="cube-refus-txt">${raisonRefus(sens)}</span>`;
  vueEl.appendChild(el);
  navigator.vibrate?.(40);
  clearTimeout(refusT);
  refusT = setTimeout(() => { el.classList.add("part"); setTimeout(() => el.remove(), 400); scene.classList.remove("rebond"); }, 1800);
}
/** Flèche : un huitième de tour. */
export async function pivote(sens) {
  if (enAnimation) return false;
  if ((sens === "gauche" || sens === "droite") && V.p !== 0) return false;
  if ((sens === "haut" || sens === "bas") && !droit()) return false;
  const dk = sens === "droite" ? 1 : sens === "gauche" ? -1 : 0, dp = sens === "haut" ? 1 : sens === "bas" ? -1 : 0;
  if (Math.abs(V.p + dp) > 2) return false;
  await anime(V.k + dk, V.p + dp, 1);
  return true;
}
/** Tourne au plus court pour rendre visibles les faces voulues (la 1re obligatoirement) ;
 *  `deFace` : la 1re face bien en face. */
export async function voir(faces, deFace = false) {
  faces = [...new Set(faces.filter(Boolean))];
  if (!faces.length || (!deFace && faces.every(f => visibles().includes(f)))) return;
  const base = Math.round(V.k / 8) * 8;
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
