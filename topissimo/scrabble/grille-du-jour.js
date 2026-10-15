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
//  conservées — TOURNANT et AUNERONT sont deux trouvailles distinctes. En
//  revanche, dès que DEUX scrabbles remplissent les MÊMES CASES (TEILLES,
//  TIELLES et TILLEES au même emplacement), la position entière est REJETÉE :
//  on veut que chaque solution soit à un endroit qui lui est propre.
//  Une position est également rejetée si plus de la moitié des solutions
//  finissent par un S.
import { generateGame } from "./generator.js";
import { findTop } from "./topfinder.js";
import { emptyBoard, applyMove } from "./engine.js";

const MIN_SCRABBLES = 3;
const MAX_SCRABBLES = 10;
const MIN_ANCRES    = 35;   // « grille assez ouverte » : cases vides au contact
const MAX_PART_S    = 0.5;  // part maximale de solutions finissant par un S

// --- proximité lexicale -----------------------------------------------------
const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

// Terminaisons verbales, de la plus longue à la plus courte. On retire la
// première qui colle pour obtenir une racine approchée : FOUTONS, FOUTIONS et
// FOUTRONS donnent tous FOUT(R). Comparer les PRÉFIXES ne suffisait pas —
// FOUT-ONS et FOUT-IONS ne partagent que quatre lettres.
const FINS_VERBE = ["ERAIENT","IRAIENT","ASSIONS","ISSIONS","ASSENT","ISSENT","ERIONS","IRIONS",
  "ISSAIT","ISSAIS","AIENT","ERONT","IRONT","ERIEZ","IRIEZ","ERAIS","ERAIT","IRAIS","IRAIT",
  "ERENT","IRENT","ASSES","ASSE","ISSES","ISSE","USSES","USSE","ERAS","ERAI","EREZ","IRAS",
  "IRAI","IREZ","IONS","AMES","ATES","IMES","ITES","ERA","IRA","ANT","AIS","AIT","ONS",
  "ENT","EZ","ES","E"];
// -ISSE et -USSE couvrent le subjonctif imparfait (RENDISSE, DETINSSE, FUSSE).
// Quelques noms y tombent par erreur — SAUCISSE, COULISSE — mais le plafond ne
// fait que limiter leur nombre, il n'écarte jamais un mot à lui seul.

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

/** Longueur du plus long morceau commun aux deux mots (facteur, pas préfixe). */
export function plusLongCommun(a, b) {
  let best = 0;
  const prec = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prec[j];
      prec[j] = a[i-1] === b[j-1] ? diag + 1 : 0;
      if (prec[j] > best) best = prec[j];
      diag = tmp;
    }
  }
  return best;
}

/** Même famille : préfixe commun long, formes d'un même verbe, ou long morceau commun. */
export function memeFamille(a, b) {
  if (a === b) return true;
  const n = lcp(a, b), court = Math.min(a.length, b.length);
  if (n === court) return true;                   // MANGERA ⊂ MANGERAS
  if (n >= Math.max(5, court - 2)) return true;   // MANGEONS / MANGEAIT
  if (memeVerbe(a, b)) return true;               // FOUTONS / FOUTIONS / FOUTRONS
  // AGRANDIR, GRANDIRA et RAGRANDI n'ont ni préfixe ni racine en commun, mais
  // partagent GRANDI(R) : six lettres d'affilée sur des mots de sept ou huit
  // suffisent à les rendre jumeaux. RINGARDA, lui, n'en partage qu'une.
  return plusLongCommun(a, b) >= 6;
}

/** Emplacement d'un coup : mêmes cases = même trouvaille. */
const place = s => `${s.dir}${s.row}:${s.col}:${s.word.length}`;

/** Deux scrabbles trop proches pour compter double. */
export function proches(a, b) {
  return place(a) === place(b) || memeFamille(a.word, b.word);
}

/**
 * Sous-ensemble deux à deux éloignés, les mieux cotés d'abord.
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
  const maxRime      = opts.maxRime      ?? 2;   // mots partageant 5 lettres finales
  const out = [];
  let nConj = 0;
  const rimes = new Map();
  for (const s of liste) {
    if (out.some(o => proches(o, s))) continue;
    // Rimes longues : RENDISSE, TENDISSE et FENDISSE partagent ENDISSE. Ce sont
    // des verbes différents, donc la règle par racine les laisse passer, mais
    // trois quasi-homophones dans un même lot font une grille sans intérêt.
    // (Plafonner sur 3 lettres finales, essayé d'abord, ne servait à rien.)
    const rime = s.word.length >= 6 ? s.word.slice(-5) : null;
    if (rime && (rimes.get(rime) || 0) >= maxRime) continue;
    const c = conjugue(s.word);
    if (c && nConj >= maxConjugues) continue;
    if (c) nConj++;
    if (rime) rimes.set(rime, (rimes.get(rime) || 0) + 1);
    out.push({ ...s });
  }
  return out;
}

/**
 * Vrai si la correspondance mot ↔ emplacement n'est pas une bijection, c'est-à-dire
 * si un mot passe à deux endroits (FUSERONT sur le S de MALAGAS ET sur celui
 * d'ALESEUSE) ou si deux mots remplissent les mêmes cases. Dans les deux cas la
 * position est jetée : chaque solution doit avoir son emplacement, et chaque
 * emplacement sa solution.
 */
