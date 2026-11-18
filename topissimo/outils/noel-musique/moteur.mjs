// Moteur d'arrangement : mélodie + accords + sections (orchestration, style d'accompagnement)
// → MIDI multipiste → rendu audio avec GeneralUser GS (spessasynth_core).
import * as fs from "node:fs/promises";
import midiFile from "midi-file";
import { audioToWav, BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer } from "spessasynth_core";
const { writeMidi } = midiFile;

export const TPB = 480;
const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const QUAL = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6], sus4: [0, 5, 7], "6": [0, 4, 7, 9] };
export const midiNote = n => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); return 12 * (+m[2] + 1) + PC[m[1]]; };
const parseSeq = s => s.trim().split(/\s+/).map(x => { const [n, d] = x.split(":"); return { n, d: +d }; });
function parseAccord(a) { const m = /^([A-G][#b]?)(.*)$/.exec(a); if (!QUAL[m[2]]) throw new Error("accord " + a); return { root: PC[m[1]], ints: QUAL[m[2]] }; }
let alea = Math.random;
const rnd = a => (alea() * 2 - 1) * a;

// ------------------------------------------------------------ instruments
export const INSTR = {
  celesta: { ch: 0, prog: 8, vol: 104, vel: 92, pan: 64 },
  boite: { ch: 0, prog: 10, vol: 100, vel: 88, pan: 64 },
  cordes: { ch: 0, prog: 48, vol: 100, vel: 92, pan: 60 },
  cordesLentes: { ch: 0, prog: 49, vol: 104, vel: 96, pan: 60 },
  cuivres: { ch: 0, prog: 60, vol: 104, vel: 100, pan: 64 },
  trompette: { ch: 0, prog: 56, vol: 92, vel: 92, pan: 64 },
  hautbois: { ch: 0, prog: 68, vol: 100, vel: 92, pan: 64 },
  flute: { ch: 1, prog: 73, vol: 84, vel: 82, pan: 76 },
  fluteSolo: { ch: 0, prog: 73, vol: 100, vel: 92, pan: 64 },
  clarinette: { ch: 1, prog: 71, vol: 82, vel: 82, pan: 76 },
  clarinetteSolo: { ch: 0, prog: 71, vol: 98, vel: 90, pan: 64 },
  cordesHaut: { ch: 1, prog: 48, vol: 86, vel: 86, pan: 56 },
  glockSolo: { ch: 0, prog: 9, vol: 92, vel: 84, pan: 64 },
  vibra: { ch: 0, prog: 11, vol: 100, vel: 88, pan: 64 },
  cloches: { ch: 0, prog: 10, bank: 12, vol: 100, vel: 90, pan: 64 },
  harpeSolo: { ch: 0, prog: 46, vol: 104, vel: 96, pan: 64 },
  orgueSolo: { ch: 0, prog: 19, vol: 92, vel: 90, pan: 64 },
  second: { ch: 8, prog: 71, vol: 70, vel: 72, pan: 40 },        // contre-chant (programme remplacé)
  nappe: { ch: 2, prog: 49, vol: 72, vel: 62, pan: 40 },
  harpe: { ch: 3, prog: 46, vol: 84, vel: 70, pan: 88 },
  basse: { ch: 4, prog: 43, vol: 86, vel: 80, pan: 64 },
  pizz: { ch: 4, prog: 45, vol: 92, vel: 84, pan: 64 },
  choeur: { ch: 5, prog: 52, vol: 66, vel: 64, pan: 64 },
  cor: { ch: 6, prog: 60, vol: 62, vel: 62, pan: 44 },
  glock: { ch: 7, prog: 9, vol: 64, vel: 72, pan: 84 },
  timbales: { ch: 10, prog: 47, vol: 84, vel: 84, pan: 64 },
  cloche: { ch: 11, prog: 14, vol: 76, vel: 80, pan: 70 },
  violonsPizz: { ch: 12, prog: 45, vol: 70, vel: 70, pan: 30 },
  accords: { ch: 13, prog: 48, vol: 66, vel: 64, pan: 80 },        // accords rythmés (valse, marche)
  orgue: { ch: 14, prog: 19, vol: 70, vel: 70, pan: 64 },
};
const DRUM = 9, GRELOT = 83, TAMBOURIN = 54, TRIANGLE = 81, WOOD_H = 76, WOOD_B = 77, CAISSE = 38;
const PROGS_SECOND = { clarinette: 71, cor: 60, violoncelle: 42, alto: 41, basson: 70, flute: 73, hautbois: 68 };

// ------------------------------------------------------------ construction du MIDI
export function arrange(P, graine = 1) {
  // générateur pseudo-aléatoire reproductible
  let s = graine >>> 0; alea = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ev = [];
  const u = P.unite || 1;
  const T = b => Math.round(b * TPB * u);
  const mel = parseSeq(P.melodie), acc = parseSeq(P.accords);
  const longueur = mel.reduce((a, x) => a + x.d, 0), accLong = acc.reduce((a, x) => a + x.d, 0);
  if (Math.abs(longueur - accLong) > .01) throw new Error(`${P.titre} : mélodie ${longueur} ≠ accords ${accLong}`);
  const metre = P.metre;
  let cur = 0;
  const tempoA = (t, bpm) => ev.push({ t, type: "setTempo", microsecondsPerBeat: Math.round(60e6 / (bpm * u)) });
  const prog = (name, t, progForce) => {
    const I = INSTR[name];
    ev.push({ t, type: "controller", channel: I.ch, controllerType: 0, value: I.bank ?? 0 });
    ev.push({ t, type: "programChange", channel: I.ch, programNumber: progForce ?? I.prog });
    ev.push({ t, type: "controller", channel: I.ch, controllerType: 7, value: I.vol });
    ev.push({ t, type: "controller", channel: I.ch, controllerType: 10, value: I.pan });
    ev.push({ t, type: "controller", channel: I.ch, controllerType: 91, value: 40 });
  };
  const note = (ch, n, t, d, v) => {
    if (n < 0 || n > 127) return;
    v = Math.max(1, Math.min(127, Math.round(v + rnd(5))));
    const t0 = Math.max(0, t + Math.round(rnd(6)));
    ev.push({ t: t0, type: "noteOn", channel: ch, noteNumber: n, velocity: v });
    ev.push({ t: t0 + Math.max(10, d - 8), type: "noteOff", channel: ch, noteNumber: n, velocity: 0 });
  };
  const voix = (root, ints, lo, hi) => { const pcs = ints.map(i => (root + i) % 12), out = []; for (let n = lo; n < hi; n++) if (pcs.includes(n % 12)) out.push(n); return out; };
  const basseDe = root => 36 + ((root - 36) % 12 + 12) % 12;
  tempoA(0, P.bpm);

  // introduction : deux mesures sur l'accord final (harpe, nappe ; grelots si festif)
  const fin0 = parseAccord(acc[acc.length - 1].n), tr0 = P.sections[0].transpo || 0;
  const introLen = metre * (P.introMesures ?? 2);
  if (introLen) {
    prog("harpe", 0); prog("nappe", 0);
    const tonsI = voix((fin0.root + tr0) % 12, fin0.ints, 50, 82);
    const pasI = metre === 6 ? 1 : .5;
    for (let i = 0; i * pasI < introLen; i++) note(INSTR.harpe.ch, tonsI[(i * 2) % tonsI.length], T(i * pasI), T(pasI * 3), 58 + (i % 8) * 2);
    if (!P.sansNappeIntro) for (const n of voix((fin0.root + tr0) % 12, fin0.ints, 55, 72)) note(INSTR.nappe.ch, n, 0, T(introLen), 50);
    if (P.festif) for (let b = 0; b < introLen; b += .5) note(DRUM, GRELOT, T(b), T(.4), b % 1 ? 50 : 72);
  }
  cur = T(introLen + (P.levee ? metre - P.levee : 0));

  const nSec = P.sections.length;
  P.sections.forEach((S, si) => {
    const tr = S.transpo || 0, oct = S.oct || 0, t0 = cur, derniere = si === nSec - 1;
    const acc_ = S.accomp || (S.cordes === "pizz" ? "pizz" : "tenue");
    const bpmS = S.bpm || P.bpm;
    if (S.bpm || si === 0) tempoA(t0, bpmS);
    prog(S.lead, t0);
    if (S.double) prog(S.double, t0);
    if (S.second) prog("second", t0, PROGS_SECOND[S.second] ?? 71);
    prog("nappe", t0); prog("harpe", t0); prog(["pizz", "valse", "marche", "galop", "gigue"].includes(acc_) ? "pizz" : "basse", t0);
    prog("violonsPizz", t0); prog("accords", t0, S.accordsProg ?? 48);
    if (S.choeur) prog("choeur", t0);
    if (S.cor) prog("cor", t0);
    if (S.glock) prog("glock", t0);
    if (S.timbales) prog("timbales", t0);
    if (acc_ === "choral" || S.orgue) prog("orgue", t0);
    prog("cloche", t0);
    let melo = mel, accs = acc;
    if (S.depuis) { const cut = (seq, b) => { const out = []; let x = 0; for (const e of seq) { if (x >= b - 1e-9) out.push(e); x += e.d; } return out; }; melo = cut(mel, S.depuis); accs = cut(acc, S.depuis); }
    const lenSec = melo.reduce((a, x) => a + x.d, 0);
    // carte des accords dans le temps (pour le contre-chant)
    const carte = []; { let x = 0; for (const { n, d } of accs) { carte.push({ x, d, A: parseAccord(n) }); x += d; } }
    const accordA = b => carte.find(c => b >= c.x - 1e-9 && b < c.x + c.d - 1e-9) || carte[carte.length - 1];
    // mélodie (+ doublure à l'octave, + contre-chant en tierces/sixtes sous la mélodie)
    let b = 0;
    const L = INSTR[S.lead], volLead = S.nuance ?? 0;
    for (const { n, d } of melo) {
      if (n !== "-") {
        const m = midiNote(n) + tr + oct;
        const accent = (b % metre === 0) ? 8 : 0;
        note(L.ch, m, t0 + T(b), T(d * (S.staccato ? .55 : 1)), L.vel + accent + volLead);
        if (S.double) { const D = INSTR[S.double]; note(D.ch, m + 12, t0 + T(b), T(d), D.vel + accent - 6); }
        if (S.second && d >= .5) {
          const C = accordA(b), root = (C.A.root + tr) % 12;
          const sous = voix(root, C.A.ints, m - 10, m - 2);
          const cible = sous.length ? sous[sous.length - 1] : m - 4;
          note(INSTR.second.ch, cible - (S.secondOct ? 12 : 0), t0 + T(b), T(d), INSTR.second.vel);
        }
      }
      b += d;
    }
    // accompagnement
    b = 0;
    for (const { n: a, d } of accs) {
      const A = parseAccord(a), root = (A.root + tr) % 12, tA = t0 + T(b);
      const ba = basseDe(root), quinte = ba + 7 > 52 ? ba - 5 : ba + 7;
      if (S.nappe !== false && acc_ !== "boite") for (const x of voix(root, A.ints, 53, 71).slice(0, 4)) note(INSTR.nappe.ch, x, tA, T(d), (S.nappeVel ?? 54) + si * 4);
      const B = INSTR[["pizz", "valse", "marche", "galop", "gigue"].includes(acc_) ? "pizz" : "basse"];
      const tons3 = voix(root, A.ints, 55, 68).slice(0, 3);
      for (let x = 0; x < d - 1e-6; x += 1) {
        const temps = (b + x) % metre;
        if (acc_ === "pizz") {
          if (metre === 3) { if (temps === 0) note(B.ch, ba, tA + T(x), T(.8), B.vel); else for (const v of tons3) note(INSTR.violonsPizz.ch, v, tA + T(x), T(.5), 58); }
          else if (temps % 2 === 0) note(B.ch, temps === 2 ? quinte : ba, tA + T(x), T(.8), B.vel);
        } else if (acc_ === "valse") {
          if (temps === 0) note(B.ch, (Math.floor((b + x) / metre) % 2) ? quinte : ba, tA + T(x), T(.9), B.vel);
          else for (const v of tons3) note(INSTR.accords.ch, v, tA + T(x), T(.45), 60);
        } else if (acc_ === "marche") {
          if (temps % 2 === 0) note(B.ch, temps === 2 ? quinte : ba, tA + T(x), T(.7), B.vel + 4);
          else for (const v of tons3) note(INSTR.accords.ch, v, tA + T(x), T(.4), 62);
        } else if (acc_ === "galop") {
          note(B.ch, temps % 2 ? quinte : ba, tA + T(x), T(.45), B.vel);
          for (const v of tons3) note(INSTR.violonsPizz.ch, v, tA + T(x + .5), T(.3), 62);
        } else if (acc_ === "gigue") {   // 6/8 : basse sur 1 et 4 (fondamentale, quinte), accords sur 3 et 6
          if (temps % 3 === 0) note(B.ch, temps === 0 ? ba : quinte, tA + T(x), T(1.6), B.vel);
          else if (temps % 3 === 2) for (const v of tons3) note(INSTR.violonsPizz.ch, v, tA + T(x), T(.8), 58);
        } else if (acc_ === "choral") {
          if (x === 0) { for (const v of voix(root, A.ints, 52, 70).slice(0, 4)) note(INSTR.orgue.ch, v, tA, T(d), 66); note(INSTR.orgue.ch, ba - 12 < 24 ? ba : ba - 12, tA, T(d), 70); }
        } else if (acc_ === "tenue") {
          if (x === 0) note(B.ch, ba, tA, T(d), B.vel);
        }
        // timbales : temps forts
        if (S.timbales && temps === 0) note(INSTR.timbales.ch, 41 + ((root - 41) % 12 + 12) % 12 - (((root - 41) % 12 + 12) % 12 > 6 ? 12 : 0), tA + T(x), T(1), 76);
        // glockenspiel : étincelle au premier temps, une mesure sur deux
        if (S.glock && temps === 0 && Math.floor((b + x) / metre) % 2 === 0) note(INSTR.glock.ch, voix(root, A.ints, 84, 97)[Math.floor(alea() * 3)], tA + T(x), T(1), INSTR.glock.vel);
      }
      if (acc_ === "boite") { // arpèges légers de harpe en noires
        const tons = voix(root, A.ints, 60, 84);
        for (let x = 0, k = 0; x < d - 1e-6; x += 1, k++) note(INSTR.harpe.ch, tons[[0, 2, 1, 3][k % 4] % tons.length], tA + T(x), T(1.5), 54);
      }
      if (S.harpe) {
        const tons = voix(root, A.ints, 48, 84), pas = S.arpRapide ? (metre === 6 ? 1 : .5) : (metre === 6 ? 1 : .5);
        const motif = S.arpMotif || [0, 2, 4, 6, 7, 6, 4, 2];
        for (let x = 0, k = 0; x < d - 1e-6; x += pas, k++) note(INSTR.harpe.ch, tons[motif[k % motif.length] % tons.length], tA + T(x), T(pas * 2.2), INSTR.harpe.vel - (k % 2) * 8);
      }
      if (S.cor) for (const x of voix(root, A.ints, 55, 67).slice(1, 3)) note(INSTR.cor.ch, x, tA, T(d), INSTR.cor.vel);
      if (S.choeur) for (const x of voix(root, A.ints, 57, 74).slice(0, 3)) note(INSTR.choeur.ch, x, tA, T(d), INSTR.choeur.vel);
      if (S.orgue && acc_ !== "choral") for (const x of voix(root, A.ints, 52, 70).slice(0, 3)) note(INSTR.orgue.ch, x, tA, T(d), 58);
      b += d;
    }
    // percussions
    if (S.grelots) for (let x = 0; x < lenSec; x += .5) {
      const fort = x % 1 === 0;
      if (S.grelots === 1 && !fort) continue;
      note(DRUM, GRELOT, t0 + T(x), T(.4), fort ? 68 : 46);
      if (S.grelots === 2 && x % metre === (metre === 3 ? 0 : 2)) note(DRUM, TAMBOURIN, t0 + T(x), T(.3), 50);
    }
    if (S.sabots) for (let x = 0; x < lenSec; x += .5) note(DRUM, (x * 2) % 2 ? WOOD_B : WOOD_H, t0 + T(x), T(.2), (x * 2) % 2 ? 46 : 60);   // trot des rennes
    if (S.caisse) for (let x = 0; x < lenSec; x += 1) { note(DRUM, CAISSE, t0 + T(x), T(.2), x % metre === 0 ? 56 : 40); if (x % 2 === 1) note(DRUM, CAISSE, t0 + T(x + .5), T(.2), 34); }
    if (S.triangle) for (let x = 0; x < lenSec; x += metre) note(DRUM, TRIANGLE, t0 + T(x), T(1), 44);
    if (S.cloches || derniere) note(INSTR.cloche.ch, 72 + ((parseAccord(acc[acc.length - 1].n).root + tr) % 12) - 12, t0 + T(lenSec - accs[accs.length - 1].d), T(4), 78);
    if (S.ralenti || derniere) {
      const deb = Math.max(0, lenSec - metre * 2);
      for (let k = 0; k <= 8; k++) ev.push({ t: t0 + T(deb + k * metre * 2 / 8), type: "setTempo", microsecondsPerBeat: Math.round(60e6 / (bpmS * u * (1 - k * .035))) });
    }
    cur = t0 + T(lenSec);
  });
  // accord final
  const fin = parseAccord(acc[acc.length - 1].n), trF = P.sections[nSec - 1].transpo || 0, rootF = (fin.root + trF) % 12;
  voix(rootF, fin.ints, 43, 96).forEach((x, i) => note(INSTR.harpe.ch, x, cur + Math.round(i * TPB * .09), T(6), 60 + i));
  for (const x of voix(rootF, fin.ints, 53, 71)) note(INSTR.nappe.ch, x, cur, T(metre * 2), 70);
  note(INSTR.basse.ch, basseDe(rootF), cur, T(metre * 2), 80);
  note(INSTR.cloche.ch, 60 + rootF, cur, T(6), 82);
  if (P.festif) note(DRUM, TRIANGLE, cur, T(2), 66);
  const fini = cur + T(metre * 2) + TPB * 6;

  ev.sort((a, b) => a.t - b.t || (a.type === "noteOff" ? -1 : 1));
  const pistes = new Map(), glob = [];
  for (const e of ev) { if (e.type === "setTempo") { glob.push(e); continue; } if (!pistes.has(e.channel)) pistes.set(e.channel, []); pistes.get(e.channel).push(e); }
  glob.sort((a, b) => a.t - b.t); glob.push({ t: fini, type: "endOfTrack" });
  const delta = arr => { let p = 0; return arr.map(e => { const { t, ...r } = e; const o = { deltaTime: t - p, ...r }; p = t; return o; }); };
  const tracks = [delta(glob)];
  for (const [, arr] of [...pistes.entries()].sort((a, b) => a[0] - b[0])) { arr.push({ t: arr[arr.length - 1].t, type: "endOfTrack" }); tracks.push(delta(arr)); }
  return writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: TPB }, tracks });
}

