//  Sons du thème Halloween, synthétisés avec Web Audio (aucun fichier) :
//  vent lugubre en continu, tonnerre qui suit les éclairs (toutes les 20 à 45 s),
//  nuée de chauves-souris au scrabble, « splotch » quand on écrase une araignée.
//  Le son ne démarre qu'après une première interaction (règle des navigateurs)
//  et se coupe avec le bouton 🔊/🔇 (choix mémorisé).
const CLE = "topissimo:halloween-son";
let ctx = null, maitre = null, actif = false, ventNoeud = null, tonnerreT = null, bouton = null;
let coupe = (() => { try { return localStorage.getItem(CLE) === "off"; } catch { return false; } })();

function bruit(secondes) {
  const b = ctx.createBuffer(1, ctx.sampleRate * secondes, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function initialise() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  maitre = ctx.createGain(); maitre.gain.value = coupe ? 0 : .5; maitre.connect(ctx.destination);
}

/** Vent : bruit filtré dont la fréquence et le volume ondulent lentement. */
function vent() {
  const src = ctx.createBufferSource(); src.buffer = bruit(4); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 320; f.Q.value = .8;
  const g = ctx.createGain(); g.gain.value = .06;
  const lfo = ctx.createOscillator(); lfo.frequency.value = .08;
  const lfoF = ctx.createGain(); lfoF.gain.value = 120; lfo.connect(lfoF).connect(f.frequency);
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = .13;
  const lfoG = ctx.createGain(); lfoG.gain.value = .03; lfo2.connect(lfoG).connect(g.gain);
  // bourdon grave et inquiétant
  const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 55;
  const o2 = ctx.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = 58.3;
  const fo = ctx.createBiquadFilter(); fo.type = "lowpass"; fo.frequency.value = 160;
  const go = ctx.createGain(); go.gain.value = .03;
  o.connect(fo); o2.connect(fo); fo.connect(go).connect(maitre);
  src.connect(f).connect(g).connect(maitre);
  [src, lfo, lfo2, o, o2].forEach(n => n.start());
  ventNoeud = [src, lfo, lfo2, o, o2];
}

/** Tonnerre : craquement sec puis grondement grave qui roule. */
export function tonnerre() {
  if (!actif) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = bruit(4);
  const f = ctx.createBiquadFilter(); f.type = "lowpass";
  f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(90, t + 1.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.28, t + .25);
  g.gain.exponentialRampToValueAtTime(.14, t + .7); g.gain.linearRampToValueAtTime(.2, t + 1.3);
  g.gain.exponentialRampToValueAtTime(.001, t + 3.8);
  src.connect(f).connect(g).connect(maitre); src.start(t); src.stop(t + 4);
}

/** Nuée : battements d'ailes (bruit haché) et cris aigus de chauves-souris. */
export function nuee() {
  if (!actif) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = bruit(3);
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.value = 0;
  const hache = ctx.createOscillator(); hache.type = "square"; hache.frequency.value = 22;
  const hg = ctx.createGain(); hg.gain.value = .25; hache.connect(hg).connect(g.gain);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + .4);
  env.gain.setValueAtTime(1, t + 1.8); env.gain.linearRampToValueAtTime(0, t + 2.8);
  src.connect(f).connect(g).connect(env).connect(maitre);
  src.start(t); hache.start(t); src.stop(t + 3); hache.stop(t + 3);
  for (let i = 0; i < 14; i++) {                         // cris
    const d = t + Math.random() * 2.2, o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(5000 + Math.random() * 3000, d);
    o.frequency.exponentialRampToValueAtTime(2500 + Math.random() * 1500, d + .06);
    og.gain.setValueAtTime(0, d); og.gain.linearRampToValueAtTime(.07, d + .01);
    og.gain.exponentialRampToValueAtTime(.001, d + .08);
    o.connect(og).connect(maitre); o.start(d); o.stop(d + .1);
  }
}

/** Araignée écrasée : petit « splotch » mouillé. */
export function splotch() {
  if (!actif) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = bruit(.3);
  const f = ctx.createBiquadFilter(); f.type = "lowpass";
  f.frequency.setValueAtTime(2500, t); f.frequency.exponentialRampToValueAtTime(200, t + .15);
  const g = ctx.createGain(); g.gain.setValueAtTime(.6, t); g.gain.exponentialRampToValueAtTime(.001, t + .18);
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(50, t + .12);
  const og = ctx.createGain(); og.gain.setValueAtTime(.4, t); og.gain.exponentialRampToValueAtTime(.001, t + .14);
  src.connect(f).connect(g).connect(maitre); o.connect(og).connect(maitre);
  src.start(t); o.start(t); src.stop(t + .3); o.stop(t + .2);
}

