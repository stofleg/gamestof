// ============================================================
//  Ambiance de Noël (grille cube, tournoi de Noël) : son et décor, sans aucun fichier.
//  - Musique : arrangements orchestraux de chants de Noël du domaine public (fichiers m4a),
//    enchaînés dans un ordre aléatoire.
//  - Fond sonore : feu de cheminée qui crépite doucement (boucle).
//  - Effets : grelots de traîneau (top trouvé), carillon (top à 7 lettres posées),
//    petit « bloup » descendant (mot refusé).
//  - Décor : neige qui tombe derrière le jeu, guirlande lumineuse en haut de l'écran.
//  Le son ne démarre qu'après une première interaction (règle des navigateurs) et se coupe
//  avec le bouton 🔊/🔇 (choix mémorisé).
// ============================================================
import { decor, traineauPasse, CSS_DECOR } from "./noel-decor.js?v=500";
import { MORCEAUX_NOEL } from "./noel-morceaux.js?v=500";
const CLE = "topissimo:noel-son";
let horsLigne = false, ctx = null, maitre = null, reverb = null, actif = false, bouton = null, passer = null, legende = null;
let coupe = (() => { try { return localStorage.getItem(CLE) === "off"; } catch { return false; } })();
const bus = {};
// Un bus (niveau) par famille de sons, réglé par mesure (voir __mesure plus bas).
// Cibles (« fort » = moyenne des passages les plus forts) : musique ≈ −31 dBFS en fond, feu ≈ −48
// (à peine), grelots du top ≈ −33, ouverture ≈ −28, « ho ho ho » ≈ −27,5, scrabble ≈ −27 (le
// moment fort). Pendant un effet marquant, la musique s'efface un peu (voir baisseMusique).
const NIVEAUX = { musique: .67, feu: .093, top: .6, scrabble: .39, ouverture: .72, carillon: .95, ho: .335 };

function bruit(secondes) {
  const b = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * secondes), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function initialise() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  construit(coupe ? 0 : VOLUME);
}
const VOLUME = .6;
function construit(volume) {
  maitre = ctx.createGain(); maitre.gain.value = volume; maitre.connect(ctx.destination);
  // réverbération de salle : bruit qui décroît sur 2,5 s
  const n = ctx.sampleRate * 2.5, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
  const conv = ctx.createConvolver(); conv.buffer = b;
  const humide = ctx.createGain(); humide.gain.value = .35; conv.connect(humide).connect(maitre);
  reverb = conv;
  for (const [nom, g] of Object.entries(NIVEAUX)) {
    bus[nom] = ctx.createGain(); bus[nom].gain.value = g;
    bus[nom].connect(maitre);
    if (!["feu", "ho", "musique"].includes(nom)) bus[nom].connect(reverb);   // la musique a déjà sa salle
  }
}

