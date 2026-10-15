//  Génère un lot de grilles du jour et l'écrit dans
//  topissimo/grilledujour/grilles.json.
//
//  La recherche coûte environ trois minutes par grille : la règle « un mot ↔ un
//  emplacement » ne laisse passer que 6 % des positions à trois scrabbles ou
//  plus. C'est pourquoi les grilles sont précalculées plutôt que cherchées à la
//  demande ; une grille par jour ne justifie pas de faire attendre le joueur.
//
//  Usage :  node outils/genere-grilles.mjs [nombre] [fichier-sortie] [--double-appui]
//
//  Avec --double-appui, la grille contient au moins deux scrabbles traversant
//  chacun DEUX lettres déjà posées (donc des mots de neuf lettres). La recherche
//  part alors des mots et non du chevalet : on énumère les emplacements de la
//  forme voulue, et le chevalet se déduit de ceux qu'on retient. Environ sept
//  secondes par grille.
//  Pour aller plus vite, lancer plusieurs processus sur des fichiers séparés
//  puis les fusionner avec --fusion :
//      node outils/genere-grilles.mjs 8 lot-1.json &
//      node outils/genere-grilles.mjs 8 lot-2.json &
//      node outils/genere-grilles.mjs --fusion lot-*.json
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Dictionary } from "../topissimo/scrabble/dictionary.js";
import { chercheGrille, chercheGrilleCiblee, appuisDe }
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

const cible = args.includes("--double-appui");
const libres = args.filter(a => !a.startsWith("--"));
const combien = parseInt(libres[0] || "10", 10);
const fichier = libres[1] ? path.resolve(libres[1]) : SORTIE;
const dict = chargeDico();
const grilles = [];
const t0 = Date.now();
for (let i = 0; i < combien; i++) {
  const t1 = Date.now();
  const g = cible
    ? chercheGrilleCiblee(dict, { appuis: 2, minCiblees: 2, maxParties: 20000 })
    : chercheGrille(dict, { maxParties: 20000 });
  if (!g) { console.error(`  ${i + 1}/${combien} : échec`); continue; }
  grilles.push({
    plateau: serialise(g.board),
    rack: g.rack.join(""),
    coup: g.coup,
    ancres: g.ancres,
    ...(cible ? { forme: "double-appui" } : {}),
    scrabbles: g.scrabbles.map(s => ({ m: s.word, l: s.row, c: s.col, d: s.dir,
                                       p: s.score, a: appuisDe(g.board, s) })),
  });
  console.error(`  ${i + 1}/${combien} en ${((Date.now() - t1) / 1000).toFixed(0)} s · `
    + `${g.rack.join("")} · ${g.scrabbles.length} scrabbles`);
  fs.writeFileSync(fichier, JSON.stringify({ genere: new Date().toISOString(), grilles }));
}
console.error(`\n${grilles.length} grilles en ${((Date.now() - t0) / 60000).toFixed(0)} min → ${fichier}`);
