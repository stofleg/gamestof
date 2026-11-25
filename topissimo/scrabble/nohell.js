// ============================================================
//  Ambiance « No Hell ! » (tournoi de Noël, version metal) : les codes de l'ambiance de Noël
//  (noel.js) passés au metal.
//  - Musique : les chants de Noël du domaine public réarrangés en metal (heavy, thrash, ballade,
//    symphonique), enchaînés dans un ordre aléatoire (nohell-morceaux.js).
//  - Fond sonore : feu d'enfer qui crépite (la cheminée, un peu plus présente).
//  - Effets : accord de puissance + crash (top trouvé), riff et piqué de vibrato quand le traîneau
//    en flammes passe (scrabble), « HO ! HO ! HO ! » grogné (mot refusé), roulement de toms et
//    accord à l'ouverture du cadeau.
//  - Décor : braises qui montent, guirlande de flammes, paysage infernal (nohell-decor.js).
//  Le son ne démarre qu'après une première interaction et se coupe avec 🔊/🔇 (choix mémorisé).
// ============================================================
import { decor, traineauPasse, CSS_DECOR } from "./nohell-decor.js?v=508";
import { CSS_DECOR as CSS_DECOR_NOEL } from "./noel-decor.js?v=508";
import { MORCEAUX_NOHELL } from "./nohell-morceaux.js?v=508";
const CLE = "topissimo:nohell-son";
let ctx = null, maitre = null, actif = false, bouton = null, passer = null, legende = null;
let coupe = (() => { try { return localStorage.getItem(CLE) === "off"; } catch { return false; } })();
const bus = {};
// Fichiers d'effets ramenés à −16 LUFS ; la musique (−18 LUFS) passe par GAIN_MUSIQUE.
const NIVEAUX = { musique: .67, feu: .13, top: .3, scrabble: .42, ouverture: .4, ho: .4 };
const VOLUME = .6, GAIN_MUSIQUE = .63;
const url = f => new URL(`musique/${f}`, import.meta.url).href;

function initialise() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  maitre = ctx.createGain(); maitre.gain.value = coupe ? 0 : VOLUME; maitre.connect(ctx.destination);
  for (const [nom, g] of Object.entries(NIVEAUX)) { bus[nom] = ctx.createGain(); bus[nom].gain.value = g; bus[nom].connect(maitre); }
}

// ------------------------------------------------------------ musique
let lecteur = null, morceauT = null, ordre = [], dernier = null;
/** Ordre de lecture : les styles alternent (heavy, thrash, symphonique, heavy, ballade…). */
function melange() {
  const paquets = {};
  for (const m of MORCEAUX_NOHELL) (paquets[m.cat || "heavy"] ??= []).push(m);
  for (const a of Object.values(paquets)) for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const motif = ["heavy", "thrash", "symphonique", "heavy", "ballade"], out = [];
  for (let k = 0; out.length < MORCEAUX_NOHELL.length; k++) {
    const p = paquets[motif[k % motif.length]] || [];
    const m = p.length ? p.shift() : Object.values(paquets).find(a => a.length)?.shift();
    if (m) out.push(m);
  }
  if (out.length > 1 && out[0] === dernier) out.push(out.shift());
  return out;
}
function prepareLecteur() {
  if (lecteur) return;
  lecteur = new Audio(); lecteur.preload = "auto"; lecteur.crossOrigin = "anonymous";
  lecteur.addEventListener("ended", () => { clearTimeout(morceauT); morceauT = setTimeout(morceauSuivantInterne, 2000); });
  const g = ctx.createGain(); g.gain.value = GAIN_MUSIQUE;
  ctx.createMediaElementSource(lecteur).connect(g).connect(bus.musique);
}
function morceauSuivantInterne() {
  clearTimeout(morceauT);
  if (!actif || !MORCEAUX_NOHELL.length) return;
  prepareLecteur();
  if (!ordre.length) ordre = melange();
  const mc = dernier = ordre.shift();
  lecteur.src = url(mc.f);
  lecteur.play().catch(() => {});
  if (legende) { legende.hidden = false; legende.innerHTML = `🤘 ${mc.titre}<br><small>${mc.credit}</small>`; }
}
export function morceauSuivant() { if (actif) morceauSuivantInterne(); }
export function nouvellePartie() { ordre = []; if (actif) morceauSuivantInterne(); }
function baisseMusique(duree, db = -7) {
  if (!bus.musique) return;
  const g = bus.musique.gain, t = ctx.currentTime, n = NIVEAUX.musique;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(n * Math.pow(10, db / 20), t + .1);
  g.setValueAtTime(n * Math.pow(10, db / 20), t + duree);
  g.linearRampToValueAtTime(n, t + duree + .8);
}

