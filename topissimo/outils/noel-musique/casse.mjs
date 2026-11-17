// Casse-Noisette (séquence MIDI orchestrale fournie) : rendu GeneralUser GS, cordes de synthèse → cordes.
import * as fs from "node:fs/promises";
import midiFile from "midi-file";
import { rendu } from "./moteur.mjs";
import { traite } from "./traite.mjs";
const src = "/root/.claude/uploads/8236a884-4c67-55e4-a123-b8ecc0da8dd2/34d824a0-Nutcracker-Suite.mid", f = "97-tchaikovski-casse-noisette-danse-des-mirlitons";
const m = midiFile.parseMidi(await fs.readFile(src));
for (const tr of m.tracks) for (const e of tr) {
  if (e.type === "programChange" && e.programNumber === 50) e.programNumber = 48;   // cordes d'orchestre
  if (e.type === "sysEx") e.data = [];
}
m.tracks = m.tracks.map(tr => tr.filter(e => !(e.type === "sysEx")));
const bytes = midiFile.writeMidi(m);
const d = await rendu(bytes, `rendus/${f}.wav`);
await traite(`rendus/${f}.wav`, `sortie/${f}.m4a`);
const l3 = JSON.parse(await fs.readFile("rendus/liste3.json", "utf8")).filter(x => !x.f.includes("casse-noisette"));
l3.push({ f: `noel/${f}.m4a`, titre: "Tchaïkovski — Casse-Noisette : Danse des mirlitons", credit: "domaine public · séquence MIDI orchestrale · GeneralUser GS" });
await fs.writeFile("rendus/liste3.json", JSON.stringify(l3, null, 1));
console.log(f, Math.round(d), "s");
