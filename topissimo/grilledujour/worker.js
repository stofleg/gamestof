//  Worker de la grille du jour : il ne sert plus qu'à porter le dictionnaire,
//  pour distinguer « ce mot n'existe pas » de « ce mot existe mais ne passe pas
//  ici ». Les grilles, elles, sont précalculées (outils/genere-grilles.mjs).
import { Dictionary } from "../scrabble/dictionary.js?v=444";

let dict = null;

self.onmessage = async (e) => {
  const { type, mot } = e.data || {};
  try {
    if (type === "init") {
      dict = await new Dictionary().load("../scrabble/ods9.txt");
      self.postMessage({ type: "pret", mots: dict.words.length });
      return;
    }
    if (type === "verifie") {
      self.postMessage({ type: "verifie", mot, connu: !!dict && dict.has(mot) });
      return;
    }
  } catch (err) {
    self.postMessage({ type: "erreur", message: String(err && err.message || err) });
  }
};
