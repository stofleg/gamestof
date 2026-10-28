/* =========================================================================
   Sudocat — les 100 paliers de progression
   Chaque palier combine un niveau de difficulté (1 à 6, défini par le déroulé de
   résolution) et une taille de grille. Grille réussie sans faute : palier suivant ; avec 1 ou 2
   erreurs : même palier ; perdue ou abandonnée : palier précédent (cf. jeu.js).
   ========================================================================= */

const MAX_PALIER = 100;

// [niveau, taille], du plus simple au plus dur (24 étapes). Chaque niveau (1 à 6) ajoute un
// raisonnement (voir classifyProfile dans moteur.js : confinement, blocage, groupe de zones,
// groupe de 3-4 zones) ; la grille grandit à l'intérieur de chaque niveau. Difficile + commence
// en 9 × 9 (trop rare en dessous). Les 100 paliers se répartissent sur ces étapes.
const ETAPES = [
  [1, 5], [1, 6], [1, 7], [1, 8], [2, 6], [2, 7], [2, 8], [2, 9], [3, 7], [3, 8], [3, 9], [3, 10],
  [4, 7], [4, 8], [4, 9], [4, 10], [5, 8], [5, 9], [5, 10], [5, 11], [6, 9], [6, 10], [6, 11],
  [6, 12],
];

/** Réglages d'un palier : { palier, niveau (moteur), taille, nom }. */
function palierInfo(palier) {
  const p = Math.min(MAX_PALIER, Math.max(1, Math.floor(palier) || 1));
  const [niveau, taille] = ETAPES[Math.floor((p - 1) * ETAPES.length / MAX_PALIER)];
  return { palier: p, niveau, taille, nom: LEVELS[niveau].label };
}

// Anciens niveaux 1-6 → premier palier de ce niveau (pour la migration).
const PALIER_DES_ANCIENS_NIVEAUX = { 1: 1, 2: 13, 3: 31, 4: 49, 5: 69, 6: 87 };

if (typeof module !== 'undefined') module.exports = { MAX_PALIER, ETAPES, palierInfo, PALIER_DES_ANCIENS_NIVEAUX };
