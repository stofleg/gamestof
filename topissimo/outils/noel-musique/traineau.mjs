// Passage du traîneau (scrabble) : vrais grelots échantillonnés (GeneralUser GS) qui arrivent de
// gauche, passent et s'éloignent à droite, trot en bois, arpège de célesta et cloches de Noël.
import * as fs from "node:fs/promises";
import midiFile from "midi-file";
import { rendu, TPB } from "./moteur.mjs";
const { writeMidi } = midiFile;
const BPM = 132, D = 7.5, B = s => s * BPM / 60;   // secondes → temps
const ev = []; const T = b => Math.round(b * TPB);
let g = 7; const r = () => { g = (g * 16807) % 2147483647; return g / 2147483647; };
const note = (ch, n, b, d, v) => { ev.push({ t: T(b), type: "noteOn", channel: ch, noteNumber: n, velocity: Math.max(1, Math.min(127, Math.round(v))) }); ev.push({ t: T(b + d), type: "noteOff", channel: ch, noteNumber: n, velocity: 0 }); };
const cc = (ch, c, v, b) => ev.push({ t: T(b), type: "controller", channel: ch, controllerType: c, value: Math.round(v) });
ev.push({ t: 0, type: "setTempo", microsecondsPerBeat: Math.round(60e6 / BPM) });
cc(9, 7, 120, 0); cc(9, 91, 50, 0);
const fin = B(D);
for (let b = 0; b < fin; b += .25) {           // grelots en doubles croches, secoués
  const x = b / fin, env = Math.sin(Math.PI * Math.min(1, x * 1.05)) ** .8;
  const acc = b % 1 === 0 ? 1 : b % .5 === 0 ? .8 : .62;
  note(9, 83, b + (r() - .5) * .04, .3, 30 + 95 * env * acc * (.85 + r() * .3));
  if (r() < .35) note(9, 83, b + .125 + (r() - .5) * .03, .2, 20 + 60 * env);
  if (b % 1 === 0) note(9, b % 2 ? 77 : 76, b, .15, 18 + 55 * env);   // trot
  cc(9, 10, 8 + 112 * x, b);                    // de gauche à droite
}
// célesta : arpège joyeux au passage, puis cloches de Noël
ev.push({ t: 0, type: "programChange", channel: 0, programNumber: 8 }); cc(0, 7, 110, 0); cc(0, 91, 70, 0); cc(0, 10, 64, 0);
["C5", "E5", "G5", "C6", "E6", "G6", "C7"].forEach((n, i) => note(0, { C: 0, E: 4, G: 7 }[n[0]] + 12 * (+n[1] + 1), B(3.0) + i * .25, 1.5, 96 - i * 2));
cc(1, 0, 12, 0); ev.push({ t: 0, type: "programChange", channel: 1, programNumber: 10 }); cc(1, 7, 100, 0); cc(1, 91, 80, 0);
[60, 64, 67, 72].forEach(n => note(1, n, B(4.6), 3, 92));
ev.push({ t: 0, type: "programChange", channel: 2, programNumber: 49 }); cc(2, 7, 70, 0); cc(2, 91, 80, 0);
[48, 55, 64, 67].forEach(n => note(2, n, B(3.0), B(4), 60));
ev.sort((a, b) => a.t - b.t || (a.type === "noteOff" ? -1 : 1));
const pistes = new Map(), glob = [ev.find(e => e.type === "setTempo")];
for (const e of ev) { if (e.type === "setTempo") continue; if (!pistes.has(e.channel)) pistes.set(e.channel, []); pistes.get(e.channel).push(e); }
const delta = arr => { let p = 0; return arr.map(e => { const { t, ...rr } = e; const o = { deltaTime: Math.max(0, t - p), ...rr }; p = Math.max(p, t); return o; }); };
const tracks = [delta([...glob, { t: T(fin + B(2)), type: "endOfTrack" }])];
for (const [, a] of pistes) { a.push({ t: a[a.length - 1].t, type: "endOfTrack" }); tracks.push(delta(a)); }
const bytes = writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: TPB }, tracks });
await rendu(bytes, "traineau.wav");
console.log("ok");
