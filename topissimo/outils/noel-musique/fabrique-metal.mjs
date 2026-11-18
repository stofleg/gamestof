// Playlist « No Hell ! » : chaque chant de Noël en deux styles metal (trois pour Vive le vent),
// rendu (GeneralUser GS), traitement (traite-metal.mjs) et écriture de scrabble/nohell-morceaux.js.
import * as fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fabriqueMetal } from "./mix-metal.mjs";
import { MORCEAUX } from "./chants.mjs";
const DEST = "/home/user/gamestof/topissimo/scrabble";
const pop = JSON.parse(await fs.readFile("populaires.json", "utf8"));
const NOM = { heavy: "heavy metal", thrash: "thrash", ballade: "power ballade", symphonique: "metal symphonique" };
const DOUX = ["Es zieht", "In einem Thal", "Du lieber", "Engellied"], VIFS = ["Christmas Hornpipe", "Snow-Flake", "Star of the East", "Frost and Snow", "Christmas Eve", "A Merry Christmas", "The Holly Tree"];
const liste = [
  [MORCEAUX.vive, ["heavy", "thrash", "symphonique"]], [MORCEAUX.nuit, ["ballade", "symphonique"]], [MORCEAUX.wish, ["heavy", "thrash"]],
  [MORCEAUX.deck, ["thrash", "symphonique"]], [MORCEAUX.joie, ["symphonique", "heavy"]],
  ...pop.map(p => [p, DOUX.some(d => p.titre.startsWith(d)) ? ["ballade", "heavy"] : VIFS.some(d => p.titre.startsWith(d)) ? ["thrash", "heavy"] : ["heavy", "symphonique"]]),
];
const slug = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
await fs.mkdir("sortie-metal", { recursive: true });
// trois morceaux à la fois (rendu piste par piste et mixage : environ 1 min 40 par morceau)
const travaux = [];
let k = 0;
for (const [P, styles] of liste) for (const st of styles) { k++; travaux.push({ P, st, k, f: `${String(k).padStart(2, "0")}-${slug(P.titre)}-${st}.m4a` }); }
const out = new Array(travaux.length); let total = 0, suivant = 0;
async function ouvrier(id) {
  while (suivant < travaux.length) {
    const { P, st, k, f } = travaux[suivant++];
    if (!(await fs.stat(`sortie-metal/${f}`).catch(() => null))) await fabriqueMetal(P, st, 1000 + k * 17, `sortie-metal/${f}`, "B", `tmp-mix-${id}`);
    const d = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `sortie-metal/${f}`]).toString();
    total += d;
    out[k - 1] = { f: `nohell/${f}`, titre: `${P.titre} (${NOM[st]})`, credit: `${P.credit} — domaine public · arrangement metal Topissimo`, duree: Math.round(d), cat: st };
    console.log(k, f, Math.round(d), "s");
  }
}
await Promise.all([1, 2, 3].map(ouvrier));
await fs.rm(`${DEST}/musique/nohell`, { recursive: true, force: true });
await fs.mkdir(`${DEST}/musique/nohell`, { recursive: true });
for (const m of out) await fs.copyFile(`sortie-metal/${m.f.slice(7)}`, `${DEST}/musique/${m.f}`);
await fs.writeFile(`${DEST}/nohell-morceaux.js`, `// Playlist « No Hell ! » (${out.length} morceaux, ${Math.round(total / 60)} min) : chants de Noël du domaine public
// réarrangés en metal, produite par topissimo/outils/noel-musique (metal.mjs, fabrique-metal.mjs).
export const MORCEAUX_NOHELL = ${JSON.stringify(out, null, 1)};
`);
console.log(out.length, "morceaux", (total / 60).toFixed(1), "min");
