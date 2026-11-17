// Pièces pour piano (MIDI Mutopia) : piano de concert, tempo fixé, réverbération, puis chaîne commune.
import * as fs from "node:fs/promises";
import midiFile from "midi-file";
import { rendu } from "./moteur.mjs";
import { traite } from "./traite.mjs";
const U = "/root/.claude/uploads/8236a884-4c67-55e4-a123-b8ecc0da8dd2";
const L = [
  ["1fd2b94b-Tschaikowsky-op37.1.mid", 72, "94-tchaikovski-saisons-janvier-au-coin-du-feu", "Tchaïkovski — Les Saisons : Janvier, « Au coin du feu »"],
  ["d99bf9a2-Tschaikowsky-op37.2.mid", 120, "95-tchaikovski-saisons-fevrier-carnaval", "Tchaïkovski — Les Saisons : Février, « Carnaval »"],
  ["08a289b3-Tschaikowsky-op37.8.mid", 176, "96-tchaikovski-saisons-aout-la-moisson", "Tchaïkovski — Les Saisons : Août, « La Moisson »"],
];
const liste = [];
for (const [src, bpm, f, titre] of L) {
  const m = midiFile.parseMidi(await fs.readFile(`${U}/${src}`));
  const canaux = new Set(); for (const tr of m.tracks) for (const e of tr) if (e.channel != null) canaux.add(e.channel);
  m.tracks = m.tracks.map(tr => tr.filter(e => e.type !== "setTempo" && e.type !== "programChange"));
  const tete = [{ deltaTime: 0, type: "setTempo", microsecondsPerBeat: Math.round(60e6 / bpm) }];
  for (const c of canaux) tete.push({ deltaTime: 0, type: "programChange", channel: c, programNumber: 0 }, { deltaTime: 0, type: "controller", channel: c, controllerType: 91, value: 40 }, { deltaTime: 0, type: "controller", channel: c, controllerType: 10, value: 64 });
  m.tracks[0] = [...tete, ...m.tracks[0]];
  const bytes = midiFile.writeMidi(m);
  const d = await rendu(bytes, `rendus/${f}.wav`);
  await traite(`rendus/${f}.wav`, `sortie/${f}.m4a`);
  liste.push({ f: `noel/${f}.m4a`, titre, credit: "domaine public · partition : Mutopia Project · piano (GeneralUser GS)" });
  console.log(f, Math.round(d), "s");
}
await fs.writeFile("rendus/liste3.json", JSON.stringify(liste, null, 1));