// ------------------------------------------------------------ feu d'enfer et effets
const sons = {};
async function charge(nom) {
  if (sons[nom]) return sons[nom];
  try { sons[nom] = await ctx.decodeAudioData(await (await fetch(url(nom))).arrayBuffer()); }
  catch (e) { console.warn("Son No Hell indisponible :", nom, e); }
  return sons[nom];
}
let feuNoeud = null;
async function feu() {
  const b = await charge("noel-feu.m4a");
  if (!b || !actif || feuNoeud) return;
  const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.loopStart = .05; s.loopEnd = b.duration - .05;
  s.connect(bus.feu); s.start(0, .05); feuNoeud = s;
}
function joue(nom, sortie, { pan = null, duree = 0 } = {}) {
  const b = sons[nom];
  if (!actif || !b) return;
  const src = ctx.createBufferSource(); src.buffer = b;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner(), t = ctx.currentTime;
    p.pan.setValueAtTime(-.85, t); p.pan.linearRampToValueAtTime(.85, t + (duree || b.duration));
    src.connect(p).connect(sortie);
  } else src.connect(sortie);
  src.start();
}
/** Top trouvé : accord de puissance et crash. */
export function grelots() { joue("nohell-top.m4a", bus.top); }
export function carillon() { grelots(); }
/** Ouverture du cadeau : roulement de toms, puis l'accord qui claque. */
export function ouverture() { if (!actif) return; baisseMusique(3.5, -8); joue("nohell-ouverture.m4a", bus.ouverture); }
/** Scrabble : le traîneau en flammes traverse le ciel sur un riff, de gauche à droite. */
export function scrabble() {
  const ms = traineauPasse(7.5);
  if (!actif) return;
  baisseMusique(ms / 1000 || 7.5, -9);
  joue("nohell-scrabble.m4a", bus.scrabble, { pan: true, duree: 7.5 });
}
/** Mot refusé : « HO ! HO ! HO ! » grogné. */
export function rate() { if (!actif) return; baisseMusique(2.4, -6); joue("nohell-hohoho.m4a", bus.ho); }

