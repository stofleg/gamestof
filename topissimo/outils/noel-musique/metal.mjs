// Arrangeur « No Hell ! » : un chant de Noël (mélodie + accords) devient un morceau de metal.
// Guitares saturées doublées gauche/droite (accords de puissance étouffés, galop, croches ou
// doubles), basse au médiator, batterie « Power Drums » (double pédale, fills, cymbales), guitare
// solo saturée avec vibrato, doublée en tierces (guitares jumelles), solo en arpèges, et un passage
// « maléfique » où le chant passe en mineur harmonique. Styles : heavy, thrash, ballade, symphonique
// (orgue, chœur, cordes, coups d'orchestre).
import midiFile from "midi-file";
import { midiNote, TPB } from "./moteur.mjs";
const { writeMidi } = midiFile;

const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const KICK = 36, SNARE = 38, HAT = 42, HAT_O = 46, RIDE = 51, CRASH = 49, CRASH2 = 57, CHINA = 52, TOMS = [50, 48, 47, 45, 43, 41];
const CH = { lead: 0, jumelle: 1, rythG: 2, rythD: 3, basse: 4, claire: 5, choeur: 6, cordes: 7, orgue: 8, drums: 9, hit: 10 };
const SONS = {
  lead: [29, 74, 64], jumelle: [29, 62, 92], rythG: [30, 84, 14], rythD: [30, 84, 114], basse: [34, 100, 64],
  claire: [27, 90, 56], choeur: [52, 70, 64], cordes: [48, 64, 72], orgue: [19, 84, 64], drums: [16, 110, 64], hit: [55, 84, 64],
};

