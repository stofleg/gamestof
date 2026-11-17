// Fabrique de la playlist de Noël : chants du domaine public en plusieurs versions + pièces
// originales, rendus (GeneralUser GS), salle, compression douce, −18 LUFS, AAC.
// Usage : node fabrique.mjs [--essai N] [--seulement motif]
import * as fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { arrange, rendu } from "./moteur.mjs";
import { compose } from "./compose.mjs";
import { MORCEAUX as CH } from "./chants.mjs";

const args = process.argv.slice(2);
const essai = args.includes("--essai") ? +args[args.indexOf("--essai") + 1] : 0;
const seul = args.includes("--seulement") ? args[args.indexOf("--seulement") + 1] : null;
const CIBLE_MIN = 125;   // minutes de musique visées

// ------------------------------------------------------------ chants, en plusieurs versions
const DP = { vive: "James Lord Pierpont, 1857", nuit: "Franz Xaver Gruber, 1818", wish: "chant traditionnel anglais", deck: "chant traditionnel gallois", joie: "Lowell Mason d’après Haendel, 1839" };
const versions = [
  ["vive", "", {}],
  ["vive", "galop", { bpm: 150, sections: [
    { lead: "trompette", accomp: "galop", sabots: true, grelots: 2, double: "flute" },
    { lead: "cordes", accomp: "galop", sabots: true, grelots: 2, glock: true, second: "clarinette" },
    { lead: "cuivres", transpo: 2, accomp: "galop", grelots: 2, timbales: true, double: "cordesHaut", depuis: 64 }] }],
  ["vive", "boîte à musique", { bpm: 104, festif: false, sections: [
    { lead: "boite", accomp: "boite", nappe: false },
    { lead: "celesta", accomp: "boite", second: "flute", nappeVel: 40, depuis: 64 }] }],
  ["nuit", "", {}],
  ["nuit", "chœur et orgue", { bpm: 140, sections: [
    { lead: "cordesLentes", oct: 12, accomp: "choral", choeur: true },
    { lead: "cuivres", transpo: 1, accomp: "choral", choeur: true, cloches: true, timbales: true }] }],
  ["nuit", "boîte à musique", { bpm: 138, sections: [
    { lead: "boite", oct: 12, harpe: true, arpRapide: true, nappe: false },
    { lead: "glockSolo", oct: 12, harpe: true, arpRapide: true, second: "flute", nappeVel: 40 }] }],
  ["wish", "", {}],
  ["wish", "valse", { bpm: 150, festif: false, sections: [
    { lead: "clarinetteSolo", accomp: "valse" },
    { lead: "fluteSolo", oct: 12, accomp: "valse", second: "clarinette", glock: true },
    { lead: "cordes", oct: 12, accomp: "valse", harpe: true, cor: true },
    { lead: "celesta", oct: 12, accomp: "valse", second: "flute" },
    { lead: "cuivres", transpo: 2, accomp: "valse", choeur: true, timbales: true, double: "cordesHaut" },
    { lead: "cuivres", transpo: 2, accomp: "valse", choeur: true, timbales: true, glock: true, double: "cordesHaut" }] }],
  ["deck", "", {}],
  ["deck", "marche", { bpm: 112, sections: [
    { lead: "trompette", accomp: "marche", caisse: true },
    { lead: "cordes", oct: 12, accomp: "marche", caisse: true, second: "cor", glock: true },
    { lead: "cuivres", transpo: 2, accomp: "marche", caisse: true, timbales: true, double: "cordesHaut" }] }],
  ["deck", "boîte à musique", { bpm: 96, festif: false, sections: [
    { lead: "boite", oct: 12, accomp: "boite", nappe: false },
    { lead: "vibra", oct: 12, accomp: "boite", second: "flute", nappeVel: 40 }] }],
  ["joie", "", {}],
  ["joie", "chœur et orgue", { bpm: 88, sections: [
    { lead: "cordesLentes", accomp: "choral", choeur: true },
    { lead: "cuivres", transpo: 1, accomp: "choral", choeur: true, cloches: true, timbales: true }] }],
];

