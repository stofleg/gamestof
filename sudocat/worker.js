/* Sudocat — génération des grilles en tâche de fond (une grille Difficile + en 12 × 12
   peut demander quelques secondes : la page reste fluide pendant ce temps). */
importScripts('moteur.js?v=5');

self.onmessage = (e) => {
  const { id, size, level, seed } = e.data;
  try {
    self.postMessage({ id, puzzle: generatePuzzle({ size, level, seed }) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
