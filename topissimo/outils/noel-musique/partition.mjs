// Rendu des partitions lues par lecture.py (chorals de Bach, quatuors) : orchestration par partie,
// passages successifs pour les chorals à 4 voix (chœur et cordes, vents, tutti avec trompettes et
// timbales), points d'orgue tenus, ralenti final.
import midiFile from "midi-file";
import { TPB } from "./moteur.mjs";
const { writeMidi } = midiFile;

const PROG = [  // nom de partie → [programme GM, volume, panoramique]
  [/trumpet|tromba/i, 56, 92, 70], [/timpani/i, 47, 96, 64], [/oboe da caccia/i, 69, 88, 46], [/oboe/i, 68, 90, 50],
  [/flute|flauto/i, 73, 86, 80], [/horn|corno/i, 60, 88, 40], [/violin\s*(1|i)\b|1st violin|violin 1/i, 48, 100, 34],
  [/violin/i, 48, 92, 54], [/viola/i, 48, 86, 74], [/cello|violoncello/i, 42, 96, 88], [/organ|continuo/i, 19, 70, 64],
  [/soprano|alto|tenor|bass/i, 52, 88, 64],
];
// orchestrations des chorals à 4 voix : [soprano, alto, ténor, basse] + options
const PASSAGES = [
  { nom: "chœur et cordes", voix: [[52, 48], [52, 48], [52, 48], [52, 42, 43]], orgue: true },
  { nom: "bois", voix: [[68, 73], [71], [70, 60], [70, 43]], harpe: true },
  { nom: "tutti", voix: [[52, 56, 48], [52, 60, 48], [52, 60, 48], [52, 57, 42, 43]], orgue: true, timbales: true },
];

