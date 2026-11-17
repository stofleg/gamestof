// ============================================================
//  Ambiance de Noël (grille cube, tournoi de Noël) : son et décor, sans aucun fichier.
//  - Musique : chants de Noël du domaine public joués par une boîte à musique synthétisée
//    (Web Audio), enchaînés dans un ordre aléatoire, avec réverbération.
//  - Fond sonore : feu de cheminée qui crépite doucement.
//  - Effets : grelots de traîneau (top trouvé), carillon (top à 7 lettres posées),
//    petit « bloup » descendant (mot refusé).
//  - Décor : neige qui tombe derrière le jeu, guirlande lumineuse en haut de l'écran.
//  Le son ne démarre qu'après une première interaction (règle des navigateurs) et se coupe
//  avec le bouton 🔊/🔇 (choix mémorisé).
// ============================================================
import { decor, CSS_DECOR } from "./noel-decor.js?v=485";
const CLE = "topissimo:noel-son";
let ctx = null, maitre = null, reverb = null, actif = false, bouton = null, passer = null, legende = null;
let coupe = (() => { try { return localStorage.getItem(CLE) === "off"; } catch { return false; } })();
const bus = {};
const NIVEAUX = { musique: 1, feu: .55, grelots: .8, carillon: .7, rate: .6 };

