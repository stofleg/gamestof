// ============================================================
//  Grille cube (tournoi de Noël) : moteur de jeu sur les 6 faces d'un cube.
//
//  Faces : F principale (étoile), R droite, B arrière, L gauche, U dessus, D dessous.
//  Les mots se lisent dans le sens de lecture de la face principale :
//   • horizontalement, les 4 faces du tour forment une BANDE en boucle : L → F → R → B → L ;
//     sur le dessus et le dessous, un mot horizontal reste sur sa face ;
//   • verticalement, dessus → principale → dessous forment une COLONNE continue (45 cases) ;
//     sur la droite, l'arrière et la gauche, un mot vertical reste sur sa face.
//  Chaque case appartient donc à une ligne horizontale et à une ligne verticale.
//
//  Cases bonus : grille classique sur la face principale, prolongée par « cases miroir »
//  (réflexion sur la rangée du bord) vers la droite et vers la gauche ; les deux
//  prolongements se rejoignent au milieu de la face arrière (couture, colonne 8). Copies
//  de H8 : H7 à droite, H9 à gauche, H6 et H10 à l'arrière, I8 dessus, G8 dessous.
//  Aucune case mot triple n'en touche une autre à travers une arête.
//
//  Un coup : { ligne, debut, word, blanks } — `ligne` : indice de la ligne, `debut` : rang
//  de la 1re lettre dans la ligne, `blanks` : rangs (dans le mot) des jokers.
// ============================================================
import { BOARD_BONUSES, letterValue } from "./engine.js?v=483";

export const FACES = ["F", "R", "B", "L", "U", "D"];
export const NOM_FACE = { F: "principale", R: "droite", B: "arrière", L: "gauche", U: "dessus", D: "dessous" };
const RANGS = "ABCDEFGHIJKLMNO";
const N = 15;

// ---------- cases bonus ----------
const miroir = v => { const x = ((v % 28) + 28) % 28; return x <= 14 ? x : 28 - x; };
const bonusClassique = (r, c) => { const t = BOARD_BONUSES[r][c]; return t === "*" ? "D" : t; };
const id = x => x;
const faceBonus = (fr, fc) => Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => bonusClassique(fr(r), fc(c))).join(""));
export const BONUS_CUBE = {
  F: BOARD_BONUSES.slice(),
  R: faceBonus(id, c => miroir(c + 15)),
  L: faceBonus(id, c => miroir(c - 15)),
  B: faceBonus(id, c => miroir(c <= 7 ? c + 30 : (14 - c) + 30)),   // couture : miroir sur la colonne 8
  U: faceBonus(r => miroir(r - 15), id),
  D: faceBonus(r => miroir(r + 15), id),
};