// ------------------------------------------------------------ décor : braises et guirlande de flammes
let braisesCanvas = null, braisesAnim = null, guirlande = null;
function braises(on) {
  if (!on) { cancelAnimationFrame(braisesAnim); braisesCanvas?.remove(); braisesCanvas = null; return; }
  if (braisesCanvas) return;
  const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const c = braisesCanvas = document.createElement("canvas");
  c.className = "noel-neige nh-braises"; c.setAttribute("aria-hidden", "true");
  document.body.prepend(c);
  const g = c.getContext("2d");
  let W = 0, H = 0, liste = [];
  const nouvelle = partout => ({ x: Math.random() * W, y: partout ? Math.random() * H : H + 10, r: .6 + Math.random() * 2,
    v: .3 + Math.random() * .9, a: Math.random() * 6.28, va: .01 + Math.random() * .03, vie: 0, teinte: 20 + Math.random() * 30 });
  const taille = () => {
    const k = devicePixelRatio || 1; W = innerWidth; H = innerHeight;
    c.width = W * k; c.height = H * k; g.setTransform(k, 0, 0, k, 0, 0);
    const n = Math.round(Math.min(110, W * H / 12000));
    while (liste.length < n) liste.push(nouvelle(true));
    liste.length = n;
  };
  addEventListener("resize", taille); taille();
  const pas = () => {
    g.clearRect(0, 0, W, H);
    for (const b of liste) {
      if (!reduit) { b.y -= b.v * (1 + b.r / 3); b.a += b.va; b.x += Math.sin(b.a) * .6; }
      if (b.y < -10) Object.assign(b, nouvelle(false));
      const hauteur = 1 - b.y / H;                        // les braises pâlissent en montant
      g.globalAlpha = Math.max(.08, .95 - hauteur * .8) * (.6 + .4 * Math.sin(b.a * 3));
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, 6.283);
      g.fillStyle = `hsl(${b.teinte}, 100%, ${55 + b.r * 6}%)`; g.shadowColor = "#ff5a00"; g.shadowBlur = 6; g.fill();
    }
    if (!reduit) braisesAnim = requestAnimationFrame(pas);
  };
  pas();
}
function guirlandeFlammes(on) {
  if (!on) { guirlande?.remove(); guirlande = null; return; }
  if (guirlande) return;
  guirlande = document.createElement("div"); guirlande.className = "noel-guirlande nh-guirlande"; guirlande.setAttribute("aria-hidden", "true");
  const N = 28, couleurs = ["#ff3b1f", "#ff8a00", "#ffcc33", "#ff5a00", "#d6001c"];
  let h = `<svg viewBox="0 0 1000 40" preserveAspectRatio="none"><path d="M0 6 ${Array.from({ length: N }, (_, i) => `Q${(i + .5) * 1000 / N} 30 ${(i + 1) * 1000 / N} 6`).join(" ")}" fill="none" stroke="#8d949c" stroke-width="2.4" stroke-dasharray="5 3"/></svg>`;
  for (let i = 0; i < N; i++) h += i % 7 === 3
    ? `<b style="left:${(i + .5) * 100 / N}%">💀</b>`
    : `<span style="left:${(i + .5) * 100 / N}%;--c:${couleurs[i % couleurs.length]};animation-delay:${((i * .37) % 1.2).toFixed(2)}s"></span>`;
  guirlande.innerHTML = h;
  document.body.appendChild(guirlande);
}

// ------------------------------------------------------------ marche / arrêt
function majBouton() { if (bouton) bouton.textContent = coupe ? "🔇" : "🔊"; }
/** Allume ou éteint l'ambiance No Hell ! (décor tout de suite, son au premier geste). */
export function ambiance(on) {
  document.body.classList.toggle("theme-nohell", on);
  if (on) for (const [id, css] of [["noelDecorCss", CSS_DECOR_NOEL], ["nohellDecorCss", CSS_DECOR]]) if (!document.getElementById(id)) {
    const st = document.createElement("style"); st.id = id; st.textContent = css; document.head.appendChild(st);
  }
  decor(on); braises(on); guirlandeFlammes(on);
  if (on && !bouton) {
    bouton = document.createElement("button"); bouton.type = "button"; bouton.className = "noel-son nh-son"; bouton.title = "Son No Hell !";
    bouton.onclick = e => {
      e.stopPropagation(); coupe = !coupe;
      try { localStorage.setItem(CLE, coupe ? "off" : "on"); } catch {}
      if (ctx) maitre.gain.setTargetAtTime(coupe ? 0 : VOLUME, ctx.currentTime, .1);
      majBouton();
    };
    passer = document.createElement("button"); passer.type = "button"; passer.className = "noel-son noel-passer nh-son"; passer.title = "Morceau suivant"; passer.textContent = "⏭︎";
    passer.onclick = e => { e.stopPropagation(); morceauSuivant(); };
    legende = document.createElement("div"); legende.className = "noel-legende"; legende.hidden = true;
    document.body.append(bouton, passer, legende); majBouton();
  }
  if (bouton) { bouton.hidden = !on; passer.hidden = !on; if (!on && legende) legende.hidden = true; }
  if (on === actif) return;
  if (!on) {
    actif = false; clearTimeout(morceauT);
    try { feuNoeud?.stop(); } catch {} feuNoeud = null;
    lecteur?.pause();
    return;
  }
  const demarre = () => {
    initialise(); ctx.resume();
    if (actif || !document.body.classList.contains("theme-nohell")) return;
    actif = true; feu();
    for (const f of ["nohell-top.m4a", "nohell-ouverture.m4a", "nohell-scrabble.m4a", "nohell-hohoho.m4a"]) charge(f);
    morceauSuivantInterne();
  };
  if (ctx && ctx.state === "running") demarre();
  else { addEventListener("pointerdown", demarre, { once: true }); addEventListener("keydown", demarre, { once: true }); }
}
