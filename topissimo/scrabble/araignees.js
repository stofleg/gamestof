//  Formule Invasion : des araignées envahissent le plateau pendant la partie.
//  Chacune recouvre une case (on ne voit plus ce qu'il y a dessous, on ne peut
//  pas y poser de lettre) ; un clic la tue. Elles arrivent par les bords, de plus
//  en plus souvent, se déplacent, et celles qu'on laisse vivre pondent. Si elles
//  recouvrent tout le plateau, la partie est perdue.
const N = 15;
const PAS_MS = 1400;            // déplacement des araignées
const ARRIVEE_MS = [6000, 1500]; // intervalle d'arrivée : du début vers la fin (raccourcit)
const PONTE_MS = 15000;         // une araignée vivante pond toutes les 15 s

let calque = null, plateau = null, araignees = [], minuteurs = [], debut = 0, perdu = null, numero = 0;

const cle = (r, c) => r * N + c;
const occupees = () => new Set(araignees.map(a => cle(a.r, a.c)));
export const couverte = (r, c) => araignees.some(a => a.r === r && a.c === c);
export const actives = () => !!calque;

function place(a) {
  const td = plateau.querySelector(`td[data-r="${a.r}"][data-c="${a.c}"]`);
  if (!td) return;
  const b = plateau.getBoundingClientRect(), t = td.getBoundingClientRect();
  Object.assign(a.el.style, { left: `${t.left - b.left}px`, top: `${t.top - b.top}px`,
    width: `${t.width}px`, height: `${t.height}px` });
  // tête tournée vers la case centrale (l'émoji regarde vers le haut)
  const deg = a.r === 7 && a.c === 7 ? 0 : Math.atan2(7 - a.c, a.r - 7) * 180 / Math.PI;
  a.el.firstChild.style.transform = `rotate(${deg}deg)`;
}
function ajoute(r, c) {
  const el = document.createElement("div");
  el.className = "araignee";
  el.innerHTML = `<span class="corps">🕷️</span>`;
  const a = { id: ++numero, r, c, el, ne: performance.now() };
  el.addEventListener("pointerdown", e => {          // tuée !
    e.preventDefault(); e.stopPropagation();
    araignees = araignees.filter(x => x !== a);
    el.classList.add("morte");
    setTimeout(() => el.remove(), 250);
  });
  el.addEventListener("click", e => e.stopPropagation());
  calque.appendChild(el);
  araignees.push(a);
  place(a);
  if (araignees.length >= N * N) { const f = perdu; arrete(); f && f(); }
}
function arrivee() {
  const occ = occupees(), bords = [];
  for (let i = 0; i < N; i++) for (const [r, c] of [[0, i], [N - 1, i], [i, 0], [i, N - 1]])
    if (!occ.has(cle(r, c))) bords.push([r, c]);
  // plateau presque plein : n'importe quelle case libre
  const choix = bords.length ? bords : [...Array(N * N).keys()].filter(k => !occ.has(k)).map(k => [Math.floor(k / N), k % N]);
  if (choix.length) ajoute(...choix[Math.floor(Math.random() * choix.length)]);
}
function voisinesLibres(a, occ) {
  return [[a.r - 1, a.c], [a.r + 1, a.c], [a.r, a.c - 1], [a.r, a.c + 1]]
    .filter(([r, c]) => r >= 0 && r < N && c >= 0 && c < N && !occ.has(cle(r, c)));
}
function pas() {
  const occ = occupees(), maintenant = performance.now();
  for (const a of [...araignees]) {
    const v = voisinesLibres(a, occ);
    if (maintenant - a.ne >= PONTE_MS && v.length) {      // ponte
      a.ne = maintenant;
      const [r, c] = v[Math.floor(Math.random() * v.length)];
      occ.add(cle(r, c)); ajoute(r, c);
      if (!calque) return;
      continue;
    }
    if (v.length && Math.random() < .7) {
      const [r, c] = v[Math.floor(Math.random() * v.length)];
      occ.delete(cle(a.r, a.c)); occ.add(cle(r, c));
      a.r = r; a.c = c; place(a);
    }
  }
}
function programmeArrivee() {
  // l'intervalle décroît sur 10 minutes, du lent au rapide
  const k = Math.min(1, (performance.now() - debut) / 600000);
  const d = ARRIVEE_MS[0] + (ARRIVEE_MS[1] - ARRIVEE_MS[0]) * k;
  minuteurs.push(setTimeout(() => { if (!calque) return; arrivee(); programmeArrivee(); }, d));
}

/** Lance l'invasion sur l'élément plateau (#board). `siPerdu` est appelé si
 *  les araignées recouvrent tout le plateau. */
export function demarre(elPlateau, siPerdu) {
  arrete();
  plateau = elPlateau; perdu = siPerdu; debut = performance.now();
  calque = document.createElement("div");
  calque.className = "calque-araignees";
  rattache();
  minuteurs.push(setInterval(pas, PAS_MS));
  programmeArrivee();
}
/** À rappeler après chaque rendu du plateau (son contenu est réécrit). */
export function rattache() {
  if (!calque || !plateau) return;
  if (calque.parentNode !== plateau) plateau.appendChild(calque);
  araignees.forEach(place);
}
export function arrete() {
  minuteurs.forEach(t => { clearInterval(t); clearTimeout(t); });
  minuteurs = [];
  calque?.remove();
  calque = null; araignees = []; perdu = null;
}
