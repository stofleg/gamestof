//  Sons du thème Halloween, synthétisés avec Web Audio (aucun fichier) :
//  vent lugubre en continu, tonnerre calé sur les éclairs (cycle CSS de 9 s),
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
  maitre = ctx.createGain(); maitre.gain.value = coupe ? 0 : .8; maitre.connect(ctx.destination);
}

/** Vent : bruit filtré dont la fréquence et le volume ondulent lentement. */
function vent() {
  const src = ctx.createBufferSource(); src.buffer = bruit(4); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 400; f.Q.value = 6;
  const g = ctx.createGain(); g.gain.value = .12;
  const lfo = ctx.createOscillator(); lfo.frequency.value = .08;
  const lfoF = ctx.createGain(); lfoF.gain.value = 250; lfo.connect(lfoF).connect(f.frequency);
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = .13;
  const lfoG = ctx.createGain(); lfoG.gain.value = .07; lfo2.connect(lfoG).connect(g.gain);
  // bourdon grave et inquiétant
  const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 55;
  const o2 = ctx.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = 58.3;
  const fo = ctx.createBiquadFilter(); fo.type = "lowpass"; fo.frequency.value = 160;
  const go = ctx.createGain(); go.gain.value = .05;
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
  f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.9, t + .03);
  g.gain.exponentialRampToValueAtTime(.35, t + .5); g.gain.linearRampToValueAtTime(.5, t + 1.1);
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
      if (ctx) maitre.gain.setTargetAtTime(coupe ? 0 : .8, ctx.currentTime, .1);
      majBouton();
    };
    document.body.appendChild(bouton); majBouton();
  }
  if (bouton) bouton.hidden = !on;
  if (on === actif) return;
  if (!on) {
    actif = false; clearInterval(tonnerreT);
    ventNoeud?.forEach(n => { try { n.stop(); } catch {} }); ventNoeud = null;
    return;
  }
  const demarre = () => {
    initialise(); ctx.resume();
    actif = true; vent();
    // éclairs CSS : cycle de 9 s, flashs à 62 % et 88,6 % depuis le chargement
    const cycle = 9000, t0 = 0;   // l’animation démarre au chargement (origine de performance.now)
    const prochain = () => {
      const now = performance.now(), dansCycle = (now - t0) % cycle;
      for (const p of [.62, .886]) {
        let d = p * cycle - dansCycle; if (d < 0) d += cycle;
        setTimeout(tonnerre, d + 120);
      }
    };
    prochain(); tonnerreT = setInterval(prochain, cycle);
  };
  if (ctx && ctx.state === "running") demarre();
  else window.addEventListener("pointerdown", demarre, { once: true });
}
document.addEventListener("araignee-tuee", splotch);