// ---------- lignes ----------
// LIGNES[i] = { dir: "H"|"V", cyclique, cases: [[face, r, c], …] } ; LIGNE_DE[face][r][c] = { H: [i, rang], V: [i, rang] }
export const LIGNES = [];
const LIGNE_DE = Object.fromEntries(FACES.map(f => [f, Array.from({ length: N }, () => Array.from({ length: N }, () => ({})))]));
function ajouteLigne(dir, cyclique, cases) {
  const i = LIGNES.length;
  LIGNES.push({ dir, cyclique, cases });
  cases.forEach(([f, r, c], k) => { LIGNE_DE[f][r][c][dir] = [i, k]; });
}
for (let r = 0; r < N; r++) ajouteLigne("H", true, ["L", "F", "R", "B"].flatMap(f => Array.from({ length: N }, (_, c) => [f, r, c])));
for (const f of ["U", "D"]) for (let r = 0; r < N; r++) ajouteLigne("H", false, Array.from({ length: N }, (_, c) => [f, r, c]));
for (let c = 0; c < N; c++) ajouteLigne("V", false, ["U", "F", "D"].flatMap(f => Array.from({ length: N }, (_, r) => [f, r, c])));
for (const f of ["R", "B", "L"]) for (let c = 0; c < N; c++) ajouteLigne("V", false, Array.from({ length: N }, (_, r) => [f, r, c]));
export const ligneDe = (f, r, c, dir) => LIGNE_DE[f][r][c][dir];
/** Case voisine de (f, r, c) dans le sens `dir` ("H" ou "V"), `delta` = ±1 ; null derrière un mur. */
export function voisin(f, r, c, dir, delta) {
  const [li, k] = LIGNE_DE[f][r][c][dir];
  return rangLigne(LIGNES[li], k + delta);
}
/** Déplacements de la vue : face atteinte par ◀ ▶ ▲ ▼ depuis chaque face (null = mur). */
export const PIVOTS = {
  F: { gauche: "L", droite: "R", haut: "U", bas: "D" },
  R: { gauche: "F", droite: "B", haut: null, bas: null },
  B: { gauche: "R", droite: "L", haut: null, bas: null },
  L: { gauche: "B", droite: "F", haut: null, bas: null },
  U: { gauche: null, droite: null, haut: null, bas: "F" },
  D: { gauche: null, droite: null, haut: "F", bas: null },
};
/** Suite de pivots pour aller d'une face à une autre (par la face principale si besoin). */
export function cheminFaces(de, vers) {
  if (de === vers) return [];
  const tour = ["F", "R", "B", "L"];
  const parTour = (a, b) => {   // a, b dans la bande : sens le plus court
    const i = tour.indexOf(a), j = tour.indexOf(b), d = (j - i + 4) % 4;
    return d === 0 ? [] : d <= 2 ? Array(d).fill("droite") : ["gauche"];
  };
  if (de === "U") return ["bas", ...cheminFaces("F", vers)];
  if (de === "D") return ["haut", ...cheminFaces("F", vers)];
  if (vers === "U") return [...parTour(de, "F"), "haut"];
  if (vers === "D") return [...parTour(de, "F"), "bas"];
  return parTour(de, vers);
}

// ---------- plateau ----------
export const cubeVide = () => Object.fromEntries(FACES.map(f => [f, Array.from({ length: N }, () => Array(N).fill(null))]));
export const estVide = cube => FACES.every(f => cube[f].every(l => l.every(x => !x)));
const caseDe = (cube, [f, r, c]) => cube[f][r][c];
/** Case de rang k d'une ligne (null hors ligne). */
export function rangLigne(L, k) {
  const n = L.cases.length;
  if (L.cyclique) return L.cases[((k % n) + n) % n];
  return k >= 0 && k < n ? L.cases[k] : null;
}
/** Cases d'un coup, dans l'ordre du mot. */
export function casesDuCoup(move) {
  const L = LIGNES[move.ligne];
  return Array.from({ length: move.word.length }, (_, i) => rangLigne(L, move.debut + i));
}
/** Libellé : face et position de la 1re lettre, notation FFSc (H8 horizontal, 8H vertical). */
export function positionCoup(move) {
  const [f, r, c] = casesDuCoup(move)[0];
  const dir = LIGNES[move.ligne].dir;
  return `${NOM_FACE[f]} ${dir === "H" ? RANGS[r] + (c + 1) : (c + 1) + RANGS[r]}`;
}
export function appliqueCoup(cube, move) {
  const b = Object.fromEntries(FACES.map(f => [f, cube[f].map(l => l.slice())]));
  casesDuCoup(move).forEach(([f, r, c], i) => { if (!b[f][r][c]) b[f][r][c] = { letter: move.word[i], isBlank: (move.blanks || []).includes(i) }; });
  return b;
}

/** Mot contigu contenant le rang k de la ligne L (avec, en plus, des lettres posées « virtuellement »). */
function motAutour(cube, L, k, poses) {
  const lettre = kk => { const cs = rangLigne(L, kk); if (!cs) return null; const p = poses?.get(cs.join()); return p || caseDe(cube, cs); };
  const n = L.cases.length;
  let a = k; while (lettre(a - 1) && k - (a - 1) < n) a--;
  let b = k; while (lettre(b + 1) && (b + 1) - a < n) b++;
  const cells = []; for (let kk = a; kk <= b; kk++) cells.push({ cs: rangLigne(L, kk), t: lettre(kk) });
  return cells;
}

