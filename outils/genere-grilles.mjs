//  Génère un lot de grilles du jour et l'écrit dans
//  topissimo/grilledujour/grilles.json.
//
//  La recherche coûte environ trois minutes par grille : la règle « un mot ↔ un
//  emplacement » ne laisse passer que 6 % des positions à trois scrabbles ou
//  plus. C'est pourquoi les grilles sont précalculées plutôt que cherchées à la
//  demande ; une grille par jour ne justifie pas de faire attendre le joueur.
//
//  Usage :  node outils/genere-grilles.mjs [nombre] [sortie] [--forme=X] [--combien=N]
//
//  --forme impose la FORME des coups à trouver. La recherche part alors des mots
//  et non du chevalet : on énumère les emplacements de la forme voulue, et le
//  chevalet se déduit de ceux qu'on retient. --combien dit en combien
//  d'exemplaires la forme doit apparaître dans la grille (1 par défaut).
//
//  Formes et coût mesuré (1 exemplaire sauf mention) :
//     appui2 / double appui ............   3 s   (2 exemplaires : 3 s)
//     appui3 / triple appui ...........    8 s   (2 exemplaires : 8 s)
//     appui4 / quadruple appui ........   rare, prévoir plusieurs minutes
//     rallonge ........................    2 s
//     collante3 .......................   52 s
//     collante4, collante5 ............   rien en 2 min — forme rare
//     rallonge2 (double rallonge) .....   rien en 2 min — forme rare
//  Les formes rares ne sont pas un obstacle : les grilles étant précalculées,
//  une forme qui demande dix minutes reste utilisable si elle ne sert qu'une
//  fois par mois. Lancer alors en tâche de fond.
//  Pour aller plus vite, lancer plusieurs processus sur des fichiers séparés
//  puis les fusionner avec --fusion :
//      node outils/genere-grilles.mjs 8 lot-1.json &
//      node outils/genere-grilles.mjs 8 lot-2.json &
//      node outils/genere-grilles.mjs --fusion lot-*.json
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Dictionary } from "../topissimo/scrabble/dictionary.js";
import { chercheGrille, chercheGrilleCiblee, appuisDe, contactsDe, rallongesDe }
  from "../topissimo/scrabble/grille-du-jour.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, "..");
const SORTIE = path.join(RACINE, "topissimo/grilledujour/grilles.json");

/** Plateau compact : 15 chaînes, point = case vide, minuscule = joker posé. */
function serialise(board) {
  return board.map(r => r.map(c => !c ? "." : (c.isBlank ? c.letter.toLowerCase() : c.letter)).join(""));
}

function chargeDico() {
  const d = new Dictionary();
  d.words = fs.readFileSync(path.join(RACINE, "topissimo/scrabble/ods9.txt"), "utf8")
              .split("\n").filter(Boolean);
  for (const w of d.words) {
    if (!d.byLen.has(w.length)) d.byLen.set(w.length, []);
    d.byLen.get(w.length).push(w);
  }
  d.loaded = true;
  return d;
}

const args = process.argv.slice(2);

if (args[0] === "--fusion") {
  const lots = args.slice(1).flatMap(f => JSON.parse(fs.readFileSync(f, "utf8")).grilles);
  const vues = new Set(), gardees = [];
  for (const g of lots) {
    const cle = g.rack + "|" + g.plateau.join("");
    if (vues.has(cle)) continue;
    vues.add(cle); gardees.push(g);
  }
  fs.writeFileSync(SORTIE, JSON.stringify({ genere: new Date().toISOString(), grilles: gardees }));
  console.log(`${gardees.length} grilles écrites dans ${SORTIE}`);
  process.exit(0);
}

const FORMES = {
  appui2:    { appuis: 2 },
  appui3:    { appuis: 3 },
  appui4:    { appuis: 4 },
  collante3: { contacts: { min: 3 } },
  collante4: { contacts: { min: 4 } },
  collante5: { contacts: { min: 5 } },
  rallonge:  { rallonges: { min: 1 } },
  rallonge2: { rallonges: { min: 2 } },
  rallonge3: { rallonges: { min: 3 } },
};
const argForme = args.find(a => a.startsWith("--forme="));
const nomForme = argForme ? argForme.slice(8) : null;
if (nomForme && !FORMES[nomForme]) {
  console.error(`Forme inconnue : ${nomForme}\nFormes : ${Object.keys(FORMES).join(", ")}`);
  process.exit(1);
}
const argCombien = args.find(a => a.startsWith("--combien="));
const minCiblees = argCombien ? parseInt(argCombien.slice(10), 10) : 1;
const libres = args.filter(a => !a.startsWith("--"));
const combien = parseInt(libres[0] || "10", 10);
const fichier = libres[1] ? path.resolve(libres[1]) : SORTIE;
const dict = chargeDico();
const grilles = [];
const t0 = Date.now();
for (let i = 0; i < combien; i++) {
  const t1 = Date.now();
  const g = nomForme
    ? chercheGrilleCiblee(dict, { ...FORMES[nomForme], minCiblees, maxParties: 100000 })
    : chercheGrille(dict, { maxParties: 20000 });
  if (!g) { console.error(`  ${i + 1}/${combien} : échec`); continue; }
  grilles.push({
    plateau: serialise(g.board),
    rack: g.rack.join(""),
    coup: g.coup,
    ancres: g.ancres,
    ...(nomForme ? { forme: nomForme } : {}),
    scrabbles: g.scrabbles.map(s => ({ m: s.word, l: s.row, c: s.col, d: s.dir,
      p: s.score, a: appuisDe(g.board, s), x: contactsDe(g.board, s),
      r: rallongesDe(g.board, s) })),
  });
  console.error(`  ${i + 1}/${combien} en ${((Date.now() - t1) / 1000).toFixed(0)} s · `
    + `${g.rack.join("")} · ${g.scrabbles.length} scrabbles`);
  fs.writeFileSync(fichier, JSON.stringify({ genere: new Date().toISOString(), grilles }));
}
console.error(`\n${grilles.length} grilles en ${((Date.now() - t0) / 60000).toFixed(0)} min → ${fichier}`);