// ------------------------------------------------------------ instruments
const NOTES = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
function freq(nom, transpo = 0) {
  const m = /^([A-G][#b]?)(\d)$/.exec(nom);
  const midi = 12 * (+m[2] + 1) + NOTES[m[1]] + transpo;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
/** Lame de boîte à musique : fondamentale + harmoniques métalliques, attaque nette, longue extinction. */
function lame(sortie, f, t, volume = .16, duree = 1.6) {
  for (const [r, g, d] of [[1, 1, 1], [2, .28, .55], [4.07, .07, .3], [6.2, .025, .18]]) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * r;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(volume * g, t + .004);
    e.gain.exponentialRampToValueAtTime(.0001, t + duree * d);
    o.connect(e).connect(sortie); o.start(t); o.stop(t + duree * d + .05);
  }
}
/** Cloche : partiels inharmoniques, très longue résonance. */
function cloche(sortie, f, t, volume = .1) {
  for (const [r, g, d] of [[.5, .5, 4], [1, 1, 3], [1.19, .45, 2.2], [1.5, .35, 2], [2, .3, 1.6], [2.74, .2, 1.1], [4.07, .1, .7]]) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * r;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(volume * g, t + .003);
    e.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(e).connect(sortie); o.start(t); o.stop(t + d + .05);
  }
}
/** Une secousse de grelots : petites clochettes aiguës désaccordées + souffle métallique. */
function secousse(sortie, t, volume = .05) {
  for (let i = 0; i < 6; i++) {
    const d = t + Math.random() * .05, o = ctx.createOscillator(), e = ctx.createGain();
    o.type = "triangle"; o.frequency.value = 3800 + Math.random() * 3200;
    e.gain.setValueAtTime(0, d); e.gain.linearRampToValueAtTime(volume, d + .002);
    e.gain.exponentialRampToValueAtTime(.0001, d + .12 + Math.random() * .1);
    o.connect(e).connect(sortie); o.start(d); o.stop(d + .25);
  }
  const s = ctx.createBufferSource(); s.buffer = bruit(.15);
  const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000;
  const g = ctx.createGain(); g.gain.setValueAtTime(volume * 1.2, t); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
  s.connect(f).connect(g).connect(sortie); s.start(t); s.stop(t + .15);
}

// ------------------------------------------------------------ musique (domaine public)
// Playlist d'environ 2 h 25 (noel-morceaux.js) : chants de Noël connus en plusieurs versions
// (galop, valse, boîte à musique, chœur et orgue…), chants populaires de Noël, classiques (chorals
// de Noël de Bach, Haydn et Mozart « La Chasse ») et quelques pièces originales. Tout est arrangé
// pour Topissimo et joué avec la banque de sons libre GeneralUser GS (S. Christian Collins), en
// salle ; chaque fichier est ramené à −18 LUFS. GAIN_MUSIQUE place la musique sous les effets.
// Fabrication : topissimo/outils/noel-musique.
const MORCEAUX = MORCEAUX_NOEL;
const GAIN_MUSIQUE = .63;
const url = f => new URL(`musique/${f}`, import.meta.url).href;
let lecteur = null, lecteurGain = null, morceauT = null, ordre = [], dernier = null;
/** Ordre de lecture : chaque catégorie est mélangée, puis on les fait alterner (chant connu,
 *  classique, chant, pièce originale…), sans rejouer tout de suite le dernier morceau entendu. */
function melange() {
  const paquets = {};
  for (const m of MORCEAUX) (paquets[m.cat || "chant"] ??= []).push(m);
  for (const a of Object.values(paquets)) for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const motif = ["chant", "classique", "chant", "original"], out = [];
  for (let k = 0; out.length < MORCEAUX.length; k++) {
    const p = paquets[motif[k % motif.length]] || [];
    const reste = Object.values(paquets).find(a => a.length);
    const m = p.length ? p.shift() : reste?.shift();
    if (m) out.push(m);
  }
  if (out.length > 1 && out[0] === dernier) out.push(out.shift());
  return out;
}
/** Lecteur unique, branché dans le graphe Web Audio (bus musique : volume, sourdine, effacement). */
function prepareLecteur() {
  if (lecteur) return;
  lecteur = new Audio(); lecteur.preload = "auto"; lecteur.crossOrigin = "anonymous";
  lecteur.addEventListener("ended", () => { clearTimeout(morceauT); morceauT = setTimeout(morceauSuivantInterne, 2500); });
  lecteurGain = ctx.createGain(); lecteurGain.gain.value = GAIN_MUSIQUE;
  ctx.createMediaElementSource(lecteur).connect(lecteurGain).connect(bus.musique);
}
function morceauSuivantInterne() {
  clearTimeout(morceauT);
  if (!actif) return;
  prepareLecteur();
  if (!ordre.length) ordre = melange();
  const mc = dernier = ordre.shift();
  lecteur.src = url(mc.f);
  lecteur.play().catch(() => {});
  if (legende) { legende.hidden = false; legende.innerHTML = `♪ ${mc.titre}<br><small>${mc.credit}</small>`; }
}
export function morceauSuivant() { if (actif) morceauSuivantInterne(); }
export function nouvellePartie() { ordre = []; if (actif) morceauSuivantInterne(); }

// ------------------------------------------------------------ feu de cheminée
// Enregistrement de synthèse (grondement des flammes, souffle, crépitements en grappes, pops de
// bois), 38 s en boucle sans couture.
let feuNoeuds = null, feuT = null, feuBuffer = null;
async function chargeFeu(c = ctx) {
  const r = await fetch(url("noel-feu.m4a"));
  return c.decodeAudioData(await r.arrayBuffer());
}
async function feu() {
  try { feuBuffer ??= await chargeFeu(); } catch (e) { console.warn("Feu de cheminée indisponible", e); return; }
  if (!actif || feuNoeuds) return;
  const s = ctx.createBufferSource(); s.buffer = feuBuffer; s.loop = true;
  s.loopStart = .05; s.loopEnd = feuBuffer.duration - .05;   // marge du codeur AAC
  s.connect(bus.feu); s.start(0, .05);
  feuNoeuds = [s];
}

// ------------------------------------------------------------ effets du jeu
/** Top trouvé : grelots de traîneau qui passent, puis une petite cascade de clochettes. */
export function grelots() {
  if (!actif) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 10; i++) secousse(bus.top, t + i * .14 + Math.random() * .03, .045 * Math.sin(Math.PI * (i + .5) / 10));
  ["C6", "E6", "G6", "C7"].forEach((n, i) => lame(bus.top, freq(n), t + .25 + i * .09, .09, 1.6));
}
/** Top avec les 7 lettres : carillon de cloches. */
export function carillon() {
  if (!actif) return;
  const t = ctx.currentTime;
  ["G4", "E4", "C4", "G3", "C4", "E4", "G4", "C5"].forEach((n, i) => cloche(bus.carillon, freq(n), t + i * .28, .07));
  for (let i = 0; i < 16; i++) secousse(bus.carillon, t + i * .14, .03);
}
/** Ouverture du cadeau : ruban qu'on tire (zip), papier froissé qu'on déchire, puis pluie d'étincelles. */
export function ouverture() {
  if (!actif) return;
  const t = ctx.currentTime;
  baisseMusique(2.6, -6);
  // ruban : bruit dont le filtre monte vite
  const z = ctx.createBufferSource(); z.buffer = bruit(.5);
  const zf = ctx.createBiquadFilter(); zf.type = "bandpass"; zf.Q.value = 4;
  zf.frequency.setValueAtTime(600, t); zf.frequency.exponentialRampToValueAtTime(5000, t + .4);
  const zg = ctx.createGain(); zg.gain.setValueAtTime(0, t); zg.gain.linearRampToValueAtTime(.35, t + .05); zg.gain.exponentialRampToValueAtTime(.001, t + .45);
  z.connect(zf).connect(zg).connect(bus.ouverture); z.start(t); z.stop(t + .5);
  // papier : une dizaine de froissements secs
  for (let i = 0; i < 12; i++) {
    const d = t + .45 + i * .07 + Math.random() * .05, c = ctx.createBufferSource(); c.buffer = bruit(.12);
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1800 + Math.random() * 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(.18 + Math.random() * .2, d); g.gain.exponentialRampToValueAtTime(.001, d + .06 + Math.random() * .08);
    c.connect(f).connect(g).connect(bus.ouverture); c.start(d); c.stop(d + .15);
  }
  // étincelles : arpège de clochettes qui monte, puis accord
  ["C5", "E5", "G5", "C6", "E6", "G6", "C7"].forEach((n, i) => lame(bus.ouverture, freq(n), t + 1.25 + i * .07, .1, 1.8));
  ["C4", "G4", "E5"].forEach(n => cloche(bus.ouverture, freq(n), t + 1.8, .05));
  for (let i = 0; i < 8; i++) secousse(bus.ouverture, t + 1.25 + i * .12, .03);
}
/** La musique s'efface de `db` décibels pendant `duree` secondes (un effet marquant passe devant). */
function baisseMusique(duree, db = -7) {
  if (!bus.musique || horsLigne) return;
  const g = bus.musique.gain, t = ctx.currentTime, n = NIVEAUX.musique;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(n * Math.pow(10, db / 20), t + .15);
  g.setValueAtTime(n * Math.pow(10, db / 20), t + duree);
  g.linearRampToValueAtTime(n, t + duree + .8);
}
/** Scrabble (7 lettres posées) : le traîneau traverse le ciel au son des grelots, qui passent
 *  de gauche à droite en enflant puis en s'éloignant. */