export function partitionMidi(J, { bpm = 72, passages = 1, pauseFermate = 1, grelots = false, octaveBasse = true, repeter = 1, alea = Math.random } = {}) {
  const ev = [];
  const T = q => Math.round(q * TPB);
  let canal = 0; const prochain = () => { const c = canal++; if (canal === 9) canal++; return c; };
  const parties = J.parties.filter(p => p.notes.length);
  const satb = parties.length === 4 && parties.every(p => /soprano|alto|tenor|bass/i.test(p.nom) || p.nom === "");
  const quatuor = parties.length === 4 && parties.some(p => /violin/i.test(p.nom));
  const fermates = satb ? J.fermates.filter(f => f < J.fin - .01) : [];
  const decal = t => t + pauseFermate * fermates.filter(f => f <= t + 1e-6).length;   // pause après chaque point d'orgue
  const fin = q => decal(q);
  const note = (ch, n, t, d, v) => {
    if (n < 0 || n > 127) return;
    const t0 = Math.max(0, t + Math.round((alea() * 2 - 1) * 5));
    ev.push({ t: t0, type: "noteOn", channel: ch, noteNumber: n, velocity: Math.max(1, Math.min(127, Math.round(v + (alea() * 2 - 1) * 4))) });
    ev.push({ t: t0 + Math.max(10, d - 10), type: "noteOff", channel: ch, noteNumber: n, velocity: 0 });
  };
  const prog = (ch, p, vol, pan, t) => {
    ev.push({ t, type: "controller", channel: ch, controllerType: 0, value: 0 });
    ev.push({ t, type: "programChange", channel: ch, programNumber: p });
    ev.push({ t, type: "controller", channel: ch, controllerType: 7, value: vol });
    ev.push({ t, type: "controller", channel: ch, controllerType: 10, value: pan });
    ev.push({ t, type: "controller", channel: ch, controllerType: 91, value: 45 });
  };
  ev.push({ t: 0, type: "setTempo", microsecondsPerBeat: Math.round(60e6 / bpm) });
  const longPasse = fin(J.fin) + (satb ? 1 : 0);
  let origine = 0;
  const nPasses = satb ? passages : Math.max(1, repeter);
  for (let k = 0; k < nPasses; k++) {
    const t0 = T(origine);
    canal = 0;
    if (satb) {
      const P = PASSAGES[k % PASSAGES.length];
      parties.forEach((p, i) => {
        for (const g of P.voix[i]) {
          const ch = prochain();
          prog(ch, g, g === 52 ? 84 : g === 43 ? 80 : 88, [40, 56, 72, 88][i] + (g === 52 ? 0 : 6), t0);
          const oct = g === 43 ? -12 : 0;
          for (const [t, d, h] of p.notes) {
            const fermeFin = fermates.some(f => Math.abs(f - (t + d)) < 1e-6);
            note(ch, h + oct, t0 + T(decal(t)), T(d + (fermeFin ? pauseFermate * .85 : 0)), (g === 52 ? 76 : 70) + (i === 0 ? 8 : 0));
          }
        }
      });
      if (P.orgue) { const ch = prochain(); prog(ch, 19, 58, 64, t0); for (const p of parties) for (const [t, d, h] of p.notes) note(ch, h, t0 + T(decal(t)), T(d), 60); }
      if (P.harpe) { const ch = prochain(); prog(ch, 46, 70, 96, t0); for (const [t, d, h] of parties[3].notes) { note(ch, h, t0 + T(decal(t)), T(d), 66); } }
      if (P.timbales) { const ch = prochain(); prog(ch, 47, 92, 64, t0); for (const f of fermates.concat([J.fin])) { const b = parties[3].notes.find(n => Math.abs(n[0] + n[1] - f) < 1e-6); if (b) note(ch, 41 + ((b[2] - 41) % 12 + 12) % 12 - (((b[2] - 41) % 12 + 12) % 12 > 6 ? 12 : 0), t0 + T(decal(b[0])), T(b[1]), 84); } }
    } else {
      // partition orchestrale (ou quatuor) : chaque partie sur son instrument
      parties.forEach((p, i) => {
        const m = PROG.find(([re]) => re.test(p.nom)) || [null, quatuor ? 48 : 52, 88, 64];
        const ch = prochain(); prog(ch, m[1], m[2], m[3], t0);
        for (const [t, d, h] of p.notes) note(ch, h, t0 + T(t), T(d), 80);
        if (quatuor && /cello/i.test(p.nom) && octaveBasse) { const c2 = prochain(); prog(c2, 43, 82, 80, t0); for (const [t, d, h] of p.notes) note(c2, h - 12, t0 + T(t), T(d), 72); }
        if (quatuor && i === 0) { const c3 = prochain(); prog(c3, 60, 64, 44, t0); /* cors : notes longues du 1er violon */ for (const [t, d, h] of p.notes) if (d >= 1.5) note(c3, h - 12, t0 + T(t), T(d), 60); }
        if (/organ|continuo/i.test(p.nom)) { const c2 = prochain(); prog(c2, 43, 80, 70, t0); for (const [t, d, h] of p.notes) if (h < 60) note(c2, h - 12, t0 + T(t), T(d), 72); }
      });
      if (grelots) for (let q = 0; q < J.fin; q += 1.5) note(9, 83, t0 + T(q), T(.4), (q / 1.5) % 2 ? 40 : 56);
    }
    // ralenti au dernier passage
    if (k === nPasses - 1) { const deb = longPasse - 4; for (let s = 0; s <= 8; s++) ev.push({ t: t0 + T(deb + s * .5), type: "setTempo", microsecondsPerBeat: Math.round(60e6 / (bpm * (1 - s * .04))) }); }
    else ev.push({ t: t0 + T(longPasse), type: "setTempo", microsecondsPerBeat: Math.round(60e6 / bpm) });
    origine += longPasse + (satb ? 1 : 0);
  }
  const finT = T(origine) + TPB * 4;
  ev.sort((a, b) => a.t - b.t || (a.type === "noteOff" ? -1 : 1));
  const pistes = new Map(), glob = [];
  for (const e of ev) { if (e.type === "setTempo") { glob.push(e); continue; } if (!pistes.has(e.channel)) pistes.set(e.channel, []); pistes.get(e.channel).push(e); }
  glob.sort((a, b) => a.t - b.t); glob.push({ t: finT, type: "endOfTrack" });
  const delta = arr => { let p = 0; return arr.map(e => { const { t, ...r } = e; const o = { deltaTime: Math.max(0, t - p), ...r }; p = Math.max(p, t); return o; }); };
  const tracks = [delta(glob)];
  for (const [, arr] of [...pistes.entries()].sort((a, b) => a[0] - b[0])) { arr.sort((a, b) => a.t - b.t); arr.push({ t: arr[arr.length - 1].t, type: "endOfTrack" }); tracks.push(delta(arr)); }
  return writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: TPB }, tracks });
}
