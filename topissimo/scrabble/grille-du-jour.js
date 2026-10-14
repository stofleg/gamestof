//  Grille du jour — trouver tous les scrabbles d'une position.
//
//  Un scrabble est un coup qui pose les SEPT tuiles d'un chevalet plein, et
//  rapporte donc la prime de 50. Une réponse = un mot à un emplacement ; quand
//  le même mot passe à plusieurs endroits, on n'en garde qu'un.
//
//  La difficulté n'est pas de trouver les scrabbles mais d'obtenir une position
//  où ils soient VARIÉS. Trois sortes de doublons se présentent, par ordre
//  d'importance mesurée sur 193 positions réelles :
//    1. le même mot posé à plusieurs endroits (8,3 placements → 5,0 mots) ;
//    2. les anagrammes du même tirage          (5,0 mots → 3,4 jeux de lettres) ;
//    3. la même famille lexicale               (MANGERA / MANGERAS).
//  On écarte 1 et 3. Les anagrammes posées à des endroits DIFFÉRENTS sont
//  conservées — TOURNANT et AUNERONT sont deux trouvailles distinctes — mais
//  celles qui remplissent les MÊMES CASES ne comptent qu'une fois : TEILLES,
//  TIELLES et TILLEES au même emplacement sont trois orthographes d'un seul
//  coup, pas trois trouvailles. Les autres sont données en variantes.
import { generateGame } from "./generator.js";
import { findTop } from "./topfinder.js";
import { emptyBoard, applyMove } from "./engine.js";

const MIN_SCRABBLES = 3;
const MAX_SCRABBLES = 10;
const MIN_ANCRES    = 35;   // « grille assez ouverte » : cases vides au contact

// --- proximité lexicale -----------------------------------------------------
const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

// Terminaisons verbales, de la plus longue à la plus courte. On retire la
// première qui colle pour obtenir une racine approchée : FOUTONS, FOUTIONS et
// FOUTRONS donnent tous FOUT(R). Comparer les PRÉFIXES ne suffisait pas —
// FOUT-ONS et FOUT-IONS ne partagent que quatre lettres.
const FINS_VERBE = ["ERAIENT","IRAIENT","ASSIONS","ISSIONS","ASSENT","ISSENT","ERIONS","IRIONS",
  "ISSAIT","ISSAIS","AIENT","ERONT","IRONT","ERIEZ","IRIEZ","ERAIS","ERAIT","IRAIS","IRAIT",
  "ERENT","IRENT","ASSES","ASSE","ERAS","ERAI","EREZ","IRAS","IRAI","IREZ","IONS","AMES",
  "ATES","IMES","ITES","ERA","IRA","ANT","AIS","AIT","ONS","ENT","EZ","ES","E"];

// Terminaisons sans ambiguïté : celles-ci désignent à coup sûr une forme
// conjuguée. On en exclut E, ES, ENT et EZ, qui sont surtout des pluriels de
// noms — LIERNES ou CURETTES ne sont pas des verbes.
const FINS_SURES = FINS_VERBE.filter(f => f.length >= 3 && f !== "ENT");

/** Forme conjuguée reconnaissable à sa terminaison. */
export function conjugue(w) {
  return FINS_SURES.some(f => w.length - f.length >= 3 && w.endsWith(f));
}

/** Racine approchée : le mot privé de sa terminaison verbale, s'il en a une. */
export function racine(w) {
  for (const f of FINS_VERBE) if (w.length - f.length >= 3 && w.endsWith(f)) return w.slice(0, -f.length);
  return w;
}

/** Deux formes du même verbe : racines égales, ou l'une préfixe de l'autre à une lettre près. */
export function memeVerbe(a, b) {
  const ra = racine(a), rb = racine(b);
  if (ra === rb) return true;
  const [court, long] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  return court.length >= 3 && long.startsWith(court) && long.length - court.length <= 1;
}

/** Même famille : préfixe commun long, ou deux formes d'un même verbe. */
export function memeFamille(a, b) {
  if (a === b) return true;
  const n = lcp(a, b), court = Math.min(a.length, b.length);
  if (n === court) return true;                   // MANGERA ⊂ MANGERAS
  if (n >= Math.max(5, court - 2)) return true;   // MANGEONS / MANGEAIT
  return memeVerbe(a, b);                         // FOUTONS / FOUTIONS / FOUTRONS
}

/** Emplacement d'un coup : mêmes cases = même trouvaille. */
const place = s => `${s.dir}${s.row}:${s.col}:${s.word.length}`;

/** Deux scrabbles trop proches pour compter double. */
export function proches(a, b) {
  return place(a) === place(b) || memeFamille(a.word, b.word);
}