export function scrabble() {
  const ms = horsLigne ? 7500 : traineauPasse(7.5);
  if (!actif || !sons.traineau) return;
  const t = ctx.currentTime, duree = ms / 1000 || 7.5;
  baisseMusique(duree);
  const src = ctx.createBufferSource(); src.buffer = sons.traineau;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;   // de gauche à droite, avec le traîneau
  if (pan) { pan.pan.setValueAtTime(-.85, t); pan.pan.linearRampToValueAtTime(.85, t + duree); src.connect(pan).connect(bus.scrabble); }
  else src.connect(bus.scrabble);
  src.start(t);
}
/** Mot refusé : le père Noël rit « Ho ! Ho ! Ho ! » (voix grave de synthèse par formants, en salle). */
export function rate() {
  if (!actif || !sons.hohoho) return;
  baisseMusique(2, -6);
  const src = ctx.createBufferSource(); src.buffer = sons.hohoho;
  src.connect(bus.ho); src.start();
}
// sons enregistrés (fabriqués hors ligne : grelots échantillonnés, voix de synthèse)
const sons = {};
async function chargeSons(c = ctx) {
  for (const n of ["traineau", "hohoho"]) {
    if (sons[n]) continue;
    try { sons[n] = await c.decodeAudioData(await (await fetch(url(`noel-${n}.m4a`))).arrayBuffer()); }
    catch (e) { console.warn("Son de Noël indisponible :", n, e); }
  }
}

