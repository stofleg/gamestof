// Corelli, Concerto grosso op. 6 n° 8 « Concerto de Noël » (séquence MIDI de Paul Madrid, 1er mouvement) :
// cordes d'orchestre, continuo doublé au clavecin, fin de la piste de tempo ramenée à la dernière note.
import * as fs from "node:fs/promises";
import midiFile from "midi-file";
import { rendu } from "./moteur.mjs";
import { traite } from "./traite.mjs";
const src = "/root/.claude/uploads/8236a884-4c67-55e4-a123-b8ecc0da8dd2/0ec4476c-3897accg8n1.mid", f = "98-corelli-concerto-de-noel-vivace-grave";
const m = midiFile.parseMidi(await fs.readFile(src));
let finNotes = 0;
for (const tr of m.tracks) { let t = 0; for (const e of tr) { t += e.deltaTime; if (e.type === "noteOff" || (e.type === "noteOn" && e.velocity === 0)) finNotes = Math.max(finNotes, t); } }
// piste 0 : on coupe tout ce qui suit la dernière note
{ let t = 0; const out = []; for (const e of m.tracks[0]) { t += e.deltaTime; if (t > finNotes && e.type !== "endOfTrack") continue; out.push(e); } const fin = out[out.length - 1]; if (fin.type === "endOfTrack") { let s = 0; for (const e of out.slice(0, -1)) s += e.deltaTime; fin.deltaTime = Math.max(0, finNotes - s); } m.tracks[0] = out; }
const rempl = { 40: 48, 41: 48 };
for (const tr of m.tracks) for (const e of tr) { if (e.type === "programChange" && rempl[e.programNumber] != null) e.programNumber = rempl[e.programNumber]; }
// continuo doublé au clavecin (canal 7)
const cont = m.tracks.find(tr => tr.some(e => e.type === "trackName" && /continuo/i.test(e.text)));
const clav = [{ deltaTime: 0, type: "programChange", channel: 7, programNumber: 6 }, { deltaTime: 0, type: "controller", channel: 7, controllerType: 7, value: 70 }, { deltaTime: 0, type: "controller", channel: 7, controllerType: 10, value: 90 }];
for (const e of cont) if (e.type === "noteOn" || e.type === "noteOff") clav.push({ ...e, channel: 7, noteNumber: e.noteNumber + 12 }); else if (e.type !== "programChange" && e.type !== "trackName" && e.type !== "endOfTrack" && e.type !== "controller") clav.push({ ...e, channel: e.channel != null ? 7 : e.channel }); else clav.push({ deltaTime: e.deltaTime, type: "text", text: "" });
clav.push({ deltaTime: 0, type: "endOfTrack" });
m.tracks.push(clav); m.header.numTracks = m.tracks.length;
const d = await rendu(midiFile.writeMidi(m), `rendus/${f}.wav`);
await traite(`rendus/${f}.wav`, `sortie/${f}.m4a`);
const l3 = JSON.parse(await fs.readFile("rendus/liste3.json", "utf8")).filter(x => !x.f.includes("corelli"));
l3.push({ f: `noel/${f}.m4a`, titre: "Corelli — Concerto de Noël op. 6 n° 8 : Vivace – Grave", credit: "domaine public · séquence MIDI : Paul Madrid · cordes et clavecin (GeneralUser GS)" });
await fs.writeFile("rendus/liste3.json", JSON.stringify(l3, null, 1));
console.log(f, Math.round(d), "s");