// ---------- score ----------
/** Valide et compte un coup. Renvoie { score, words, errors, placed }. */
export function scoreCube(cube, move, dict, opts = {}) {
  const bonuses = opts.bonuses || { 7: 50 };
  const L = LIGNES[move.ligne], errors = [];
  if (!L) return { score: 0, words: [], errors: ["Ligne inconnue"], placed: [] };
  if (move.word.length > L.cases.length || (!L.cyclique && move.debut + move.word.length > L.cases.length) || move.debut < 0)
    return { score: 0, words: [], errors: ["Mot hors grille"], placed: [] };
  const cases = casesDuCoup(move), poses = new Map(), placed = [];
  for (let i = 0; i < cases.length; i++) {
    const ex = caseDe(cube, cases[i]), L2 = move.word[i];
    if (ex) { if (ex.letter !== L2) return { score: 0, words: [], errors: [`Conflit : ${ex.letter} ≠ ${L2}`], placed: [] }; }
    else { const t = { letter: L2, isBlank: (move.blanks || []).includes(i) }; poses.set(cases[i].join(), t); placed.push({ cs: cases[i], ...t }); }
  }
  if (!placed.length) return { score: 0, words: [], errors: ["Aucune lettre nouvelle posée"], placed };
  // raccord : 1er coup sur l'étoile, sinon toucher une lettre déjà posée
  if (estVide(cube)) {
    if (!cases.some(([f, r, c]) => f === "F" && r === 7 && c === 7)) errors.push("Le premier coup doit passer par l'étoile");
  } else {
    const touche = cases.some(cs => caseDe(cube, cs)) || placed.some(({ cs: [f, r, c] }) => {
      const perp = L.dir === "H" ? "V" : "H", [li, k] = ligneDe(f, r, c, perp), P = LIGNES[li];
      return [k - 1, k + 1].some(kk => { const cs = rangLigne(P, kk); return cs && caseDe(cube, cs); });
    });
    if (!touche) errors.push("Le mot doit toucher une lettre déjà posée");
  }
  // mots formés : mot principal (prolongé) + mots croisés des lettres posées
  const [li0, k0] = ligneDe(...cases[0], L.dir);
  const mots = [motAutour(cube, LIGNES[li0], k0, poses)];
  for (const p of placed) {
    const perp = L.dir === "H" ? "V" : "H", [li, k] = ligneDe(...p.cs, perp);
    const m = motAutour(cube, LIGNES[li], k, poses);
    if (m.length > 1) mots.push(m);
  }
  const invalides = [];
  for (const m of mots) {
    const w = m.map(x => x.t.letter).join("");
    if (dict && !dict.has(w)) { errors.push(`"${w}" n'est pas dans le dictionnaire`); invalides.push(...m.map(x => x.cs)); }
  }
  if (errors.length && !opts.raw) return { score: 0, words: mots.map(m => m.map(x => x.t.letter).join("")), errors, placed, invalides };
  let total = 0; const words = [];
  for (const m of mots) {
    let s = 0, mult = 1;
    for (const { cs: [f, r, c], t } of m) {
      let v = t.isBlank ? 0 : letterValue(t.letter);
      if (poses.has([f, r, c].join())) {
        const bo = BONUS_CUBE[f][r][c];
        if (bo === "d") v *= 2; else if (bo === "t") v *= 3; else if (bo === "D" || bo === "*") mult *= 2; else if (bo === "T") mult *= 3;
      }
      s += v;
    }
    s *= mult; total += s; words.push({ word: m.map(x => x.t.letter).join(""), score: s });
  }
  if (bonuses[placed.length]) total += bonuses[placed.length];
  return { score: total, words, errors, placed };
}