// ------------------------------------------------------------ décor : neige et guirlande
let neigeCanvas = null, neigeAnim = null, guirlande = null;
function neige(on) {
  if (!on) { cancelAnimationFrame(neigeAnim); neigeCanvas?.remove(); neigeCanvas = null; return; }
  if (neigeCanvas) return;
  const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const c = neigeCanvas = document.createElement("canvas");
  c.className = "noel-neige"; c.setAttribute("aria-hidden", "true");
  document.body.prepend(c);
  const g = c.getContext("2d");
  let W = 0, H = 0, flocons = [];
  const taille = () => {
    const r = devicePixelRatio || 1; W = innerWidth; H = innerHeight;
    c.width = W * r; c.height = H * r; g.setTransform(r, 0, 0, r, 0, 0);
    const n = Math.round(Math.min(160, W * H / 9000));
    while (flocons.length < n) flocons.push(nouveau(true));
    flocons.length = n;
  };
  const nouveau = (partout) => ({ x: Math.random() * W, y: partout ? Math.random() * H : -10, r: .8 + Math.random() * 2.6,
    v: .25 + Math.random() * .7, a: Math.random() * 6.28, va: .005 + Math.random() * .015, o: .45 + Math.random() * .5 });
  addEventListener("resize", taille); taille();
  const pas = () => {
    g.clearRect(0, 0, W, H);
    for (const f of flocons) {
      if (!reduit) { f.y += f.v * (1 + f.r / 3); f.a += f.va; f.x += Math.sin(f.a) * .45; }
      if (f.y > H + 5) Object.assign(f, nouveau(false));
      g.globalAlpha = f.o; g.beginPath(); g.arc(f.x, f.y, f.r, 0, 6.283); g.fillStyle = "#fff"; g.fill();
    }
    if (!reduit) neigeAnim = requestAnimationFrame(pas);
  };
  pas();
}
function guirlandeLumineuse(on) {
  if (!on) { guirlande?.remove(); guirlande = null; return; }
  if (guirlande) return;
  guirlande = document.createElement("div"); guirlande.className = "noel-guirlande"; guirlande.setAttribute("aria-hidden", "true");
  const N = 28, couleurs = ["#ff4d4d", "#ffd23f", "#3ddc84", "#4dabff", "#ff8ad8"];
  let h = `<svg viewBox="0 0 1000 40" preserveAspectRatio="none"><path d="M0 6 ${Array.from({ length: N }, (_, i) => `Q${(i + .5) * 1000 / N} 30 ${(i + 1) * 1000 / N} 6`).join(" ")}" fill="none" stroke="#1c3a2a" stroke-width="2"/></svg>`;
  for (let i = 0; i < N; i++) h += `<span style="left:${(i + .5) * 100 / N}%;--c:${couleurs[i % couleurs.length]};animation-delay:${(i % 5) * .35}s"></span>`;
  guirlande.innerHTML = h;
  document.body.appendChild(guirlande);
}