function accord(a) {
  const m = /^([A-G][#b]?)(.*)$/.exec(a);
  return { root: PC[m[1]], mineur: /^m(?!aj)|dim/.test(m[2]) };
}
const parse = (s, u) => s.trim().split(/\s+/).map(x => { const [n, d] = x.split(":"); return { n, q: +d * u }; });

export function metal(P, style = "heavy", graine = 1) {
  let s = graine >>> 0;
  const alea = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rnd = a => (alea() * 2 - 1) * a;
  const u = P.unite || 1;
  const mel = parse(P.melodie, u), accs = parse(P.accords, u).map(x => ({ ...accord(x.n), q: x.q }));
  const total = mel.reduce((a, x) => a + x.q, 0);
  const compose = P.ts ? /^(6|9|12)\/8$/.test(P.ts) : (P.metre === 6 && u === .5);
  const bar = P.metre * u, pulse = compose ? 1.5 : 1;
  const levee = (P.levee || 0) * u, pad = levee ? bar - levee : 0;
  const final = accs[accs.length - 1];
  const tonique = final.root, mineur = P.mineur || final.mineur;

  // ----- tempo : la noire (ou la noire pointée en mesure composée) selon le style
  const brefs = Math.min(...mel.map(x => x.q).filter(q => q > 0));
  const vise = { heavy: 156, thrash: 188, ballade: 78, symphonique: 142 }[style];
  let bpm = compose ? vise * 1.1 : vise;
  if (brefs <= .25) bpm = Math.min(bpm, style === "ballade" ? 72 : 150);
  if (brefs <= .125) bpm = Math.min(bpm, 112);
  bpm = Math.round(bpm + rnd(4));

  // ----- placement du chant à la guitare solo (autour de mi 5)
  const hauteurs = mel.filter(x => x.n !== "-").map(x => midiNote(x.n));
  const centre = (Math.min(...hauteurs) + Math.max(...hauteurs)) / 2;
  let octLead = Math.round((76 - centre) / 12) * 12;
  while (Math.max(...hauteurs) + octLead > 91) octLead -= 12;

  // ----- gammes (majeure ou mineure harmonique) et version « maléfique »
  const GAMME = mineur ? [0, 2, 3, 5, 7, 8, 11] : [0, 2, 4, 5, 7, 9, 11];
  const GAMME_MAL = [0, 2, 3, 5, 7, 8, 11];
  const malefique = n => { if (mineur) return n; const d = ((n - tonique) % 12 + 12) % 12; return d === 4 || d === 9 ? n - 1 : n; };
  const tierce = (n, gamme) => {      // tierce diatonique au-dessus
    const d = ((n - tonique) % 12 + 12) % 12, i = gamme.indexOf(d);
    if (i < 0) return n + 4;
    const j = (i + 2) % 7; return n + (((gamme[j] - d) % 12 + 12) % 12);
  };

  const ev = [];
  const T = q => Math.round(q * TPB);
  const note = (ch, n, q, d, v, hum = 6) => {
    if (n < 0 || n > 127 || d <= 0) return;
    const t0 = Math.max(0, T(q) + Math.round(rnd(hum)));
    ev.push({ t: t0, type: "noteOn", channel: ch, noteNumber: n, velocity: Math.max(1, Math.min(127, Math.round(v + rnd(5)))) });
    ev.push({ t: t0 + Math.max(12, T(d) - 10), type: "noteOff", channel: ch, noteNumber: n, velocity: 0 });
  };
  const ctl = (t, ch, c, v) => ev.push({ t, type: "controller", channel: ch, controllerType: c, value: v });
  ev.push({ t: 0, type: "setTempo", microsecondsPerBeat: Math.round(60e6 / bpm) });
  for (const [nom, [prog, vol, pan]] of Object.entries(SONS)) {
    const ch = CH[nom];
    ctl(0, ch, 0, 0); ev.push({ t: 0, type: "programChange", channel: ch, programNumber: prog });
    ctl(0, ch, 7, vol); ctl(0, ch, 10, pan); ctl(0, ch, 91, nom === "lead" || nom === "jumelle" ? 14 : nom === "choeur" || nom === "orgue" || nom === "cordes" ? 24 : nom === "claire" ? 18 : 0);
    ctl(0, ch, 93, 0);   // son sec et proche : pas de chorus, presque pas de réverbération
    // amplitude du pitch bend : 2 demi-tons
    ctl(0, ch, 101, 0); ctl(0, ch, 100, 0); ctl(0, ch, 6, 2); ctl(0, ch, 38, 0);
  }
  const vibrato = (ch, q, d, prof = 1100) => {           // vibrato de guitariste sur les notes tenues
    const t0 = T(q), dur = T(d), deb = t0 + Math.round(dur * .35);
    for (let t = deb, k = 0; t < t0 + dur - 20; t += 24, k++) ev.push({ t, type: "pitchBend", channel: ch, value: Math.round(Math.sin(2 * Math.PI * 5.6 * (k * 24 / TPB) * 60 / bpm) * prof * Math.min(1, (t - deb) / (TPB * .4))) });
    ev.push({ t: t0 + dur - 10, type: "pitchBend", channel: ch, value: 0 });
  };

  // ----- batterie
  const crash = (q, v = 110) => { note(CH.drums, alea() < .5 ? CRASH : CRASH2, q, 2, v, 2); };
  function batterie(q0, longueur, jeu, fill = true) {
    const mesures = Math.round(longueur / bar);
    for (let m = 0; m < mesures; m++) {
      const q = q0 + m * bar, dernier = fill && m === mesures - 1;
      if (m === 0 && jeu !== "calme") crash(q);
      if (jeu === "calme") { for (let x = 0; x < bar - 1e-6; x += compose ? .5 : .5) note(CH.drums, RIDE, q + x, .4, 58 + (x % pulse === 0 ? 12 : 0), 4); if (m % 2 === 0) note(CH.drums, KICK, q, .5, 70); continue; }
      const finFill = dernier ? Math.min(bar, compose ? 1.5 : (bar >= 4 ? 2 : 1)) : 0, limite = bar - finFill;
      // cymbales : charleston (couplet), ride ou crash en noires (refrain), china au contretemps (thrash)
      const pasC = jeu === "groove" ? .5 : compose ? .5 : 1;
      for (let x = 0; x < limite - 1e-6; x += pasC) {
        const inst = jeu === "groove" ? HAT : jeu === "double" ? (x === 0 ? CRASH : RIDE) : jeu === "thrash" ? (x % 2 ? CHINA : RIDE) : RIDE;
        note(CH.drums, inst, q + x, .4, (x % pulse === 0 ? 92 : 70) - (inst === RIDE ? 6 : 0), 4);
      }
      if (jeu === "groove" && m % 4 === 3 && !dernier) note(CH.drums, HAT_O, q + bar - .5, .5, 84);
      // grosse caisse et caisse claire
      const caisses = compose ? (bar === 3 ? [1.5] : [1.5, 4.5].filter(x => x < bar)) : bar === 4 ? [1, 3] : bar === 3 ? (jeu === "double" ? [1, 2] : [2]) : bar === 2 ? [1] : [1];
      if (jeu === "thrash" && !compose) {
        for (let x = 0; x < limite - 1e-6; x += .5) note(CH.drums, x % 1 ? SNARE : KICK, q + x, .3, x % 1 ? 100 : 104, 3);
      } else if (jeu === "double" || jeu === "galop") {
        const pas = compose ? .5 : .25;
        for (let x = 0; x < limite - 1e-6; x += pas) {
          if (jeu === "galop" && !compose && (x % 1 === .25)) continue;        // ta-ta-taa
          note(CH.drums, KICK, q + x, .2, 96 + (x % pulse === 0 ? 12 : 0), 3);
        }
        for (const c of caisses) if (c < limite) note(CH.drums, SNARE, q + c, .4, 114, 3);
      } else {
        const gc = compose ? [0, 1, 2.5].filter(x => x < bar) : bar === 4 ? [0, 2, 2.5] : bar === 3 ? [0, 1.5] : [0, .75];
        const gcDemi = compose ? [0] : bar === 4 ? [0, 1.5] : [0];
        for (const k of (jeu === "lourd" ? gcDemi : gc)) if (k < limite) note(CH.drums, KICK, q + k, .3, 104, 3);
        for (const c of (jeu === "lourd" ? [compose ? 1.5 : bar === 4 ? 2 : bar === 3 ? 2 : 1] : caisses)) if (c < limite) note(CH.drums, SNARE, q + c, .4, 112, 3);
      }
      if (finFill) {        // fill : caisse claire puis toms qui descendent, en doubles croches
        const pas = compose ? .25 : .25, n = Math.round(finFill / pas);
        for (let k = 0; k < n; k++) {
          const inst = k < n / 3 ? SNARE : TOMS[Math.min(TOMS.length - 1, Math.floor((k - n / 3) / (n * 2 / 3) * TOMS.length))];
          note(CH.drums, inst, q + limite + k * pas, .25, 92 + k * 2, 3);
          if (k % 2 === 0) note(CH.drums, KICK, q + limite + k * pas, .2, 90, 3);
        }
      }
    }
  }

  // ----- guitares rythmiques et basse
  const grave = root => 40 + ((root - 4) % 12 + 12) % 12;          // accord de puissance entre mi 2 et ré# 3
  function rythme(q0, liste, jeu, mal) {
    let q = q0;
    for (const A of liste) {
      const r = grave(mal ? malefique(A.root + 60) - 60 : A.root);
      const puissance = [r, r + 7, r + 12], etouffe = [r, r + 7];
      const joue = (x, d, plein, v) => {
        for (const [ch, h] of [[CH.rythG, 0], [CH.rythD, 9]]) for (const n of (plein ? puissance : etouffe)) note(ch, n, q + x, d, v, h);
        note(CH.basse, r - 12 + (r - 12 < 28 ? 12 : 0), q + x, d, v + 6, 3);
      };
      if (jeu === "tenu") { for (let x = 0; x < A.q - 1e-6; x += bar) joue(x, Math.min(bar, A.q - x), true, 96); }
      else if (jeu === "arpeges") {
        const tons = [0, 7, 12, 16, 19, 24].map(i => r + 12 + i - (A.mineur || mal ? (i === 16 ? 1 : 0) : 0));
        for (let x = 0, k = 0; x < A.q - 1e-6; x += .5, k++) note(CH.claire, tons[[0, 1, 2, 3, 4, 3, 2, 1][k % 8]], q + x, 1.2, 76, 8);
        note(CH.basse, r - 12 + (r - 12 < 28 ? 12 : 0), q, A.q, 70);
      } else {
        const pas = jeu === "seize" ? .25 : compose ? .5 : .5;
        for (let x = 0, k = 0; x < A.q - 1e-6; x += pas, k++) {
          if (jeu === "galop" && !compose && x % 1 === .25) continue;
          const d = jeu === "galop" && !compose ? (x % 1 === 0 ? .45 : .22) : pas * .7;
          const accent = x === 0 || (x % pulse === 0 && jeu !== "seize");
          joue(x, x === 0 ? Math.min(pas * 1.8, A.q) : d, x === 0, accent ? 104 : 84);
        }
      }
      q += A.q;
    }
  }
  // ----- guitare solo (chant), jumelle en tierces, octave
  function chant(q0, { jumelle = false, octave = 0, mal = false, ch = CH.lead, v = 100 }) {
    let q = q0 + pad;
    const gamme = mal ? GAMME_MAL : GAMME;
    for (const { n, q: d } of mel) {
      if (n !== "-") {
        let h = midiNote(n) + octLead + octave; if (mal) h = malefique(h);
        note(ch, h, q, d * .96, v + (d >= 1 ? 6 : 0), 4);
        if (d >= .9 && ch === CH.lead) vibrato(ch, q, d);
        if (jumelle) { note(CH.jumelle, tierce(h, gamme), q, d * .96, v - 8, 6); if (d >= .9) vibrato(CH.jumelle, q, d, 900); }
      }
      q += d;
    }
  }
  // ----- solo : arpèges rapides sur les accords (balayage), note finale tenue avec vibrato
  function solo(q0, liste, mal) {
    let q = q0;
    liste.forEach((A, i) => {
      const r0 = 64 + ((mal ? malefique(A.root + 60) : A.root) - 4 + 24) % 12;
      const tierceA = A.mineur || mal ? 3 : 4;
      const tons = []; for (const o of [0, 12, 24]) for (const iv of [0, tierceA, 7]) tons.push(r0 + o);
      for (let k = 0; k < tons.length; k++) tons[k] = r0 + [0, tierceA, 7][k % 3] + 12 * Math.floor(k / 3);
      const pas = .25;
      const der = i === liste.length - 1;
      const fin = der ? Math.max(0, A.q - 2) : A.q;
      const vague = [...tons, ...tons.slice(1, -1).reverse()];
      for (let x = 0, k = 0; x < fin - 1e-6; x += pas, k++) note(CH.lead, vague[k % vague.length], q + x, pas * 1.1, 92 + (k % 4 === 0 ? 10 : 0), 3);
      if (der) { note(CH.lead, tons[6], q + fin, A.q - fin, 108); vibrato(CH.lead, q + fin, A.q - fin, 1500); }
      q += A.q;
    });
  }
  const nappes = (q0, liste, { choeur = false, cordes = false, orgue = false }, mal) => {
    let q = q0;
    for (const A of liste) {
      const r = 48 + (((mal ? malefique(A.root + 60) : A.root) % 12) + 12) % 12, t3 = A.mineur || mal ? 3 : 4;
      const tons = [r + 12, r + 12 + t3, r + 19, r + 24];
      if (choeur) for (const n of tons.slice(0, 3)) note(CH.choeur, n, q, A.q, 70, 2);
      if (cordes) for (const n of tons) note(CH.cordes, n + 12, q, A.q, 66, 2);
      if (orgue) { for (const n of tons) note(CH.orgue, n, q, A.q, 84, 2); note(CH.orgue, r - 12, q, A.q, 88, 2); }
      q += A.q;
    }
  };

  // ----- forme
  const avecPad = accs.map((A, i) => i === 0 ? { ...A, q: A.q + pad } : A);
  const lenSec = pad + total;
  const forme = {
    heavy: [
      { r: "huit", d: "groove" }, { r: "galop", d: "galop", jum: true }, { solo: true, r: "seize", d: "double" },
      { mal: true, r: "tenu", d: "lourd", oct: -12 }, { r: "galop", d: "double", jum: true, oct: 12 },
    ],
    thrash: [
      { mal: true, r: "seize", d: "thrash" }, { mal: true, r: "seize", d: "double", jum: true }, { mal: true, solo: true, r: "seize", d: "thrash" },
      { r: "huit", d: "lourd", mal: true, oct: -12 }, { mal: true, r: "seize", d: "double", jum: true, oct: 12 },
    ],
    ballade: [
      { r: "arpeges", d: "calme", claire: true }, { r: "tenu", d: "lourd" }, { solo: true, r: "tenu", d: "lourd" },
      { mal: true, r: "huit", d: "double", jum: true }, { r: "tenu", d: "lourd", jum: true, oct: 12 },
    ],
    symphonique: [
      { orgue: true, d: "calme" }, { r: "huit", d: "groove", choeur: true }, { r: "galop", d: "double", jum: true, choeur: true, cordes: true },
      { mal: true, r: "tenu", d: "lourd", choeur: true, orgue: true, oct: -12 }, { solo: true, r: "seize", d: "double", cordes: true },
      { r: "galop", d: "double", jum: true, oct: 12, choeur: true, cordes: true },
    ],
  }[style];
  // morceaux courts : on reprend des sections pour atteindre au moins 2 min 20
  const secPasse = lenSec * 60 / bpm;
  const sections = forme.slice();
  for (let i = 0; sections.length * secPasse < 140 && sections.length < 12; i++) sections.splice(sections.length - 1, 0, forme[1 + i % (forme.length - 2)]);
  while (sections.length > 3 && sections.length * secPasse > 250) sections.splice(1, 1);   // longs chants : on garde le passage maléfique

  // introduction : riff sur la tonique (2 ou 4 mesures), avec fill
  let q = 0;
  const mesIntro = bar <= 2 ? 4 : 2;
  if (style === "ballade") {
    rythme(0, [{ root: tonique, mineur, q: bar * mesIntro }], "arpeges", false);
    batterie(0, bar * mesIntro, "calme", false);
  } else {
    rythme(0, [{ root: tonique, mineur, q: bar * mesIntro }], style === "thrash" ? "seize" : "galop", style === "thrash");
    batterie(0, bar * mesIntro, style === "thrash" ? "thrash" : "groove");
    if (style === "symphonique") note(CH.hit, 60 + tonique, 0, 1, 110);
  }
  q = bar * mesIntro;
  sections.forEach((S, i) => {
    if (S.orgue && !S.r) { nappes(q, avecPad, { orgue: true }, false); chant(q, { ch: CH.orgue, v: 88, octave: -12 }); batterie(q, lenSec, "calme", true); }
    else {
      if (S.solo) solo(q, avecPad, S.mal); else chant(q, { jumelle: S.jum, octave: S.oct || 0, mal: S.mal, ch: S.claire ? CH.lead : CH.lead, v: S.claire ? 86 : 100 });
      rythme(q, avecPad, S.r, S.mal);
      if (S.claire && S.r !== "arpeges") rythme(q, avecPad, "arpeges", S.mal);
      batterie(q, lenSec, S.d, true);
      if (S.choeur || S.cordes || (S.orgue && S.r)) nappes(q, avecPad, S, S.mal);
      if (style === "symphonique" && i > 0) note(CH.hit, 60 + tonique, q, 1, 100);
    }
    q += lenSec;
  });
  // fin : accord de puissance qui sonne, crash, roulement, coup final
  const r = grave(style === "thrash" ? tonique : tonique);
  for (const [ch, h] of [[CH.rythG, 0], [CH.rythD, 9]]) for (const n of [r, r + 7, r + 12]) note(ch, n, q, bar * 2, 110, h);
  note(CH.basse, r - 12 + (r - 12 < 28 ? 12 : 0), q, bar * 2, 110);
  note(CH.lead, 64 + ((tonique - 4) % 12 + 12) % 12 + 12, q, bar * 2, 104); vibrato(CH.lead, q, bar * 2, 1600);
  crash(q, 120); note(CH.drums, CHINA, q, 2, 100);
  for (let x = 0; x < bar * 2 - .5; x += .125) note(CH.drums, x % .5 === 0 ? TOMS[0] : SNARE, q + x, .1, 60 + x * 12, 2);
  crash(q + bar * 2, 124); note(CH.drums, KICK, q + bar * 2, .5, 124); note(CH.drums, CHINA, q + bar * 2, 2, 110);
  for (const [ch, h] of [[CH.rythG, 0], [CH.rythD, 9]]) for (const n of [r, r + 7, r + 12]) note(ch, n, q + bar * 2, 3, 112, h);
  note(CH.basse, r - 12 + (r - 12 < 28 ? 12 : 0), q + bar * 2, 3, 112);
  if (style === "symphonique") { note(CH.hit, 60 + tonique, q + bar * 2, 2, 120); for (const n of [60, 64 - (mineur ? 1 : 0), 67]) note(CH.choeur, n + tonique, q, bar * 2 + 3, 90); }
  const fini = T(q + bar * 2 + 3) + TPB * 4;

  ev.sort((a, b) => a.t - b.t || (a.type === "noteOff" ? -1 : 1));
  const pistes = new Map(), glob = [];
  for (const e of ev) { if (e.type === "setTempo") { glob.push(e); continue; } if (!pistes.has(e.channel)) pistes.set(e.channel, []); pistes.get(e.channel).push(e); }
  glob.push({ t: fini, type: "endOfTrack" });
  const delta = arr => { let p = 0; return arr.map(e => { const { t, ...r } = e; const o = { deltaTime: t - p, ...r }; p = t; return o; }); };
  const tracks = [delta(glob)];
  for (const [, arr] of [...pistes.entries()].sort((a, b) => a[0] - b[0])) { arr.push({ t: arr[arr.length - 1].t, type: "endOfTrack" }); tracks.push(delta(arr)); }
  return { midi: writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: TPB }, tracks }), bpm, sections: sections.length };
}