function majBouton() { if (bouton) bouton.textContent = coupe ? "🔇" : "🔊"; }

/** Allume ou éteint l'ambiance selon que le thème Halloween est actif. */
export function ambiance(on) {
  if (on && !bouton) {
    bouton = document.createElement("button");
    bouton.className = "hw-son"; bouton.title = "Son Halloween";
    bouton.onclick = e => {
      e.stopPropagation(); coupe = !coupe;
      try { localStorage.setItem(CLE, coupe ? "off" : "on"); } catch {}
      if (ctx) maitre.gain.setTargetAtTime(coupe ? 0 : .5, ctx.currentTime, .1);
      majBouton();
    };
    document.body.appendChild(bouton); majBouton();
  }
  if (bouton) bouton.hidden = !on;
  orage(on);
  if (on === actif) return;
  if (!on) {
    actif = false; clearTimeout(tonnerreT);
    ventNoeud?.forEach(n => { try { n.stop(); } catch {} }); ventNoeud = null;
    return;
  }
  const demarre = () => {
    initialise(); ctx.resume();
    actif = true; vent();
  };
  if (ctx && ctx.state === "running") demarre();
  else window.addEventListener("pointerdown", demarre, { once: true });
}
document.addEventListener("araignee-tuee", splotch);

// --- éclairs ---------------------------------------------------------------------
/** Tracé d'un éclair : ligne brisée qui descend, avec des ramifications. */
function traceEclair(x, y, longueur, angle, epaisseur, profondeur, chemins) {
  let d = `M${x.toFixed(0)} ${y.toFixed(0)}`;
  const pas = 14 + Math.random() * 10;
  for (let l = 0; l < longueur; l += pas) {
    angle += (Math.random() - .5) * .9;
    angle = Math.max(.35 * Math.PI, Math.min(.65 * Math.PI, angle));   // reste vers le bas
    x += Math.cos(angle) * pas; y += Math.sin(angle) * pas;
    d += `L${x.toFixed(0)} ${y.toFixed(0)}`;
    if (profondeur < 2 && Math.random() < .07)
      traceEclair(x, y, longueur * (.25 + Math.random() * .3), angle + (Math.random() < .5 ? -.6 : .6), epaisseur * .5, profondeur + 1, chemins);
  }
  chemins.push({ d, e: epaisseur });
}
function foudre() {
  const W = innerWidth, H = innerHeight, chemins = [];
  traceEclair(W * (.15 + Math.random() * .7), -10, H * (.55 + Math.random() * .35), Math.PI / 2, 3.2, 0, chemins);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "hw-eclair");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs><filter id="hwLueur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g filter="url(#hwLueur)" fill="none" stroke-linecap="round" stroke-linejoin="round">
      ${chemins.map(c => `<path d="${c.d}" stroke="#b9c6ff" stroke-width="${c.e * 3}" opacity=".5"/><path d="${c.d}" stroke="#fff" stroke-width="${c.e}"/>`).join("")}
    </g>`;
  document.body.appendChild(svg);
  document.body.classList.add("hw-flash");
  // scintillement : 2 ou 3 sursauts
  const t = [0, 70, 140, 230, 300];
  const vis = [1, 0, 1, Math.random() < .5 ? 0 : 1, 0];
  t.forEach((ms, k) => setTimeout(() => {
    svg.style.opacity = vis[k] ? 1 : .15;
    document.body.classList.toggle("hw-flash", !!vis[k]);
  }, ms));
  setTimeout(() => { svg.style.transition = "opacity .5s"; svg.style.opacity = 0; document.body.classList.remove("hw-flash"); }, 380);
  setTimeout(() => svg.remove(), 1000);
  setTimeout(tonnerre, 250 + Math.random() * 1200);   // le son arrive après la lumière
}
let orageT = null, orageOn = false;
function orage(on) {
  if (on === orageOn) return;
  orageOn = on; clearTimeout(orageT);
  if (!on) return;
  const suivant = () => { orageT = setTimeout(() => { foudre(); suivant(); }, 20000 + Math.random() * 25000); };
  orageT = setTimeout(() => { foudre(); suivant(); }, 4000);
}
