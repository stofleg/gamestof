// Deuxième série : chants populaires de Noël (corpus music21, harmonisés) et classiques
// (chorals de Noël de Bach, Haydn et Mozart « La Chasse »).
import * as fs from "node:fs/promises";
import { arrange, rendu } from "./moteur.mjs";
import { partitionMidi } from "./partition.mjs";
import { traite } from "./traite.mjs";
const POP = JSON.parse(await fs.readFile("populaires.json", "utf8"));
const S = {
  valse: [{ lead: "celesta", oct: 12, accomp: "valse" }, { lead: "fluteSolo", oct: 12, accomp: "valse", second: "clarinette", glock: true }, { lead: "cordes", oct: 12, accomp: "valse", harpe: true, cor: true }, { lead: "cuivres", transpo: 2, accomp: "valse", choeur: true, timbales: true, double: "cordesHaut" }],
  boite: [{ lead: "boite", oct: 12, accomp: "boite", nappe: false }, { lead: "celesta", oct: 12, accomp: "boite", second: "flute", nappeVel: 40 }, { lead: "harpeSolo", oct: 12, accomp: "tenue", nappeVel: 40 }, { lead: "cordesLentes", oct: 12, accomp: "tenue", harpe: true, choeur: true }],
  promenade: [{ lead: "fluteSolo", oct: 12, accomp: "pizz", grelots: 1 }, { lead: "hautbois", accomp: "pizz", second: "clarinette", harpe: true, grelots: 1 }, { lead: "cordes", oct: 12, accomp: "pizz", harpe: true, cor: true, glock: true, grelots: 2, transpo: 2 }, { lead: "celesta", oct: 12, transpo: 2, accomp: "pizz", second: "flute", grelots: 1 }],
  marche: [{ lead: "clarinetteSolo", accomp: "marche", caisse: true }, { lead: "trompette", accomp: "marche", caisse: true, glock: true, second: "cor" }, { lead: "cuivres", transpo: 2, accomp: "marche", caisse: true, timbales: true, double: "cordesHaut" }, { lead: "fluteSolo", oct: 12, transpo: 2, accomp: "marche", second: "clarinette", triangle: true }],
  galop: [{ lead: "fluteSolo", oct: 12, accomp: "galop", sabots: true, grelots: 2 }, { lead: "cordes", oct: 12, accomp: "galop", sabots: true, grelots: 2, double: "flute", glock: true }, { lead: "trompette", accomp: "galop", grelots: 2, second: "clarinette" }, { lead: "cuivres", transpo: 2, accomp: "galop", grelots: 2, timbales: true, double: "cordesHaut" }],
  gigue: [{ lead: "fluteSolo", oct: 12, accomp: "gigue", grelots: 1 }, { lead: "hautbois", accomp: "gigue", second: "clarinette", glock: true }, { lead: "cordes", oct: 12, accomp: "gigue", harpe: true, cor: true, grelots: 1 }, { lead: "celesta", oct: 12, transpo: 2, accomp: "gigue", second: "flute", grelots: 1 }],
  berceuse: [{ lead: "celesta", oct: 12, harpe: true, arpRapide: true }, { lead: "fluteSolo", oct: 12, harpe: true, arpRapide: true, second: "cor" }, { lead: "cordesLentes", oct: 12, harpe: true, arpRapide: true, choeur: true, cloches: true }, { lead: "boite", oct: 12, harpe: true, arpRapide: true, nappeVel: 40 }],
  choral: [{ lead: "cordesLentes", accomp: "choral" }, { lead: "fluteSolo", oct: 12, accomp: "choral", choeur: true }, { lead: "cuivres", transpo: 1, accomp: "choral", choeur: true, cloches: true, timbales: true }],
};
// style et tempo (unités par minute) par chant
const CHOIX = {
  "Mon beau sapin (O Tannenbaum)": ["valse", 132], "Glocke, du klingst fröhlich": ["promenade", 100], "Du lieber, frommer, heil’ger Christ": ["boite", 84],
  "Es zieht ein stiller Engel": ["berceuse", 168], "Laufet, ihr Hirten": ["valse", 150], "Es sangen drei Engel": ["boite", 96],
  "Vom Himmel hoch, o Engel, kommt": ["valse", 138], "Ein Kind geboren zu Bethlehem (Puer natus)": ["choral", 108], "Auf, auf, ihr Hirten": ["valse", 156],
  "In einem Thal bei armen Hirten": ["promenade", 92], "Engellied zu Weihnachten": ["marche", 104], "The Twelve Days of Christmas": ["marche", 110],
  "Christmas Day in the Morning": ["gigue", 270], "Christmas Eve": ["galop", 168], "A Merry Christmas": ["gigue", 300], "The Holly Tree": ["gigue", 290],
  "Frost and Snow": ["galop", 160], "Christmas Hornpipe": ["promenade", 104], "Snow-Flake Hornpipe": ["galop", 150], "Star of the East Hornpipe": ["galop", 150],
};
const slug = t => t.replace(/œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const liste = []; let num = 60, total = 0;
const sortie = async (bytes, titre, credit) => {
  num++;
  const f = `${num}-${slug(titre)}`.slice(0, 60);
  try { await fs.access(`sortie/${f}.m4a`); liste.push({ f: `noel/${f}.m4a`, titre, credit }); console.log(f, "déjà fait"); return; } catch {}
  const d = await rendu(bytes, `rendus/${f}.wav`); total += d;
  await traite(`rendus/${f}.wav`, `sortie/${f}.m4a`);
  liste.push({ f: `noel/${f}.m4a`, titre, credit });
  console.log(f, Math.round(d), "s · total", (total / 60).toFixed(1), "min");
};
await fs.mkdir("rendus", { recursive: true }); await fs.mkdir("sortie", { recursive: true });
let g = 500;
for (const p of POP) {
  const [style, bpm] = CHOIX[p.titre] || ["promenade", 100];
  const unites = p.melodie.trim().split(/\s+/).reduce((a, x) => a + +x.split(":")[1], 0);
  const passe = unites * 60 / bpm;
  const n = Math.max(2, Math.min(S[style].length, Math.round(150 / passe)));
  const P = { titre: p.titre, bpm, metre: p.metre, unite: p.unite, levee: p.levee, festif: ["galop", "promenade"].includes(style), melodie: p.melodie, accords: p.accords, sections: S[style].slice(0, n) };
  await sortie(arrange(P, g++), p.titre, `${p.credit} — domaine public · partition : corpus music21 · arrangement Topissimo`);
}
// classiques
const CL = [
  ["bwv368", 84, 3, false, "Bach — In dulci jubilo (choral BWV 368)"],
  ["bwv314", 72, 3, false, "Bach — Gelobet seist du, Jesu Christ (choral BWV 314)"],
  ["bwv375", 74, 3, false, "Bach — Lobt Gott, ihr Christen allzugleich (choral BWV 375)"],
  ["bwv65.2", 80, 3, false, "Bach — Ein Kind geborn zu Bethlehem (cantate BWV 65)"],
  ["bwv248.12-2", 66, 3, false, "Bach — Oratorio de Noël : « Brich an, o schönes Morgenlicht »"],
  ["bwv40.8", 74, 3, false, "Bach — Freuet euch, ihr Christen alle (cantate BWV 40)"],
  ["bwv248.9-1", 76, 2, false, "Bach — Oratorio de Noël : « Ach mein herzliebes Jesulein » (sur Vom Himmel hoch)"],
  ["bwv248.23-2", 104, 2, false, "Bach — Oratorio de Noël : « Wir singen dir in deinem Heer »"],
  ["bwv248.42-4", 104, 1, false, "Bach — Oratorio de Noël : choral de la IVe partie"],
  ["bwv248.64-6", 84, 1, false, "Bach — Oratorio de Noël : choral final « Nun seid ihr wohl gerochen »"],
  ["haydn_opus1no1_movement1", 150, 1, true, "Haydn — Quatuor « La Chasse » op. 1 n° 1 : Presto (version de Noël)"],
  ["haydn_opus1no1_movement5", 132, 1, true, "Haydn — Quatuor op. 1 n° 1 : Presto final (version de Noël)"],
  ["mozart_k458_movement1", 126, 1, true, "Mozart — Quatuor « La Chasse » K. 458 : Allegro vivace assai (version de Noël)"],
];
for (const [f, bpm, passes, grelots, titre] of CL) {
  const J = JSON.parse(await fs.readFile(`chorals/${f}.json`, "utf8"));
  // les partitions orchestrales courtes sont jouées deux fois
  const bytes = partitionMidi(J, { bpm, passages: passes, grelots, repeter: passes });
  await sortie(bytes, titre, "domaine public · partition : corpus music21 · orchestration Topissimo (GeneralUser GS)");
}
await fs.writeFile("rendus/liste2.json", JSON.stringify(liste, null, 1));
console.log("série 2 :", liste.length, "morceaux,", (total / 60).toFixed(1), "min");