function bruit(secondes) {
  const b = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * secondes), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function initialise() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  maitre = ctx.createGain(); maitre.gain.value = coupe ? 0 : .6; maitre.connect(ctx.destination);
  // réverbération de salle : bruit qui décroît sur 2,5 s
  const n = ctx.sampleRate * 2.5, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
  const conv = ctx.createConvolver(); conv.buffer = b;
  const humide = ctx.createGain(); humide.gain.value = .35; conv.connect(humide).connect(maitre);
  reverb = conv;
  for (const [nom, g] of Object.entries(NIVEAUX)) {
    bus[nom] = ctx.createGain(); bus[nom].gain.value = g;
    bus[nom].connect(maitre);
    if (nom !== "feu") bus[nom].connect(reverb);
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
// Mélodies notées « note:durée » (durée en temps ; « - » = silence), jouées à la boîte à musique.
const MORCEAUX = [
  { titre: "Vive le vent (Jingle Bells)", credit: "James Lord Pierpont, 1857 — domaine public", tempo: .3, transpo: 12, grelots: true,
    m: "E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:.5 E4:4 F4:1 F4:1 F4:1.5 F4:.5 F4:1 E4:1 E4:1 E4:.5 E4:.5 E4:1 D4:1 D4:1 E4:1 D4:2 G4:2 "
     + "E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:.5 E4:4 F4:1 F4:1 F4:1.5 F4:.5 F4:1 E4:1 E4:1 E4:.5 E4:.5 G4:1 G4:1 F4:1 D4:1 C4:4" },
  { titre: "Douce nuit", credit: "Franz Xaver Gruber, 1818 — domaine public", tempo: .24, transpo: 12,
    m: "G4:3 A4:1 G4:2 E4:6 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 B4:6 C5:4 C5:2 G4:6 A4:4 A4:2 C5:3 B4:1 A4:2 G4:3 A4:1 G4:2 E4:6 "
     + "A4:4 A4:2 C5:3 B4:1 A4:2 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 F5:3 D5:1 B4:2 C5:6 E5:6 C5:3 G4:1 E4:2 G4:3 F4:1 D4:2 C4:12" },
  { titre: "We Wish You a Merry Christmas", credit: "chant traditionnel anglais — domaine public", tempo: .3, transpo: 12, grelots: true,
    m: "D4:1 G4:1 G4:.5 A4:.5 G4:.5 F#4:.5 E4:1 E4:1 E4:1 A4:1 A4:.5 B4:.5 A4:.5 G4:.5 F#4:1 D4:1 D4:1 B4:1 B4:.5 C5:.5 B4:.5 A4:.5 G4:1 E4:1 D4:.5 D4:.5 E4:1 A4:1 F#4:1 G4:3" },
  { titre: "Deck the Halls", credit: "chant traditionnel gallois — domaine public", tempo: .28, transpo: 12,
    m: "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 G4:.5 A4:.5 Bb4:.5 G4:.5 A4:1.5 G4:.5 F4:1 E4:1 F4:2 "
     + "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 G4:.5 A4:.5 Bb4:.5 G4:.5 A4:1.5 G4:.5 F4:1 E4:1 F4:2 "
     + "G4:1.5 A4:.5 Bb4:1 G4:1 A4:1.5 Bb4:.5 C5:1 G4:1 A4:.5 B4:.5 C5:1 D5:.5 E5:.5 F5:1 E5:1 D5:1 C5:2 "
     + "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 D5:.5 D5:.5 D5:.5 D5:.5 C5:1.5 Bb4:.5 A4:1 G4:1 F4:2" },
  { titre: "God Rest Ye Merry Gentlemen", credit: "chant traditionnel anglais — domaine public", tempo: .3, transpo: 12,
    m: "E4:1 E4:1 B4:1 B4:1 A4:1 G4:1 F#4:1 E4:1 D4:1 E4:1 F#4:1 G4:1 A4:1 B4:3 E4:1 E4:1 B4:1 B4:1 A4:1 G4:1 F#4:1 E4:1 D4:1 E4:1 F#4:1 G4:1 A4:1 B4:3 "
     + "B4:1 C5:1 A4:1 B4:1 C5:1 D5:1 E5:1 B4:1 A4:1 G4:1 E4:1 F#4:1 G4:1 A4:2 G4:1 A4:1 B4:1 C5:1 B4:1 A4:1 G4:1 F#4:1 E4:2 "
     + "G4:.5 F#4:.5 E4:1 A4:1 G4:1 A4:1 B4:1 C5:1 B4:1 A4:1 G4:1 F#4:1 E4:4" },
];
let morceauGain = null, morceauT = null, ordre = [], dernier = null;
function melange() {
  const a = [...MORCEAUX];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length > 1 && a[0] === dernier) a.push(a.shift());
  return a;
}
/** Joue un morceau deux fois (la 2ᵉ fois, une octave plus haut, doublé de clochettes). */
function joue(mc) {
  const sortie = ctx.createGain(); sortie.gain.value = 1; sortie.connect(bus.musique);
  morceauGain = sortie;
  const notes = mc.m.trim().split(/\s+/).map(x => { const [n, d] = x.split(":"); return { n, d: +d }; });
  let t = ctx.currentTime + .3;
  for (const passe of [0, 1]) {
    for (const { n, d } of notes) {
      const duree = d * mc.tempo;
      if (n !== "-") {
        const f = freq(n, mc.transpo + (passe ? 12 : 0));
        lame(sortie, f, t, passe ? .11 : .15, Math.min(2.4, .9 + duree * 1.5));
        if (passe && d >= 1.5) cloche(sortie, f / 2, t, .025);
        if (!passe) lame(sortie, f / 2, t, .035, 1.2);   // doublure grave très douce
      }
      if (mc.grelots && Number.isInteger(d) && Math.random() < .9) secousse(sortie, t, .012);
      t += duree;
    }
    t += mc.tempo * 4;
  }
  return t - ctx.currentTime;
}
function morceauSuivantInterne() {
  clearTimeout(morceauT);
  if (morceauGain) { const g = morceauGain; g.gain.setTargetAtTime(0, ctx.currentTime, .15); setTimeout(() => g.disconnect(), 1500); morceauGain = null; }
  if (!actif) return;
  if (!ordre.length) ordre = melange();
  const mc = dernier = ordre.shift();
  const duree = joue(mc);
  if (legende) { legende.hidden = false; legende.innerHTML = `♪ ${mc.titre}<br><small>${mc.credit} · boîte à musique</small>`; }
  morceauT = setTimeout(morceauSuivantInterne, (duree + 3) * 1000);
}
export function morceauSuivant() { if (actif) morceauSuivantInterne(); }
export function nouvellePartie() { ordre = []; if (actif) morceauSuivantInterne(); }