// ------------------------------------------------------------ rendu
let banque = null;
/** `depuisZero` : le rendu commence au temps 0 et non à la première note (indispensable quand
 *  on rend les instruments séparément pour les mixer : toutes les pistes gardent le même départ). */
export async function rendu(bytes, fichierWav, { depuisZero = false } = {}) {
  if (!banque) { const sf = await fs.readFile(new URL("./node_modules/generaluser/GeneralUser.sf2", import.meta.url)); banque = SoundBankLoader.fromArrayBuffer(sf.buffer.slice(sf.byteOffset, sf.byteOffset + sf.byteLength)); }
  const midi = BasicMIDI.fromArrayBuffer(new Uint8Array(bytes).buffer);
  const sr = 44100;
  const synth = new SpessaSynthProcessor(sr, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(banque, "main");
  await synth.ready;
  synth.setSystemParameter?.("autoAllocateVoices", true);
  const seq = new SpessaSynthSequencer(synth);
  if (depuisZero) seq.skipToFirstNoteOn = false;
  seq.loadNewSongList([midi]); seq.loopCount = 0; seq.loop = false; seq.play();
  const n = Math.ceil(sr * (midi.duration + 3));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let f = 0; f < n; f += 128) { seq.processTick(); synth.process(L, R, f, Math.min(128, n - f)); }
  let crete = 0; for (let i = 0; i < n; i++) crete = Math.max(crete, Math.abs(L[i]), Math.abs(R[i]));
  const k = .7 / (crete || 1); for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
  await fs.writeFile(fichierWav, new Uint8Array(audioToWav([L, R], sr)));
  return midi.duration;
}