// ---------- recherche du top ----------
/** Tous les coups jouables (triés par score décroissant). opts : { maxTilesUsed, bonuses }. */
export function coupsCube(cube, rack, dict, opts = {}) {
  const maxTiles = opts.maxTilesUsed ?? rack.length, bonuses = opts.bonuses || { 7: 50 };
  const vide = estVide(cube), vus = new Set(), cands = [];
  const occupee = cs => cs && caseDe(cube, cs);
  // lettres permises sur une case vide, vu le mot perpendiculaire (cache)
  const cacheCroise = new Map();
  const permis = (cs, dir) => {
    const cle = cs.join() + dir;
    if (cacheCroise.has(cle)) return cacheCroise.get(cle);
    const perp = dir === "H" ? "V" : "H", [li, k] = ligneDe(...cs, perp), P = LIGNES[li];
    let avant = "", apres = "";
    for (let kk = k - 1; ; kk--) { const c2 = rangLigne(P, kk); if (!c2 || !caseDe(cube, c2) || k - kk >= P.cases.length) break; avant = caseDe(cube, c2).letter + avant; }
    for (let kk = k + 1; ; kk++) { const c2 = rangLigne(P, kk); if (!c2 || !caseDe(cube, c2) || kk - k >= P.cases.length) break; apres += caseDe(cube, c2).letter; }
    let res = null;   // null = pas de contrainte
    if (avant || apres) { res = new Set(); for (let x = 65; x <= 90; x++) { const l = String.fromCharCode(x); if (dict.has(avant + l + apres)) res.add(l); } }
    cacheCroise.set(cle, res);
    return res;
  };
  const voisinOccupe = cs => ["H", "V"].some(d => { const [li, k] = ligneDe(...cs, d), P = LIGNES[li]; return occupee(rangLigne(P, k - 1)) || occupee(rangLigne(P, k + 1)); });
  LIGNES.forEach((L, li) => {
    const n = L.cases.length;
    // ancres : cases vides voisines d'une lettre (ou l'étoile au 1er coup)
    const ancres = [];
    for (let k = 0; k < n; k++) {
      const cs = L.cases[k];
      if (caseDe(cube, cs)) continue;
      if (vide ? (cs[0] === "F" && cs[1] === 7 && cs[2] === 7) : voisinOccupe(cs)) ancres.push(k);
    }
    if (!ancres.length) return;
    if (vide && L.dir === "V") return;   // 1er coup horizontal (règle FFSc)
    for (const a of ancres) {
      // débuts possibles : on recule tant qu'il reste assez de jetons pour les cases vides
      let vides = 0;
      for (let s = a; a - s < n - 1; s--) {
        const cs = rangLigne(L, s);
        if (!cs) break;
        if (!caseDe(cube, cs)) { vides++; if (vides > maxTiles) break; }
        if (occupee(rangLigne(L, s - 1)) && a - (s - 1) < n) continue;   // le mot commencerait plus tôt
        etend(li, L, s, s, "", rack, [], 0, false, a);
      }
    }
  });
  function etend(li, L, s, k, mot, reste, blancs, poses, couvre, a) {
    const n = L.cases.length;
    if (k - s >= n) return;
    const cs = rangLigne(L, k);
    const fin = () => {
      if (couvre && poses > 0 && mot.length >= 2 && dict.has(mot)) {
        const cle = `${li}|${((s % n) + n) % n}|${mot}|${blancs.join(",")}`;
        if (!vus.has(cle)) {
          vus.add(cle);
          const move = { ligne: li, debut: L.cyclique ? ((s % n) + n) % n : s, word: mot, blanks: blancs.slice() };
          const r = scoreCube(cube, move, dict, { bonuses });
          if (!r.errors.length) cands.push({ score: r.score, move, words: r.words, placedCount: r.placed.length });
        }
      }
    };
    if (!cs) { fin(); return; }
    const ex = caseDe(cube, cs);
    if (ex) {
      const m2 = mot + ex.letter;
      if (!dict.hasPrefix(m2)) return;
      etend(li, L, s, k + 1, m2, reste, blancs, poses, couvre || k === a, a);
      return;
    }
    fin();   // la case suivante est vide : le mot peut s'arrêter ici
    if (poses >= maxTiles || !reste.length) return;
    const ok = permis(cs, L.dir), essayes = new Set();
    for (let i = 0; i < reste.length; i++) {
      const t = reste[i];
      const lettres = t === "?" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") : [t];
      for (const l of lettres) {
        const cle = (t === "?" ? "?" : "") + l;
        if (essayes.has(cle)) continue;
        essayes.add(cle);
        if (ok && !ok.has(l)) continue;
        const m2 = mot + l;
        if (!dict.hasPrefix(m2)) continue;
        const r2 = reste.slice(0, i).concat(reste.slice(i + 1));
        etend(li, L, s, k + 1, m2, r2, t === "?" ? blancs.concat(mot.length) : blancs, poses + 1, couvre || k === a, a);
      }
    }
  }
  cands.sort((x, y) => y.score - x.score);
  return cands;
}