// ------------------------------------------------------------ feu de cheminée
let feuNoeuds = null, feuT = null;
function feu() {
  const s = ctx.createBufferSource(); s.buffer = bruit(3); s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500;
  const g = ctx.createGain(); g.gain.value = .02;
  s.connect(f).connect(g).connect(bus.feu); s.start();
  feuNoeuds = [s];
  const crepite = () => {
    if (!actif) return;
    const n = Math.random() < .3 ? 2 + Math.floor(Math.random() * 4) : 1;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + Math.random() * .15, c = ctx.createBufferSource(); c.buffer = bruit(.03);
      const bf = ctx.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = 1500 + Math.random() * 3500; bf.Q.value = 1.5;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(.05 + Math.random() * .12, t); cg.gain.exponentialRampToValueAtTime(.0001, t + .02 + Math.random() * .03);
      c.connect(bf).connect(cg).connect(bus.feu); c.start(t); c.stop(t + .06);
    }
    feuT = setTimeout(crepite, 120 + Math.random() * 600);
  };
  crepite();
}

// ------------------------------------------------------------ effets du jeu
/** Top trouvé : grelots de traîneau qui passent, puis une petite cascade de clochettes. */
export function grelots() {
  if (!actif) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 10; i++) secousse(bus.grelots, t + i * .14 + Math.random() * .03, .045 * Math.sin(Math.PI * (i + .5) / 10));
  ["C6", "E6", "G6", "C7"].forEach((n, i) => lame(bus.grelots, freq(n), t + .25 + i * .09, .09, 1.6));
}
/** Top avec les 7 lettres : carillon de cloches. */
export function carillon() {
  if (!actif) return;
  const t = ctx.currentTime;
  ["G4", "E4", "C4", "G3", "C4", "E4", "G4", "C5"].forEach((n, i) => cloche(bus.carillon, freq(n), t + i * .28, .07));
  for (let i = 0; i < 16; i++) secousse(bus.grelots, t + i * .14, .03);
}
/** Ouverture du cadeau : ruban qu'on tire (zip), papier froissé qu'on déchire, puis pluie d'étincelles. */
export function ouverture() {
  if (!actif) return;
  const t = ctx.currentTime;
  // ruban : bruit dont le filtre monte vite
  const z = ctx.createBufferSource(); z.buffer = bruit(.5);
  const zf = ctx.createBiquadFilter(); zf.type = "bandpass"; zf.Q.value = 4;
  zf.frequency.setValueAtTime(600, t); zf.frequency.exponentialRampToValueAtTime(5000, t + .4);
  const zg = ctx.createGain(); zg.gain.setValueAtTime(0, t); zg.gain.linearRampToValueAtTime(.35, t + .05); zg.gain.exponentialRampToValueAtTime(.001, t + .45);
  z.connect(zf).connect(zg).connect(bus.grelots); z.start(t); z.stop(t + .5);
  // papier : une dizaine de froissements secs
  for (let i = 0; i < 12; i++) {
    const d = t + .45 + i * .07 + Math.random() * .05, c = ctx.createBufferSource(); c.buffer = bruit(.12);
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1800 + Math.random() * 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(.18 + Math.random() * .2, d); g.gain.exponentialRampToValueAtTime(.001, d + .06 + Math.random() * .08);
    c.connect(f).connect(g).connect(bus.grelots); c.start(d); c.stop(d + .15);
  }
  // étincelles : arpège de clochettes qui monte, puis accord
  ["C5", "E5", "G5", "C6", "E6", "G6", "C7"].forEach((n, i) => lame(bus.carillon, freq(n), t + 1.25 + i * .07, .1, 1.8));
  ["C4", "G4", "E5"].forEach(n => cloche(bus.carillon, freq(n), t + 1.8, .05));
  for (let i = 0; i < 8; i++) secousse(bus.grelots, t + 1.25 + i * .12, .03);
}
/** Mot refusé : deux notes douces qui descendent. */
export function rate() {
  if (!actif) return;
  const t = ctx.currentTime;
  lame(bus.rate, freq("E5"), t, .1, 1); lame(bus.rate, freq("B4"), t + .14, .1, 1.2);
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
    if (morceauGain) { morceauGain.disconnect(); morceauGain = null; }
    if (legende) legende.hidden = true;
    return;
  }
  const demarre = () => {
    initialise(); ctx.resume();
    if (actif) return;
    actif = true; feu(); morceauSuivantInterne();
  };
  if (ctx && ctx.state === "running") demarre();
  else { addEventListener("pointerdown", demarre, { once: true }); addEventListener("keydown", demarre, { once: true }); }
}
