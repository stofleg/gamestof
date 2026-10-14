//  Worker de la grille du jour : il détient le dictionnaire et mène la recherche,
//  qui prend une dizaine de secondes. La page reste ainsi réactive et peut
//  afficher la progression.
import { Dictionary } from "../scrabble/dictionary.js?v=370";
import { chercheGrille } from "../scrabble/grille-du-jour.js?v=370";

let dict = null;

self.onmessage = async (e) => {
  const { type, mot } = e.data || {};
  try {
    if (type === "init") {
      dict = await new Dictionary().load("../scrabble/ods9.txt");
      self.postMessage({ type: "pret", mots: dict.words.length });
      return;
    }
    if (!dict) { self.postMessage({ type: "erreur", message: "dictionnaire non chargé" }); return; }
    if (type === "grille") {
      const g = chercheGrille(dict, {
        maxParties: 2000,
        onProgress: n => { if (n % 3 === 0) self.postMessage({ type: "avance", parties: n }); },
      });
      self.postMessage({ type: "grille", grille: g });
      return;
    }
    if (type === "verifie") {
      self.postMessage({ type: "verifie", mot, connu: dict.has(mot) });
      return;
    }
  } catch (err) {
    self.postMessage({ type: "erreur", message: String(err && err.message || err) });
  }
};