// ------------------------------------------------------------ pièces originales
const STYLES = {
  valse: { metre: 3, bpm: [150, 172], passes: [
    { lead: "celesta", oct: 12, accomp: "valse", nappeVel: 46 },
    { lead: "fluteSolo", oct: 12, accomp: "valse", second: "clarinette", glock: true },
    { lead: "cordes", oct: 12, accomp: "valse", harpe: true, cor: true },
    { lead: "cuivres", transpo: 2, accomp: "valse", choeur: true, timbales: true, glock: true, double: "cordesHaut" }] },
  berceuse: { metre: 6, unite: .5, bpm: [128, 146], lent: true, passes: [
    { lead: "celesta", oct: 12, harpe: true, arpRapide: true },
    { lead: "fluteSolo", oct: 12, harpe: true, arpRapide: true, second: "cor" },
    { lead: "cordesLentes", oct: 12, harpe: true, arpRapide: true, choeur: true, cloches: true }] },
  galop: { metre: 4, bpm: [150, 166], festif: true, passes: [
    { lead: "trompette", accomp: "galop", sabots: true, grelots: 2 },
    { lead: "cordes", oct: 12, accomp: "galop", sabots: true, grelots: 2, double: "flute", glock: true },
    { lead: "cuivres", transpo: 2, accomp: "galop", grelots: 2, timbales: true, double: "cordesHaut" }] },
  marche: { metre: 4, bpm: [108, 120], passes: [
    { lead: "clarinetteSolo", accomp: "marche", caisse: true },
    { lead: "trompette", accomp: "marche", caisse: true, glock: true, second: "cor" },
    { lead: "cuivres", transpo: 2, accomp: "marche", caisse: true, timbales: true, double: "cordesHaut" }] },
  boite: { metre: 3, bpm: [88, 104], passes: [
    { lead: "boite", oct: 12, accomp: "boite", nappe: false },
    { lead: "celesta", oct: 12, accomp: "boite", second: "flute", nappeVel: 40 },
    { lead: "harpeSolo", oct: 12, accomp: "tenue", nappeVel: 40 }] },
  choral: { metre: 4, bpm: [72, 84], lent: true, passes: [
    { lead: "cordesLentes", accomp: "choral" },
    { lead: "fluteSolo", oct: 12, accomp: "choral", choeur: true },
    { lead: "cuivres", transpo: 1, accomp: "choral", choeur: true, cloches: true, timbales: true }] },
  promenade: { metre: 4, bpm: [100, 112], festif: true, passes: [
    { lead: "fluteSolo", oct: 12, accomp: "pizz", grelots: 1 },
    { lead: "hautbois", accomp: "pizz", second: "clarinette", harpe: true, grelots: 1 },
    { lead: "cordes", oct: 12, accomp: "pizz", harpe: true, cor: true, glock: true, grelots: 2, transpo: 2 }] },
  polka: { metre: 4, bpm: [168, 184], passes: [
    { lead: "clarinetteSolo", accomp: "marche", staccato: true },
    { lead: "fluteSolo", oct: 12, accomp: "marche", second: "basson", secondOct: true, glock: true, triangle: true },
    { lead: "trompette", transpo: 2, accomp: "marche", caisse: true, double: "flute" }] },
};
const TITRES = [
  ["La valse des flocons", "valse"], ["Berceuse pour un petit renne", "berceuse"], ["Le galop du traîneau", "galop"], ["La marche des soldats de bois", "marche"],
  ["Boule à neige", "boite"], ["Lumières de l’Avent", "choral"], ["Promenade au marché de Noël", "promenade"], ["La polka des lutins", "polka"],
  ["Patins sur le lac gelé", "valse"], ["Veillée au coin du feu", "berceuse"], ["Sur la route du pôle Nord", "galop"], ["La parade des jouets", "marche"],
  ["Le grenier du père Noël", "boite"], ["Cloches de minuit", "choral"], ["Chocolat chaud", "promenade"], ["Les biscuits de la mère Noël", "polka"],
  ["Valse des guirlandes", "valse"], ["Étoile du berger", "berceuse"], ["Les rennes s’envolent", "galop"], ["Casse-noisettes en bois", "marche"],
  ["La fabrique de jouets", "boite"], ["Nuit étoilée", "choral"], ["Raquettes dans la forêt", "promenade"], ["Danse des sucres d’orge", "polka"],
  ["Le bal des sapins", "valse"], ["Rêverie de décembre", "berceuse"], ["La tournée de minuit", "galop"], ["Le défilé des pingouins", "marche"],
  ["Lettre au père Noël", "boite"], ["Aurore boréale", "choral"], ["Le village sous la neige", "promenade"], ["Polka des pains d’épices", "polka"],
  ["Valse de l’ours polaire", "valse"], ["Le dernier flocon", "berceuse"], ["Grelots dans la vallée", "galop"], ["Le carillon du village", "marche"],
  ["Petit sapin", "boite"], ["Conte d’hiver", "choral"], ["Sous le gui", "promenade"], ["La ronde des clémentines", "polka"],
];
const MINEURS = new Set(["Conte d’hiver", "Nuit étoilée", "Le dernier flocon", "Aurore boréale"]);
const TONS = [0, 2, 3, 5, 7, 8, 9, 10];   // C D Eb F G Ab A Bb