export function doublon(liste) {
  const mots = new Set(), places = new Set();
  for (const s of liste) {
    const k = place(s);
    if (mots.has(s.word) || places.has(k)) return true;
    mots.add(s.word); places.add(k);
  }
  return false;
}

/** Vrai si plus de la moitié des solutions finissent par un S. */
export function tropDeS(liste, max = MAX_PART_S) {
  if (!liste.length) return false;
  return liste.filter(s => s.word.endsWith("S")).length / liste.length > max;
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

/**
 * TOUS les scrabbles d'une position, sans dédoublonner : un même mot jouable à
 * deux endroits apparaît deux fois, et c'est voulu — la position doit alors être
 * rejetée, et on ne peut le voir qu'en les gardant.
 */
export function scrabblesDe(board, rack, dict) {
  if (rack.length !== 7) return [];          // sans chevalet plein, pas de prime
  const all = findTop(board, rack, dict, { all: true }) || [];
  const out = [], vus = new Set();
  for (const c of all) {
    if (tuilesPosees(board, c.move) !== 7) continue;
    const k = `${c.move.word}|${c.move.dir}${c.move.row}:${c.move.col}`;
    if (vus.has(k)) continue;
    vus.add(k);
    out.push({ word: c.move.word, row: c.move.row, col: c.move.col,
               dir: c.move.dir, score: c.score });
  }
  return out.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
}

// --- recherche d'une grille -------------------------------------------------
/**
 * Cherche une position offrant 3 à 10 scrabbles éloignés, sur une grille ouverte,
 * hors premier coup et sans joker au chevalet.
 * Compte environ 3 à 6 secondes et une vingtaine de parties générées.
 * @param {Dictionary} dict
 * @param {object} opts  { minScrabbles, maxScrabbles, minAncres, maxParties, onProgress }
 * @returns {{board, rack, scrabbles, coup, ancres, parties}|null}
 */
export function chercheGrille(dict, opts = {}) {
  const min    = opts.minScrabbles ?? MIN_SCRABBLES;
  const max    = opts.maxScrabbles ?? MAX_SCRABBLES;
  const minAnc = opts.minAncres    ?? MIN_ANCRES;
  const maxP   = opts.maxParties   ?? 400;

  for (let p = 0; p < maxP; p++) {
    if (opts.onProgress) opts.onProgress(p + 1);
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
          // un mot à deux endroits, ou deux mots au même endroit : on jette
          if (tous.length >= min && !doublon(tous)) {
            const gardes = eloignes(tous);
            if (gardes.length >= min && gardes.length <= max && !tropDeS(gardes)) {
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

// === Énumération inverse : partir des mots, en déduire le chevalet ===========
//
//  La recherche classique tire un chevalet et regarde ce qu'il donne : une
//  position sur seize convient. L'énumération inverse parcourt au contraire
//  TOUS les emplacements où un mot du dictionnaire poserait exactement sept
//  tuiles, et déduit de chacun le chevalet qu'il exige. Sur un plateau au
//  9e coup : 800 000 emplacements en une demi-seconde, dont 12 000 chevalets
//  servant trois mots différents ou plus.
//
//  C'est ce qui permet de COMMANDER un type de coup : chaque emplacement porte
//  son nombre de lettres d'appui, on ne garde que ceux de la forme voulue, et
//  on cherche un chevalet qui en serve plusieurs à la fois.
//
//  Attention : cette énumération ne vérifie PAS les mots perpendiculaires
//  formés. Elle ne sert qu'à proposer des chevalets, que scrabblesDe() valide
//  ensuite pour de bon.

const SAC_FR = {A:9,B:2,C:2,D:3,E:15,F:2,G:2,H:2,I:8,J:1,K:1,L:5,M:3,N:6,O:6,
                P:2,Q:1,R:6,S:6,T:6,U:6,V:2,W:1,X:1,Y:1,Z:1};

/** Le chevalet est-il encore tirable, vu les lettres déjà posées ? */
export function tirable(cle, board) {
  const reste = { ...SAC_FR };
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const t = board[r][c];
    if (t && !t.isBlank && reste[t.letter] != null) reste[t.letter]--;
  }
  for (const ch of cle) { if (!reste[ch]) return false; reste[ch]--; }
  return true;
}

/** Jetons posés le long d'une lettre déjà en place (contacts latéraux). */
export function contactsDe(board, s) {
  const dr = s.dir === "V" ? 1 : 0, dc = s.dir === "H" ? 1 : 0;
  let n = 0;
  for (let i = 0; i < s.word.length; i++) {
    const r = s.row + i*dr, c = s.col + i*dc;
    if (board[r][c]) continue;                     // case d'appui, pas un jeton posé
    const vs = s.dir === "H" ? [[r-1,c],[r+1,c]] : [[r,c-1],[r,c+1]];
    if (vs.some(([y,x]) => y>=0 && y<15 && x>=0 && x<15 && board[y][x])) n++;
  }
  return n;
}

/**
 * Rallonges : jetons posés qui ALLONGENT un mot existant plutôt que de créer un
 * mot de deux lettres. Un I devant RIEN donne IRIEN, un C devant ACTUS donne
 * CACTUS : le mot perpendiculaire formé fait trois lettres ou plus. Deux dans le
 * même coup, c'est la « double rallonge ».
 */
export function rallongesDe(board, s) {
  const dr = s.dir === "V" ? 1 : 0, dc = s.dir === "H" ? 1 : 0;
  const pdr = s.dir === "V" ? 0 : 1, pdc = s.dir === "V" ? 1 : 0;  // perpendiculaire
  let n = 0;
  for (let i = 0; i < s.word.length; i++) {
    const r = s.row + i*dr, c = s.col + i*dc;
    if (board[r][c]) continue;                       // case d'appui, pas un jeton posé
    let avant = 0, apres = 0;
    for (let k = 1; ; k++) {
      const y = r - k*pdr, x = c - k*pdc;
      if (y < 0 || x < 0 || !board[y][x]) break;
      avant++;
    }
    for (let k = 1; ; k++) {
      const y = r + k*pdr, x = c + k*pdc;
      if (y > 14 || x > 14 || !board[y][x]) break;
      apres++;
    }
    if (avant + apres >= 2) n++;                     // mot perpendiculaire de 3+ lettres
  }
  return n;
}

/** Lettres d'appui situées DANS le mot (cases déjà occupées qu'il traverse). */
export function appuisDe(board, s) {
  const dr = s.dir === "V" ? 1 : 0, dc = s.dir === "H" ? 1 : 0;
  let n = 0;
  for (let i = 0; i < s.word.length; i++) if (board[s.row + i*dr][s.col + i*dc]) n++;
  return n;
}

function motsDuGabarit(dict, gabarit) {
  const L = gabarit.length, fixes = [];
  for (let i = 0; i < L; i++) if (gabarit[i] !== ".") fixes.push([i, gabarit[i]]);
  const out = [];
  for (const w of (dict.byLen.get(L) || [])) {
    let ok = true;
    for (const [i, ch] of fixes) if (w[i] !== ch) { ok = false; break; }
    if (ok) out.push(w);
  }
  return out;
}

/**
 * Tous les emplacements posant exactement `tuiles` jetons, avec le chevalet
 * qu'ils exigent (`cle`, lettres triées) et leur nombre de lettres d'appui.
 */
export function emplacements(board, dict, tuiles = 7) {
  const res = [];
  const occ = ([r, c]) => r >= 0 && r < 15 && c >= 0 && c < 15 && !!board[r][c];
  for (const dir of ["H", "V"]) {
    for (let l = 0; l < 15; l++) {
      for (let debut = 0; debut < 15; debut++) {
        for (let L = 2; L <= 15 - debut; L++) {
          const cases = [];
          for (let i = 0; i < L; i++) cases.push(dir === "H" ? [l, debut + i] : [debut + i, l]);
          // le mot ne doit pas être tronqué par une lettre voisine
          if (occ(dir === "H" ? [l, debut - 1] : [debut - 1, l])) continue;
          if (occ(dir === "H" ? [l, debut + L] : [debut + L, l])) continue;
          let vides = 0, gabarit = "", touche = false, contacts = 0;
          for (const [r, c] of cases) {
            const t = board[r][c];
            if (t) { gabarit += t.letter; touche = true; }
            else {
              gabarit += "."; vides++;
              const vs = dir === "H" ? [[r-1,c],[r+1,c]] : [[r,c-1],[r,c+1]];
              // jeton posé le long d'une lettre existante : c'est une « collante »
              if (vs.some(occ)) { touche = true; contacts++; }
            }
          }
          if (vides !== tuiles || !touche) continue;
          const appuis = L - vides;
          for (const mot of motsDuGabarit(dict, gabarit)) {
            let chevalet = "";
            for (let i = 0; i < L; i++) if (gabarit[i] === ".") chevalet += mot[i];
            res.push({ mot, dir, row: cases[0][0], col: cases[0][1], appuis, contacts,
                       cle: [...chevalet].sort().join("") });
          }
        }
      }
    }
  }
  return res;
}

const nbVoyelles = s => [...s].filter(c => "AEIOU".includes(c)).length;

/**
 * Décrit la forme de coup recherchée. Deux critères, cumulables :
 *   appuis   : lettres déjà posées que le mot TRAVERSE (2 = double appui,
 *              donc un mot de neuf lettres pour sept tuiles) ;
 *   contacts : jetons posés LE LONG d'une lettre existante (la « collante
 *              sur x lettres » — x contacts latéraux, donc x mots
 *              perpendiculaires formés) ;
 *   rallonges: parmi ces contacts, ceux qui ALLONGENT un mot existant au lieu
 *              de créer un mot de deux lettres (I devant RIEN → IRIEN).
 * Chacun accepte un nombre exact, ou { min, max }.
 */
function correspond(valeur, voulu) {
  if (voulu == null) return true;
  if (typeof voulu === "number") return valeur === voulu;
  if (voulu.min != null && valeur < voulu.min) return false;
  if (voulu.max != null && valeur > voulu.max) return false;
  return true;
}

/**
 * Cherche une grille contenant au moins `minCiblees` solutions de la forme
 * demandée. L'énumération inverse fournit les chevalets candidats ; chacun est
 * ensuite validé pour de bon par scrabblesDe(), qui seul vérifie les mots
 * perpendiculaires.
 *
 *   chercheGrilleCiblee(dict, { appuis: 2 })                 double appui
 *   chercheGrilleCiblee(dict, { contacts: 5, appuis: 0 })    collante sur 5
 *   chercheGrilleCiblee(dict, { contacts: { min: 4 } })      collante sur 4+
 *   chercheGrilleCiblee(dict, { appuis: 3 })                 triple appui
 *   chercheGrilleCiblee(dict, { rallonges: { min: 2 } })     double rallonge
 *
 * Compter une dizaine de secondes par grille.
 */
export function chercheGrilleCiblee(dict, opts = {}) {
  const vAppuis    = opts.appuis    ?? null;
  const vContacts  = opts.contacts  ?? null;
  const vRallonges = opts.rallonges ?? null;
  const minCiblees = opts.minCiblees ?? 2;
  const min = opts.minScrabbles ?? MIN_SCRABBLES;
  const max = opts.maxScrabbles ?? MAX_SCRABBLES;
  const minAnc = opts.minAncres ?? MIN_ANCRES;
  const maxP = opts.maxParties ?? 400;
  // L'énumération ne connaît pas les rallonges (elle ignore les mots
  // perpendiculaires) : on filtre dessus plus large, puis on vérifie sur le coup.
  const vise = e => correspond(e.appuis, vAppuis) && correspond(e.contacts, vContacts)
    && (vRallonges == null || e.contacts >= (typeof vRallonges === "number" ? vRallonges : vRallonges.min || 1));
  const viseCoup = (board, s) =>
    correspond(appuisDe(board, s), vAppuis) && correspond(contactsDe(board, s), vContacts)
    && correspond(rallongesDe(board, s), vRallonges);

  for (let p = 0; p < maxP; p++) {
    if (opts.onProgress) opts.onProgress(p + 1);
    const partie = generateGame(dict, { mode: "duplicate" });
    let board = emptyBoard();
    for (let k = 0; k < partie.moves.length - 3; k++) {
      board = applyMove(board, partie.moves[k].top);
      if (k < 5 || ancres(board) < minAnc) continue;
      const parCle = new Map();
      for (const e of emplacements(board, dict, 7)) {
        if (!vise(e)) continue;
        if (!parCle.has(e.cle)) parCle.set(e.cle, new Set());
        parCle.get(e.cle).add(e.mot);
      }
      const cands = [...parCle.entries()]
        .filter(([cle, s]) => s.size >= minCiblees && nbVoyelles(cle) >= 2
                           && nbVoyelles(cle) <= 5 && tirable(cle, board))
        .sort((a, c) => a[1].size - c[1].size);
      for (const [cle] of cands.slice(0, 120)) {
        const tous = scrabblesDe(board, [...cle], dict);
        if (tous.length < min || doublon(tous)) continue;
        const gardes = eloignes(tous);
        if (gardes.length < min || gardes.length > max || tropDeS(gardes)) continue;
        if (gardes.filter(s => viseCoup(board, s)).length < minCiblees) continue;
        return { board, rack: [...cle], scrabbles: gardes, coup: k + 1,
                 ancres: ancres(board), parties: p + 1 };
      }
    }
  }
  return null;
}
