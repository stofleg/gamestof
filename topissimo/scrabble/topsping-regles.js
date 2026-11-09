// ============================================================
//  TopSping : tournoi façon Roland-Garros contre le top (logique pure, sans affichage).
//
//  • Chaque coup est un point : top trouvé dans le temps → point pour le joueur,
//    sinon point pour « le top ».
//  • Jeu : 15 / 30 / 40 / jeu, égalité et avantage à 40-40.
//  • Set : 6 jeux avec 2 d'écart ; à 6-6, tie-break en 7 points avec 2 d'écart.
//  • Match : 3 sets gagnants. Tableau de 7 tours, une formule par tour ; un match
//    perdu (ou un abandon) termine le tournoi.
//  • Parties : chaque tour a sa réserve, jouée dans le même ordre par tous. Chaque
//    jeu prend la partie suivante de la réserve et commence au coup 1, 5, 9, 13 ou 17
//    selon le set (jamais à moins de 8 coups de la fin de la partie). Si la partie
//    s'épuise en plein jeu, on continue sur la partie suivante, au même coup de départ.
// ============================================================

export const TOURS = [
  { nom: "1er tour",        court: "1er tour",  mode: "duplicate", joker: false, formule: "Normale" },
  { nom: "2e tour",         court: "2e tour",   mode: "duplicate", joker: true,  formule: "Joker" },
  { nom: "16es de finale",  court: "16es",      mode: "7sur8",     joker: false, formule: "7 sur 8" },
  { nom: "8es de finale",   court: "8es",       mode: "7sur8",     joker: true,  formule: "7 sur 8 joker" },
  { nom: "Quarts de finale", court: "Quarts",   mode: "7et8",      joker: false, formule: "7 et 8" },
  { nom: "Demi-finale",     court: "Demie",     mode: "7et8",      joker: true,  formule: "7 et 8 joker" },
  { nom: "Finale",          court: "Finale",    mode: "789",       joker: false, formule: "7, 8 et 9" },
];
export const SETS_GAGNANTS = 3;
export const TEMPS_COUP = 40;
const MARGE_FIN = 8;   // un jeu ne commence jamais à moins de 8 coups de la fin de la partie

/** Coup de départ (0 = coup 1) d'un jeu du set `set` (0 = 1er set) dans une partie de `n` coups. */
export function coupDepart(set, n) {
  return Math.max(0, Math.min(4 * set, n - MARGE_FIN));
}

/** Nouvel état de tournoi (avant le 1er coup). */
export function nouveauTournoi() {
  return {
    v: 1, tour: 0, fini: false, vainqueur: false, abandon: false,
    match: nouveauMatch(),
    ptr: 0, partie: null, coup: null,          // position dans la réserve du tour en cours
    stats: { coups: 0, rates: 0, neg: 0, points: 0, temps: 0 },
    matchs: [],                                  // résultats des matchs terminés
  };
}
function nouveauMatch() {
  return { sets: [], set: { j: 0, o: 0 }, jeu: { j: 0, o: 0, tb: false }, setsJ: 0, setsO: 0 };
}

/** Prend la partie suivante de la réserve et place le jeu à son coup de départ. */
export function nouvellePartie(e, reserve) {
  const n = reserve.length;
  e.partie = e.ptr % n;          // réserve épuisée (très rare) : on reprend au début
  e.ptr++;
  e.coup = coupDepart(e.match.sets.length, reserve[e.partie].length);
}

/**
 * Enregistre un point. `gagne` : le joueur a trouvé le top. Renvoie les événements
 * produits : { jeu, set, match, tournoi, cote, tieBreak }, chacun vrai si l'étape vient
 * de se terminer (cote : changement de côté). Avance aussi la position (coup suivant,
 * ou partie suivante si le jeu est fini ou la partie épuisée).
 */
export function jouerPoint(e, gagne, reserve) {
  const m = e.match, j = m.jeu, ev = { jeu: false, set: false, match: false, tournoi: false, cote: false, gagneJeu: null };
  gagne ? j.j++ : j.o++;
  const cible = j.tb ? 7 : 4;
  const jeuFini = (j.j >= cible || j.o >= cible) && Math.abs(j.j - j.o) >= 2;
  if (jeuFini) {
    ev.jeu = true; ev.gagneJeu = j.j > j.o;
    ev.gagneJeu ? m.set.j++ : m.set.o++;
    const a = m.set.j, b = m.set.o;
    const setFini = (Math.max(a, b) >= 6 && Math.abs(a - b) >= 2) || (j.tb);   // tie-break gagné → 7-6
    if (setFini) {
      ev.set = true;
      m.sets.push([a, b]);
      a > b ? m.setsJ++ : m.setsO++;
      m.set = { j: 0, o: 0 };
      if (m.setsJ === SETS_GAGNANTS || m.setsO === SETS_GAGNANTS) {
        ev.match = true;
        const gagneMatch = m.setsJ === SETS_GAGNANTS;
        e.matchs.push({ tour: e.tour, sets: m.sets.map(s => s.slice()), gagne: gagneMatch });
        if (!gagneMatch) { e.fini = true; ev.tournoi = true; }
        else if (e.tour === TOURS.length - 1) { e.fini = true; e.vainqueur = true; ev.tournoi = true; }
        else { e.tour++; e.match = nouveauMatch(); e.ptr = 0; }
      } else {
        // Changement de côté si le nombre de jeux du set qui s'achève est impair.
        ev.cote = (a + b) % 2 === 1;
      }
    } else {
      ev.cote = (a + b) % 2 === 1;
    }
    e.match.jeu = { j: 0, o: 0, tb: !ev.match && e.match.set.j === 6 && e.match.set.o === 6 };
    e.partie = null; e.coup = null;              // le prochain jeu prendra une nouvelle partie
  } else if (reserve) {
    e.coup++;
    if (e.coup >= reserve[e.partie].length) nouvellePartie(e, reserve);   // partie épuisée en plein jeu
  }
  return ev;
}

/** Affichage du score d'un jeu, du point de vue du joueur : ["15", "30"], ["Égalité"], ["AV", ""]… */
export function scoreJeu(jeu) {
  if (jeu.tb) return [String(jeu.j), String(jeu.o)];
  const L = ["0", "15", "30", "40"];
  if (jeu.j >= 3 && jeu.o >= 3) {
    if (jeu.j === jeu.o) return ["40", "40"];
    return jeu.j > jeu.o ? ["AV", "40"] : ["40", "AV"];
  }
  return [L[Math.min(jeu.j, 3)], L[Math.min(jeu.o, 3)]];
}

/** Rang au classement : tour atteint (vainqueur = 7), puis moins de coups ratés, puis meilleur négatif. */
export function niveauAtteint(e) { return e.vainqueur ? TOURS.length : e.tour; }
export function comparerClassement(a, b) {
  return (b.niveau - a.niveau) || (a.rates - b.rates) || (b.neg - a.neg);
}
export function nomNiveau(niveau) { return niveau >= TOURS.length ? "Vainqueur" : TOURS[niveau].nom; }