/** Top (tiré au sort parmi les isotops). */
export function topCube(cube, rack, dict, opts = {}) {
  const all = coupsCube(cube, rack, dict, opts);
  if (!all.length) return null;
  const ex = all.filter(c => c.score === all[0].score);
  return { ...ex[Math.floor(Math.random() * ex.length)], isotops: ex.length, isotopWords: [...new Set(ex.map(c => c.move.word))] };
}

// ---------- génération d'une partie (tournoi) ----------
/** Partie duplicate complète sur le cube : [{ moveNo, rack, freshRack, kept, top }]. */
export async function genereCube(dict, { withJoker = false, onProgress = null } = {}) {
  const { drawForDuplicate, bagTotalVowels, bagTotalConsonants, LETTER_BAG } = await import("./engine.js?v=483");
  const VOY = new Set(["A", "E", "I", "O", "U", "Y"]);
  let bag = { ...LETTER_BAG }, spare = 0;
  if (withJoker) { spare = bag["?"] || 0; bag["?"] = 0; }
  let cube = cubeVide(), rack = [], moves = [], total = 0;
  for (let moveNo = 1; moveNo <= 60; moveNo++) {
    let v = bagTotalVowels(bag), c = bagTotalConsonants(bag);
    for (const t of rack) { if (t === "?") continue; if (VOY.has(t)) v++; else c++; }
    const jokers = (bag["?"] || 0) + rack.filter(t => t === "?").length, ys = (bag.Y || 0) + rack.filter(t => t === "Y").length;
    if ((v === 0 || c === 0) && !jokers && !ys) break;
    const forceJoker = withJoker && spare > 0 && !rack.includes("?");
    const kept = rack.slice();
    const res = drawForDuplicate(bag, kept, moveNo, forceJoker ? 6 : 7, {});
    if (res.failed) break;
    bag = res.bag;
    if (res.fresh) rack = rack.filter(t => t === "?");
    rack.push(...(res.drawn || []));
    if (forceJoker) rack.push("?");
    if (!rack.length) break;
    const top = topCube(cube, rack, dict, { maxTilesUsed: 7 });
    if (!top) break;
    const mv = top.move;
    moves.push({ moveNo, rack: rack.join(""), freshRack: !!res.fresh, kept: res.fresh ? "" : kept.join(""),
      top: { ligne: mv.ligne, debut: mv.debut, word: mv.word, blanks: mv.blanks, score: top.score, pos: positionCoup(mv), words: top.words.map(w => w.word) } });
    total += top.score;
    // lettres posées retirées du chevalet ; joker recyclé si sa lettre reste au sac (partie joker)
    casesDuCoup(mv).forEach((cs, i) => {
      if (caseDe(cube, cs)) return;
      const blanc = mv.blanks.includes(i);
      let k = rack.indexOf(blanc ? "?" : mv.word[i]);
      if (k < 0) k = rack.indexOf("?");
      if (k >= 0) rack.splice(k, 1);
      if (blanc && withJoker && spare > 0) { if (bag[mv.word[i]] > 0) { bag[mv.word[i]]--; moves[moves.length - 1].top.blanks = mv.blanks.filter(b => b !== i); } else spare--; }
    });
    cube = appliqueCoup(cube, { ...mv, blanks: moves[moves.length - 1].top.blanks });
    onProgress?.(moveNo);
  }
  return { moves, totalTopScore: total, cube };
}
