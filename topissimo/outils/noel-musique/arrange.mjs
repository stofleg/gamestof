// Arrangeur de chants de Noël (domaine public) → MIDI multipiste → rendu GeneralUser GS (spessasynth).
// Usage : node arrange.mjs [cle] … (sans argument : tous)
import * as fs from "node:fs/promises";
import midiFile from "midi-file";
import { audioToWav, BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer } from "spessasynth_core";
const { writeMidi } = midiFile;

const TPB = 480;
const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const QUAL = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6], sus4: [0, 5, 7] };
const midiNote = n => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); return 12 * (+m[2] + 1) + PC[m[1]]; };
const parseSeq = s => s.trim().split(/\s+/).map(x => { const [n, d] = x.split(":"); return { n, d: +d }; });
function parseAccord(a) { const m = /^([A-G][#b]?)(.*)$/.exec(a); return { root: PC[m[1]], ints: QUAL[m[2]] }; }
const rnd = (a) => (Math.random() * 2 - 1) * a;

// ------------------------------------------------------------ morceaux
// melodie : notes « Note:durée » en temps ; accords : « Accord:durée » alignés sur la mélodie.
const MORCEAUX = {
  vive: {
    titre: "Vive le vent (Jingle Bells)", credit: "James Lord Pierpont, 1857", bpm: 128, metre: 4, festif: true,
    melodie:
      // couplet
      "G4:1 E5:1 D5:1 C5:1 G4:3 G4:.5 G4:.5 G4:1 E5:1 D5:1 C5:1 A4:4 A4:1 F5:1 E5:1 D5:1 B4:4 G5:1 G5:1 F5:1 D5:1 E5:4 " +
      "G4:1 E5:1 D5:1 C5:1 G4:4 G4:1 E5:1 D5:1 C5:1 A4:3 A4:1 A4:1 F5:1 E5:1 D5:1 G5:1 G5:1 G5:1 G5:1 A5:1 G5:1 F5:1 D5:1 C5:4 " +
      // refrain
      "E5:1 E5:1 E5:2 E5:1 E5:1 E5:2 E5:1 G5:1 C5:1.5 D5:.5 E5:4 F5:1 F5:1 F5:1.5 F5:.5 F5:1 E5:1 E5:1 E5:.5 E5:.5 E5:1 D5:1 D5:1 E5:1 D5:2 G5:2 " +
      "E5:1 E5:1 E5:2 E5:1 E5:1 E5:2 E5:1 G5:1 C5:1.5 D5:.5 E5:4 F5:1 F5:1 F5:1.5 F5:.5 F5:1 E5:1 E5:1 E5:.5 E5:.5 G5:1 G5:1 F5:1 D5:1 C5:4",
    accords:
      "C:4 C:4 C:4 F:4 Dm:4 G:4 G7:4 C:4 C:4 C:4 C:4 F:4 F:4 G:4 G7:4 C:4 " +
      "C:4 C:4 C:4 C:4 F:4 C:4 D7:4 G7:4 C:4 C:4 C:4 C:4 F:4 C:4 G7:4 C:4",
    sections: [
      { lead: "celesta", oct: 0, cordes: "pizz", harpe: true, grelots: 1 },
      { lead: "cordes", oct: 0, double: "flute", cor: true, harpe: true, glock: true, grelots: 2, timbales: true, choeur: false },
      { lead: "cuivres", transpo: 2, double: "cordesHaut", choeur: true, cor: true, harpe: true, glock: true, grelots: 2, timbales: true, depuis: 64 },
    ],
  },
  nuit: {
    titre: "Douce nuit", credit: "Franz Xaver Gruber, 1818", bpm: 150, metre: 6, festif: false, unite: .5,
    melodie:
      "G4:3 A4:1 G4:2 E4:6 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 B4:6 C5:4 C5:2 G4:6 A4:4 A4:2 C5:3 B4:1 A4:2 G4:3 A4:1 G4:2 E4:6 " +
      "A4:4 A4:2 C5:3 B4:1 A4:2 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 F5:3 D5:1 B4:2 C5:6 E5:6 C5:3 G4:1 E4:2 G4:3 F4:1 D4:2 C4:12",
    accords:
      "C:6 C:6 C:6 C:6 G7:6 G7:6 C:6 C:6 F:6 F:6 C:6 C:6 F:6 F:6 C:6 C:6 G7:6 G7:6 C:6 C:6 C:6 G7:6 C:12",
    sections: [
      { lead: "celesta", oct: 12, harpe: true, cordes: "nappe", arpRapide: true },
      { lead: "cordesLentes", oct: 12, double: "flute", choeur: true, cor: true, harpe: true, arpRapide: true, cloches: true },
    ],
  },
  wish: {
    titre: "We Wish You a Merry Christmas", credit: "chant traditionnel anglais", bpm: 168, metre: 3, festif: true, levee: 1,
    melodie: "D4:1 G4:1 G4:.5 A4:.5 G4:.5 F#4:.5 E4:1 E4:1 E4:1 A4:1 A4:.5 B4:.5 A4:.5 G4:.5 F#4:1 D4:1 D4:1 B4:1 B4:.5 C5:.5 B4:.5 A4:.5 G4:1 E4:1 D4:.5 D4:.5 E4:1 A4:1 F#4:1 G4:2",
    accords: "D7:1 G:3 C:3 A7:3 D:3 B7:3 Em:3 C:1 D7:2 G:2",
    sections: [
      { lead: "celesta", oct: 12, cordes: "pizz", grelots: 1 },
      { lead: "flute", oct: 12, cordes: "pizz", harpe: true, glock: true, grelots: 2 },
      { lead: "cordes", oct: 12, double: "clarinette", cor: true, harpe: true, grelots: 2, timbales: true },
      { lead: "cuivres", transpo: 2, oct: 12, double: "cordesHaut", cor: true, choeur: true, harpe: true, glock: true, grelots: 2, timbales: true },
      { lead: "cuivres", transpo: 2, oct: 12, double: "cordesHaut", cor: true, choeur: true, harpe: true, glock: true, grelots: 2, timbales: true, ralenti: true },
    ],
  },
  deck: {
    titre: "Deck the Halls", credit: "chant traditionnel gallois", bpm: 120, metre: 4, festif: true,
    melodie:
      "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 G4:.5 A4:.5 Bb4:.5 G4:.5 A4:1.5 G4:.5 F4:1 E4:1 F4:2 " +
      "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 G4:.5 A4:.5 Bb4:.5 G4:.5 A4:1.5 G4:.5 F4:1 E4:1 F4:2 " +
      "G4:1.5 A4:.5 Bb4:1 G4:1 A4:1.5 Bb4:.5 C5:1 G4:1 A4:.5 B4:.5 C5:1 D5:.5 E5:.5 F5:1 E5:1 D5:1 C5:2 " +
      "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 D5:.5 D5:.5 D5:.5 D5:.5 C5:1.5 Bb4:.5 A4:1 G4:1 F4:2",
    accords:
      "F:4 F:2 C7:2 C7:2 F:2 C7:2 F:2 F:4 F:2 C7:2 C7:2 F:2 C7:2 F:2 " +
      "C:4 F:2 C:2 Dm:2 G7:2 C:4 F:4 F:4 Bb:2 F:2 C7:2 F:2",
    sections: [
      { lead: "hautbois", oct: 0, cordes: "pizz", harpe: true, grelots: 1 },
      { lead: "cordes", oct: 12, double: "flute", cor: true, harpe: true, glock: true, grelots: 2, timbales: true },
      { lead: "cuivres", transpo: 2, oct: 0, double: "cordesHaut", cor: true, choeur: true, harpe: true, glock: true, grelots: 2, timbales: true, ralenti: true },
    ],
  },
  joie: {
    titre: "Joy to the World", credit: "Lowell Mason d’après Haendel, 1839", bpm: 100, metre: 4, festif: false,
    melodie:
      "D5:1 C#5:.75 B4:.25 A4:1.5 G4:.5 F#4:1 E4:1 D4:1.5 A4:.5 B4:1.5 B4:.5 C#5:1.5 C#5:.5 D5:3 " +
      "D5:.5 D5:.5 C#5:.5 B4:.5 A4:.5 A4:.75 G4:.25 F#4:.5 D5:.5 D5:.5 C#5:.5 B4:.5 A4:.5 A4:.75 G4:.25 F#4:.5 " +
      "F#4:.5 F#4:.5 F#4:.5 F#4:.5 F#4:.25 G4:.25 A4:1.5 G4:.25 F#4:.25 E4:.5 E4:.5 E4:.5 E4:.25 F#4:.25 G4:1.5 " +
      "F#4:.25 E4:.25 D4:.5 D5:1 B4:.5 A4:.75 G4:.25 F#4:.5 G4:.5 F#4:1 E4:1 D4:2.5",
    accords:
      "D:4 D:1 A7:1 D:2 G:2 A:2 D:3 D:2 A7:2 D:4 D:4 A7:4 D:1 G:1 D:1 G:1 A7:2 D:3",
    sections: [
      { lead: "cloches", oct: 0, cordes: "nappe", harpe: true },
      { lead: "cordes", oct: 0, double: "flute", cor: true, harpe: true, timbales: true },
      { lead: "cuivres", transpo: 1, oct: 0, double: "cordesHaut", choeur: true, cor: true, harpe: true, glock: true, timbales: true },
      { lead: "cuivres", transpo: 1, oct: 0, double: "cordesHaut", choeur: true, cor: true, harpe: true, glock: true, timbales: true, ralenti: true },
    ],
  },
};

// ------------------------------------------------------------ instruments (canal, programme GM, banque)
const INSTR = {
  celesta: { ch: 0, prog: 8, vol: 104, vel: 92, pan: 64 },
  cordes: { ch: 0, prog: 48, vol: 100, vel: 92, pan: 60 },
  cordesLentes: { ch: 0, prog: 49, vol: 104, vel: 96, pan: 60 },
  cuivres: { ch: 0, prog: 60, vol: 104, vel: 100, pan: 64 },   // cors à l'unisson
  hautbois: { ch: 0, prog: 68, vol: 100, vel: 92, pan: 64 },
  flute: { ch: 1, prog: 73, vol: 84, vel: 82, pan: 76 },
  clarinette: { ch: 1, prog: 71, vol: 82, vel: 82, pan: 76 },
  cordesHaut: { ch: 1, prog: 48, vol: 86, vel: 86, pan: 56 },
  cloches: { ch: 0, prog: 10, bank: 12, vol: 100, vel: 90, pan: 64 },   // « Christmas Bells » de GeneralUser
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
};
const DRUM = 9, GRELOT = 83, TAMBOURIN = 54, TRIANGLE = 81;

// ------------------------------------------------------------ construction
function arrange(cle) {
  const P = MORCEAUX[cle];
  const ev = [];            // { t (ticks), type, ... }
  const u = P.unite || 1;   // durée de l'unité de temps en noires (Douce nuit : croches)
  const T = b => Math.round(b * TPB * u);
  const mel = parseSeq(P.melodie), acc = parseSeq(P.accords);
  const longueur = mel.reduce((a, x) => a + x.d, 0);
  const accLong = acc.reduce((a, x) => a + x.d, 0);
  if (Math.abs(longueur - accLong) > .01) throw new Error(`${cle} : mélodie ${longueur} ≠ accords ${accLong}`);
  const tempo = bpm => ev.push({ t: cur, type: "setTempo", microsecondsPerBeat: Math.round(60e6 / (bpm * u)) });
  const prog = (name, t) => {
    const I = INSTR[name];
    if (I.bank != null) ev.push({ t, type: "controller", channel: I.ch, controllerType: 0, value: I.bank });
    else ev.push({ t, type: "controller", channel: I.ch, controllerType: 0, value: 0 });
    ev.push({ t, type: "programChange", channel: I.ch, programNumber: I.prog });
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
  const voix = (root, ints, lo, hi) => {
    const pcs = ints.map(i => (root + i) % 12), out = [];
    for (let n = lo; n < hi; n++) if (pcs.includes(n % 12)) out.push(n);
    return out;
  };
  let cur = 0;
  tempo(P.bpm);
  const metre = P.metre;

  // introduction : deux mesures d'arpèges de harpe sur le premier accord (ou dernier), célesta
  const premier = parseAccord(acc[acc.length - 1].n);
  prog("harpe", 0); prog("nappe", 0);
  const introLen = metre * 2;
  const tonsI = voix(premier.root, premier.ints, 50, 82);
  for (let i = 0; i < introLen * 2; i++) note(INSTR.harpe.ch, tonsI[(i * 2) % tonsI.length] + (i >= tonsI.length / 2 ? 0 : 0), T(i / 2), T(1.5), 58 + i);
  for (const n of voix(premier.root, premier.ints, 55, 72)) note(INSTR.nappe.ch, n, 0, T(introLen), 50);
  if (P.festif) for (let b = 0; b < introLen; b += .5) note(DRUM, GRELOT, T(b), T(.4), b % 1 ? 50 : 72);
  cur = T(introLen + (P.levee ? metre - P.levee : 0));

  const nSec = P.sections.length;
  P.sections.forEach((S, si) => {
    const tr = S.transpo || 0, oct = S.oct || 0, t0 = cur, derniere = si === nSec - 1;
    // programmes de la section
    prog(S.lead, t0);
    if (S.double) prog(S.double, t0);
    prog("nappe", t0); prog("harpe", t0); prog(S.cordes === "pizz" ? "pizz" : "basse", t0);
    if (S.choeur) prog("choeur", t0);
    if (S.cor) prog("cor", t0);
    if (S.glock) prog("glock", t0);
    if (S.timbales) prog("timbales", t0);
    prog("cloche", t0);
    if (S.cordes === "pizz") prog("violonsPizz", t0);
    // départ : on peut sauter le début (S.depuis, en temps)
    let melo = mel, accs = acc;
    if (S.depuis) { const cut = (seq, b) => { const out = []; let x = 0; for (const e of seq) { if (x >= b) out.push(e); x += e.d; } return out; }; melo = cut(mel, S.depuis); accs = cut(acc, S.depuis); }
    const lenSec = melo.reduce((a, x) => a + x.d, 0);
    // mélodie
    let b = 0;
    const L = INSTR[S.lead];
    for (const { n, d } of melo) {
      if (n !== "-") {
        const m = midiNote(n) + tr + oct;
        const accent = (b % metre === 0) ? 8 : 0;
        note(L.ch, m, t0 + T(b), T(d), L.vel + accent);
        if (S.double) { const D = INSTR[S.double]; note(D.ch, m + 12, t0 + T(b), T(d), D.vel + accent - 6); }
      }
      b += d;
    }
    // accompagnement, accord par accord
    b = 0;
    let derniereNappe = null;
    for (const { n: a, d } of accs) {
      const A = parseAccord(a), root = (A.root + tr) % 12;
      const tA = t0 + T(b);
      // nappe de cordes (tenue), voix proches de la précédente
      const nappe = voix(root, A.ints, 53, 71).slice(0, 4);
      for (const x of nappe) note(INSTR.nappe.ch, x, tA, T(d), 54 + (si * 6));
      derniereNappe = nappe;
      // basse : fondamentale sur les temps forts
      const B = INSTR[S.cordes === "pizz" ? "pizz" : "basse"];
      const basse = 36 + ((root - 36) % 12 + 12) % 12;
      if (S.cordes === "pizz") {
        for (let x = 0; x < d; x += (metre === 3 ? 3 : 2)) note(B.ch, x % 4 === 2 && A.ints.length ? basse + 7 : basse, tA + T(x), T(.8), B.vel);
        if (metre === 3) for (let x = 1; x < d; x += 3) { for (const y of [1, 2]) if (x + y - 1 < d) for (const v of voix(root, A.ints, 55, 67).slice(0, 3)) note(INSTR.violonsPizz.ch, v, tA + T(x + y - 1), T(.5), 58); }
      } else note(B.ch, basse, tA, T(d), B.vel);
      // harpe : arpèges (croches, ou doubles croches pour Douce nuit)
      if (S.harpe) {
        const tons = voix(root, A.ints, 48, 84), pas = S.arpRapide ? 1 : .5;
        const motif = [0, 2, 4, 6, 7, 6, 4, 2];
        for (let x = 0, k = 0; x < d - 1e-6; x += pas, k++) {
          const idx = motif[k % motif.length] % tons.length;
          note(INSTR.harpe.ch, tons[idx], tA + T(x), T(pas * 2.2), INSTR.harpe.vel - (k % 2) * 8);
        }
      }
      // cor : tierce et quinte tenues, dans le médium
      if (S.cor) for (const x of voix(root, A.ints, 55, 67).slice(1, 3)) note(INSTR.cor.ch, x, tA, T(d), INSTR.cor.vel);
      // chœur « ah »
      if (S.choeur) for (const x of voix(root, A.ints, 57, 74).slice(0, 3)) note(INSTR.choeur.ch, x, tA, T(d), INSTR.choeur.vel);
      // glockenspiel : une étincelle sur le 1er temps
      if (S.glock && (b % metre === 0)) note(INSTR.glock.ch, voix(root, A.ints, 84, 97)[Math.floor(Math.random() * 3)], tA, T(1), INSTR.glock.vel);
      // timbales : fondamentale et quinte aux temps forts de chaque mesure
      if (S.timbales && b % metre === 0) note(INSTR.timbales.ch, 43 + ((root - 43) % 12 + 12) % 12 - (((root - 43) % 12 + 12) % 12 > 7 ? 12 : 0), tA, T(1), 78);
      b += d;
    }
    // grelots du traîneau
    if (S.grelots) {
      for (let x = 0; x < lenSec; x += .5) {
        const fort = x % 1 === 0;
        if (S.grelots === 1 && !fort) continue;
        note(DRUM, GRELOT, t0 + T(x), T(.4), fort ? 70 : 48);
        if (S.grelots === 2 && x % metre === (metre === 3 ? 0 : 2)) note(DRUM, TAMBOURIN, t0 + T(x), T(.3), 52);
      }
    }
    // cloches à la fin de la section
    if (S.cloches || derniere) note(INSTR.cloche.ch, midiNote("C5") + ((parseAccord(acc[acc.length - 1].n).root + tr) % 12), t0 + T(lenSec - (accs[accs.length - 1].d)), T(4), 80);
    // ralenti final
    if (S.ralenti || derniere) {
      const deb = Math.max(0, lenSec - metre * 2);
      for (let k = 0; k <= 8; k++) ev.push({ t: t0 + T(deb + k * metre * 2 / 8), type: "setTempo", microsecondsPerBeat: Math.round(60e6 / (P.bpm * u * (1 - k * .035))) });
    }
    cur = t0 + T(lenSec);
    // petite respiration entre les sections, sauf à la fin
    if (!derniere) cur += 0;
  });
  // accord final : tenue avec glissando de harpe, cloches, triangle
  const fin = parseAccord(acc[acc.length - 1].n), trF = P.sections[nSec - 1].transpo || 0, rootF = (fin.root + trF) % 12;
  const tonsF = voix(rootF, fin.ints, 43, 96);
  tonsF.forEach((x, i) => note(INSTR.harpe.ch, x, cur + Math.round(i * TPB * .09), T(6), 60 + i));
  for (const x of voix(rootF, fin.ints, 53, 71)) note(INSTR.nappe.ch, x, cur, T(metre * 2), 70);
  note(INSTR.basse.ch, 36 + ((rootF - 36) % 12 + 12) % 12, cur, T(metre * 2), 80);
  note(INSTR.cloche.ch, 60 + rootF, cur, T(6), 84);
  if (P.festif) note(DRUM, TRIANGLE, cur, T(2), 70);
  const fini = cur + T(metre * 2) + TPB * 6;

  // MIDI : une piste par canal
  ev.sort((a, b) => a.t - b.t || (a.type === "noteOff" ? -1 : 1));
  const pistes = new Map();
  const glob = [];
  for (const e of ev) {
    if (e.type === "setTempo") { glob.push(e); continue; }
    if (!pistes.has(e.channel)) pistes.set(e.channel, []);
    pistes.get(e.channel).push(e);
  }
  glob.push({ t: fini, type: "endOfTrack" });
  const delta = arr => { let p = 0; return arr.map(e => { const { t, ...r } = e; const o = { deltaTime: t - p, ...r }; p = t; return o; }); };
  const tracks = [delta(glob)];
  for (const [, arr] of [...pistes.entries()].sort((a, b) => a[0] - b[0])) { arr.push({ t: arr[arr.length - 1].t, type: "endOfTrack" }); tracks.push(delta(arr)); }
  return { bytes: writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: TPB }, tracks }), P };
}

// ------------------------------------------------------------ rendu
const sf = await fs.readFile("node_modules/generaluser/GeneralUser.sf2");
const bank = SoundBankLoader.fromArrayBuffer(sf.buffer.slice(sf.byteOffset, sf.byteOffset + sf.byteLength));
const cles = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MORCEAUX);
for (const cle of cles) {
  const { bytes, P } = arrange(cle);
  await fs.writeFile(`${cle}.mid`, new Uint8Array(bytes));
  const midi = BasicMIDI.fromArrayBuffer(new Uint8Array(bytes).buffer);
  const sr = 44100;
  const synth = new SpessaSynthProcessor(sr, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(bank, "main");
  await synth.ready;
  synth.setSystemParameter?.("autoAllocateVoices", true);
  const seq = new SpessaSynthSequencer(synth);
  seq.loadNewSongList([midi]); seq.loopCount = 0; seq.loop = false; seq.play();
  const n = Math.ceil(sr * (midi.duration + 3));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let f = 0; f < n; f += 128) { seq.processTick(); synth.process(L, R, f, Math.min(128, n - f)); }
  let crete = 0; for (let i = 0; i < n; i++) crete = Math.max(crete, Math.abs(L[i]), Math.abs(R[i]));
  const k = .7 / crete; for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }   // crête à −3 dBFS, sans écrêtage
  console.log("  crête avant normalisation", crete.toFixed(2));
  await fs.writeFile(`${cle}.wav`, new Uint8Array(audioToWav([L, R], sr)));
  console.log(cle, P.titre, Math.round(midi.duration), "s");
}
