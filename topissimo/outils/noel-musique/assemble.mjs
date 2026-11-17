// Assemble la playlist : versions des chants connus, chants populaires, classiques et une
// sélection de pièces originales ; copie les fichiers et écrit noel-morceaux.js.
import * as fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
const DEST = "/home/user/gamestof/topissimo/scrabble";
const l1 = JSON.parse(await fs.readFile("rendus/liste.json", "utf8"));
const l2 = [...JSON.parse(await fs.readFile("rendus/liste2.json", "utf8")), ...JSON.parse(await fs.readFile("rendus/liste3.json", "utf8"))];
const ORIGINAUX = ["14-", "15-", "16-", "17-", "18-", "19-", "20-", "21-", "22-", "26-", "29-", "32-"];
const garde = l1.filter(m => m.credit !== "composition originale Topissimo" || ORIGINAUX.some(p => m.f.startsWith("noel/" + p)));
const tous = [...garde, ...l2];
await fs.rm(`${DEST}/musique/noel`, { recursive: true, force: true });
await fs.mkdir(`${DEST}/musique/noel`, { recursive: true });
let total = 0;
for (const m of tous) {
  const src = `sortie/${m.f.slice(5)}`;
  await fs.copyFile(src, `${DEST}/musique/${m.f}`);
  const d = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString();
  m.duree = Math.round(d); total += d;
  m.cat = m.credit.startsWith("composition originale") ? "original" : /^(Bach|Haydn|Mozart|Tchaïkovski) —/.test(m.titre) ? "classique" : "chant";
}
const js = `// Playlist de Noël de la grille cube (${tous.length} morceaux, ${Math.round(total / 60)} min), produite par
// topissimo/outils/noel-musique (arrangements Topissimo, banque de sons GeneralUser GS, −18 LUFS).
export const MORCEAUX_NOEL = ${JSON.stringify(tous.map(({ f, titre, credit, duree, cat }) => ({ f, titre, credit, duree, cat })), null, 1)};
`;
await fs.writeFile(`${DEST}/noel-morceaux.js`, js);
console.log(tous.length, "morceaux", (total / 60).toFixed(1), "min");