/**
 * Sous-ensemble deux à deux éloignés, les mieux cotés d'abord. Les mots écartés
 * parce qu'ils occupent les mêmes cases sont rattachés en `variantes`.
 */
/**
 * Sous-ensemble deux à deux éloignés, les mieux cotés d'abord. Les mots écartés
 * parce qu'ils occupent les mêmes cases sont rattachés en `variantes`.
 *
 * On plafonne en plus les formes conjuguées. Mesure sur 75 positions réelles :
 * le plafond ne coûte aucune grille (56 retenues contre 55 sans lui) et fait
 * tomber la part de conjugués de 33 à 27 %. L'essentiel du tri vient toutefois
 * de la règle par racine ci-dessus ; plafonner les TERMINAISONS identiques, en
 * revanche, a été essayé et ne sert à rien — les verbes se conjuguent avec des
 * terminaisons variées (REMARIAT, TRIMERAS, MURERAIT, MERITERA…).
 */
export function eloignes(liste, opts = {}) {
  const maxConjugues = opts.maxConjugues ?? 2;
  const out = [];
  let nConj = 0;
  for (const s of liste) {
    const jumeau = out.find(o => proches(o, s));
    if (jumeau) {
      if (place(jumeau) === place(s)) jumeau.variantes.push(s.word);
      continue;
    }
    const c = conjugue(s.word);
    if (c && nConj >= maxConjugues) continue;
    if (c) nConj++;
    out.push({ ...s, variantes: [] });
  }
  return out;
}

// --- analyse d'une position -------------------------------------------------
/** Nombre de tuiles réellement posées (les cases déjà occupées ne comptent pas). */
export function tuilesPosees(board, mv) {
  const dr = mv.dir === "V" ? 1 : 0, dc = mv.dir === "H" ? 1 : 0;
  let n = 0;
  for (let i = 0; i < mv.word.length; i++) if (!board[mv.row + i * dr][mv.col + i * dc]) n++;
  return n;
}

/** Cases vides touchant une lettre : mesure d'ouverture de la grille. */
export function ancres(board) {
  let n = 0;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    if (board[r][c]) continue;
    if ((r > 0 && board[r-1][c]) || (r < 14 && board[r+1][c]) ||
        (c > 0 && board[r][c-1]) || (c < 14 && board[r][c+1])) n++;
  }
  return n;
}

/** Tous les scrabbles d'une position, un seul emplacement par mot, du + cher au - cher. */
export function scrabblesDe(board, rack, dict) {
  if (rack.length !== 7) return [];          // sans chevalet plein, pas de prime
  const all = findTop(board, rack, dict, { all: true }) || [];
  const parMot = new Map();
  for (const c of all) {
    if (tuilesPosees(board, c.move) !== 7) continue;
    const vu = parMot.get(c.move.word);
    if (!vu || c.score > vu.score) {
      parMot.set(c.move.word, {
        word: c.move.word, row: c.move.row, col: c.move.col,
        dir: c.move.dir, score: c.score,
      });
    }
  }
  return [...parMot.values()].sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
}

// --- recherche d'une grille -------------------------------------------------
/**
 * Cherche une position offrant 3 à 10 scrabbles éloignés, sur une grille ouverte,
 * hors premier coup et sans joker au chevalet.
 * Compte environ 3 à 6 secondes et une vingtaine de parties générées.
 * @param {Dictionary} dict
 * @param {object} opts  { minScrabbles, maxScrabbles, minAncres, maxParties, signal }
 * @returns {{board, rack, scrabbles, coup, ancres, parties}|null}
 */
export function chercheGrille(dict, opts = {}) {
  const min    = opts.minScrabbles ?? MIN_SCRABBLES;
  const max    = opts.maxScrabbles ?? MAX_SCRABBLES;
  const minAnc = opts.minAncres    ?? MIN_ANCRES;
  const maxP   = opts.maxParties   ?? 400;

  for (let p = 0; p < maxP; p++) {
    if (opts.signal?.aborted) return null;
    const partie = generateGame(dict, { mode: "duplicate" });
    let board = emptyBoard();
    for (let k = 0; k < partie.moves.length; k++) {
      const mv = partie.moves[k];
      const rack = mv.rack.split("");
      const videPlateau = board.every(r => r.every(c => !c));
      if (!videPlateau && rack.length === 7 && !rack.includes("?")) {
        const a = ancres(board);
        if (a >= minAnc) {
          const tous = scrabblesDe(board, rack, dict);
          if (tous.length >= min) {
            const gardes = eloignes(tous);
            if (gardes.length >= min && gardes.length <= max) {
              return { board, rack, scrabbles: gardes, coup: k + 1, ancres: a, parties: p + 1 };
            }
          }
        }
      }
      board = applyMove(board, mv.top);
    }
  }
  return null;
}