// ------------------------------------------------------------ marche / arrêt
function majBouton() { if (bouton) bouton.textContent = coupe ? "🔇" : "🔊"; }
/** Allume ou éteint l'ambiance de Noël (décor tout de suite, son au premier geste). */
export function ambiance(on) {
  document.body.classList.toggle("theme-noel", on);
  if (on && !document.getElementById("noelDecorCss")) {
    const st = document.createElement("style"); st.id = "noelDecorCss"; st.textContent = CSS_DECOR; document.head.appendChild(st);
  }
  decor(on); neige(on); guirlandeLumineuse(on);
  if (on && !bouton) {
    bouton = document.createElement("button"); bouton.type = "button";
    bouton.className = "noel-son"; bouton.title = "Son de Noël";
    bouton.onclick = e => {
      e.stopPropagation(); coupe = !coupe;
      try { localStorage.setItem(CLE, coupe ? "off" : "on"); } catch {}
      if (ctx) maitre.gain.setTargetAtTime(coupe ? 0 : .6, ctx.currentTime, .1);
      majBouton();
    };
    passer = document.createElement("button"); passer.type = "button";
    passer.className = "noel-son noel-passer"; passer.title = "Chant suivant"; passer.textContent = "⏭︎";
    passer.onclick = e => { e.stopPropagation(); morceauSuivant(); };
    legende = document.createElement("div"); legende.className = "noel-legende"; legende.hidden = true;
    document.body.append(bouton, passer, legende); majBouton();
  }
  if (bouton) { bouton.hidden = !on; passer.hidden = !on; }
  if (on === actif) return;
  if (!on) {
    actif = false; clearTimeout(morceauT); clearTimeout(feuT);
    feuNoeuds?.forEach(n => { try { n.stop(); } catch {} }); feuNoeuds = null;
    lecteur?.pause();
    if (legende) legende.hidden = true;
    return;
  }
  const demarre = () => {
    initialise(); ctx.resume();
    if (actif) return;
    actif = true; feu(); chargeSons(); morceauSuivantInterne();
  };
  if (ctx && ctx.state === "running") demarre();
  else { addEventListener("pointerdown", demarre, { once: true }); addEventListener("keydown", demarre, { once: true }); }
}

// ------------------------------------------------------------ mesure des niveaux (réglage)
/** Rend un son hors ligne et renvoie son niveau : `max` = RMS maximal sur 400 ms (dBFS),
 *  `fort` = moyenne des 10 % de fenêtres les plus fortes, `crete` = crête. Sert à équilibrer
 *  effets et musiques (outil de réglage, appelé depuis la console ou un robot). */
export async function __mesure(nom, duree = 6) {
  const sauve = { ctx, maitre, reverb, actif, bus: { ...bus } };
  const sr = 44100, off = new OfflineAudioContext(2, Math.ceil(sr * duree), sr);
  ctx = off; horsLigne = true; actif = true; for (const k of Object.keys(bus)) delete bus[k];
  try {
    construit(VOLUME);
    if (nom.startsWith("morceau:") || nom === "feu") {
      const f = nom === "feu" ? "noel-feu.m4a" : MORCEAUX[+nom.slice(8)].f;
      const buf = await off.decodeAudioData(await (await fetch(url(f))).arrayBuffer());
      const s = off.createBufferSource(); s.buffer = buf; s.loop = true;
      const g = off.createGain(); g.gain.value = nom === "feu" ? 1 : GAIN_MUSIQUE;
      s.connect(g).connect(nom === "feu" ? bus.feu : bus.musique); s.start(0, Math.min(20, buf.duration / 3));
    }
    else { if (nom === "scrabble" || nom === "rate") await chargeSons(off); ({ grelots, carillon, rate, scrabble, ouverture })[nom](); }
    const buf = await off.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), w = Math.round(sr * .4), rms = [];
    let crete = 0;
    for (let i = 0; i + w <= L.length; i += w / 4) {
      let e = 0;
      for (let j = i; j < i + w; j++) { e += (L[j] * L[j] + R[j] * R[j]) / 2; crete = Math.max(crete, Math.abs(L[j]), Math.abs(R[j])); }
      rms.push(Math.sqrt(e / w));
    }
    rms.sort((a, b) => b - a);
    const db = x => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
    const top = rms.slice(0, Math.max(1, Math.round(rms.length * .1)));
    return { nom, max: db(rms[0]), fort: db(top.reduce((a, b) => a + b, 0) / top.length), crete: db(crete) };
  } finally {
    ({ ctx, maitre, reverb, actif } = sauve); horsLigne = false;
    for (const k of Object.keys(bus)) delete bus[k]; Object.assign(bus, sauve.bus);
  }
}
export const __morceaux = () => MORCEAUX.map(m => m.titre);
