// Effets « No Hell ! » : top (accord de puissance + crash), scrabble (riff, piqué de vibrato,
// roulement), ouverture du cadeau (roulement de toms + accord), rendus avec GeneralUser GS.
import * as fs from "node:fs/promises";
import midiFile from "midi-file";
import { rendu, TPB } from "./moteur.mjs";
const { writeMidi } = midiFile;
function piste(bpm, fn) {
  const ev = [];
  const T = q => Math.round(q * TPB);
  const n = (ch, k, q, d, v) => { ev.push({ t: T(q), type: "noteOn", channel: ch, noteNumber: k, velocity: v }); ev.push({ t: T(q + d), type: "noteOff", channel: ch, noteNumber: k, velocity: 0 }); };
  const c = (t, ch, cc, v) => ev.push({ t, type: "controller", channel: ch, controllerType: cc, value: v });
  ev.push({ t: 0, type: "setTempo", microsecondsPerBeat: Math.round(60e6 / bpm) });
  for (const [ch, prog, pan, vol] of [[0, 30, 14, 100], [1, 30, 114, 100], [2, 34, 64, 104], [3, 29, 64, 96], [4, 52, 64, 80], [9, 16, 64, 120]]) {
    c(0, ch, 0, 0); ev.push({ t: 0, type: "programChange", channel: ch, programNumber: prog }); c(0, ch, 10, pan); c(0, ch, 7, vol); c(0, ch, 91, 40);
    c(0, ch, 101, 0); c(0, ch, 100, 0); c(0, ch, 6, 12); c(0, ch, 38, 0);   // pitch bend : 12 demi-tons
  }
  const pb = (q, ch, v) => ev.push({ t: T(q), type: "pitchBend", channel: ch, value: v });
  const fin = fn({ n, pb, T });
  ev.sort((a, b) => a.t - b.t || (a.type === "noteOff" ? -1 : 1));
  const pistes = new Map(), glob = [];
  for (const e of ev) { if (e.type === "setTempo") { glob.push(e); continue; } if (!pistes.has(e.channel)) pistes.set(e.channel, []); pistes.get(e.channel).push(e); }
  glob.push({ t: T(fin), type: "endOfTrack" });
  const delta = arr => { let p = 0; return arr.map(e => { const { t, ...r } = e; const o = { deltaTime: t - p, ...r }; p = t; return o; }); };
  const tracks = [delta(glob), ...[...pistes.values()].map(a => { a.push({ t: a[a.length - 1].t, type: "endOfTrack" }); return delta(a); })];
  return writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: TPB }, tracks });
}
const accord = (n, q, d, v, r = 40) => { for (const ch of [0, 1]) for (const k of [r, r + 7, r + 12]) n(ch, k, q, d, v); n(2, r - 12, q, d, v); };
const FX = {
  top: piste(140, ({ n }) => {
    accord(n, 0, 2.6, 118, 45); n(9, 49, 0, 2, 120); n(9, 36, 0, .5, 120); n(9, 38, 0, .5, 100);
    n(3, 69, 0, 2.6, 104); return 3;
  }),
  ouverture: piste(150, ({ n }) => {
    const toms = [50, 50, 48, 48, 47, 47, 45, 45, 43, 43, 41, 41];
    toms.forEach((k, i) => { n(9, k, i * .25, .25, 90 + i * 3); if (i % 2 === 0) n(9, 36, i * .25, .2, 96); });
    accord(n, 3, 3.5, 120, 40); n(9, 49, 3, 2, 124); n(9, 57, 3, 2, 110); n(9, 36, 3, .5, 124); n(4, 52, 3, 3.5, 90); n(4, 59, 3, 3.5, 90); n(4, 64, 3, 3.5, 90);
    return 7;
  }),
  scrabble: piste(176, ({ n, pb }) => {
    // 2 mesures de galop sur mi, double pédale
    for (let q = 0; q < 8; q += 1) { for (const x of [0, .5, .75]) for (const ch of [0, 1]) for (const k of [40, 47]) n(ch, k, q + x, x ? .2 : .4, x ? 96 : 116); n(2, 28, q, .45, 110); }
    for (let q = 0; q < 8; q += .25) n(9, 36, q, .2, 104);
    for (let q = 0; q < 8; q += 1) n(9, q % 2 ? 38 : 51, q, .3, q % 2 ? 118 : 96);
    n(9, 49, 0, 2, 122);
    // solo : montée puis note tenue qui plonge (whammy)
    [64, 67, 71, 76, 79, 83, 88, 83, 79, 76, 79, 83, 88, 91].forEach((k, i) => n(3, k, 4 + i * .25, .3, 108));
    n(3, 88, 7.5, 5, 118);
    for (let i = 0; i <= 40; i++) pb(9 + i * .06, 3, Math.round(-8191 * Math.min(1, i / 40) ** 1.6));
    pb(13, 3, 0);
    accord(n, 8, 4.5, 124, 40); n(9, 49, 8, 2, 126); n(9, 52, 8, 2, 110); n(9, 36, 8, .5, 126);
    for (let q = 10; q < 12; q += .125) n(9, 38, q, .1, 60 + (q - 10) * 30);
    accord(n, 12, 3, 124, 40); n(9, 49, 12, 2, 127); n(9, 36, 12, .5, 127);
    return 15;
  }),
};
await fs.mkdir("fx", { recursive: true });
for (const [nom, midi] of Object.entries(FX)) { const d = await rendu(midi, `fx/${nom}.wav`); console.log(nom, d.toFixed(1)); }