const slug = t => t.replace(/œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const duree = P => { const b = P.melodie.trim().split(/\s+/).reduce((a, x) => a + +x.split(":")[1], 0); return b * P.sections.length * (P.unite || 1) * 60 / P.bpm; };

const liste = [];
let num = 0, total = 0;
const ajoute = async (P, graine, credit) => {
  num++;
  const f = `${String(num).padStart(2, "0")}-${slug(P.titre)}`;
  if (seul && !f.includes(seul)) return;
  try { await fs.access(`sortie/${f}.m4a`); const d0 = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `sortie/${f}.m4a`]).toString(); total += d0; liste.push({ f: `noel/${f}.m4a`, titre: P.titre, credit }); console.log(f, "déjà fait", Math.round(d0), "s"); return; } catch {}
  const bytes = arrange(P, graine);
  await fs.writeFile(`rendus/${f}.mid`, new Uint8Array(bytes));
  const d = await rendu(bytes, `rendus/${f}.wav`);
  total += d;
  // salle (réverbération), compression douce, normalisation linéaire à −18 LUFS, AAC 64 kbit/s
  const PRE = "[0:a]asplit=2[d][w];[w][1:a]afir=gtype=none[r];[r]volume=0.18[rv];[d][rv]amix=inputs=2:weights=1 1:normalize=0,acompressor=threshold=0.1:ratio=2:attack=80:release=800";
  const mes = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", `rendus/${f}.wav`, "-i", "ir.wav", "-filter_complex", `${PRE},loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const j = JSON.parse(mes.slice(mes.lastIndexOf("{"), mes.lastIndexOf("}") + 1));
  const ln = `loudnorm=I=-18:TP=-1.5:LRA=11:linear=true:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}`;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", `rendus/${f}.wav`, "-i", "ir.wav", "-filter_complex", `${PRE},${ln}`, "-ar", "44100", "-c:a", "aac", "-b:a", "64k", `sortie/${f}.m4a`]);
  await fs.rm(`rendus/${f}.wav`);
  liste.push({ f: `noel/${f}.m4a`, titre: P.titre, credit });
  console.log(f, Math.round(d), "s", "total", (total / 60).toFixed(1), "min");
};
await fs.mkdir("rendus", { recursive: true }); await fs.mkdir("sortie", { recursive: true });

for (const [cle, nomV, opt] of versions) {
  const B = CH[cle];
  const P = { ...B, ...opt, titre: nomV ? `${B.titre} (${nomV})` : B.titre, sections: opt.sections || B.sections };
  await ajoute(P, num + 101, `${DP[cle]} — domaine public · arrangement Topissimo`);
  if (essai && num >= essai) break;
}
let k = 0;
while ((!essai || num < essai) && (total / 60 < CIBLE_MIN || seul) && k < TITRES.length) {
  const [titre, style] = TITRES[k++];
  const St = STYLES[style], g = 1000 + k * 7919;
  let s = g; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const tonique = TONS[Math.floor(r() * TONS.length)];
  const c = compose(g, { metre: St.metre, tonique, mineur: MINEURS.has(titre), lent: !!St.lent });
  const bpm = Math.round(St.bpm[0] + r() * (St.bpm[1] - St.bpm[0]));
  const P = { titre, bpm, metre: St.metre, unite: St.unite, festif: !!St.festif, melodie: c.melodie, accords: c.accords, sections: St.passes };
  // ajuste le nombre de passages pour viser ~3 min (2 à 4 passages)
  const passe = duree({ ...P, sections: [0] });
  const n = Math.max(2, Math.min(St.passes.length + 1, Math.round(190 / passe)));
  P.sections = Array.from({ length: n }, (_, i) => i < St.passes.length ? St.passes[i] : { ...St.passes[St.passes.length - 1], depuis: 16 * St.metre, ralenti: true });
  await ajoute(P, g, "composition originale Topissimo");
}
await fs.writeFile("rendus/liste.json", JSON.stringify(liste, null, 1));
console.log("morceaux", liste.length, "durée", (total / 60).toFixed(1), "min");
