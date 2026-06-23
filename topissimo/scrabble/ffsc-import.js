// ============================================================
//  Import de parties FFSC (endirect) → format Topissimo
//
//  Source : export TXT d'une partie
//  (endirect.parties.exporter.php?tournoi_id=…&numero=…)
//
//  SUBTILITÉ DU FORMAT : sur chaque ligne numérotée « k. », on trouve le
//  TIRAGE du coup k, mais le MOT / POSITION / SCORE imprimés sur cette ligne
//  sont ceux du TOP du coup PRÉCÉDENT (k‑1). Le top du dernier coup est sur
//  une ligne finale sans numéro. On recale donc systématiquement le top de N
//  sur le tirage de N (top lu sur la ligne N+1).
//
//  Notations :
//   • tirage « -XXXX »   → rejet (chevalet complet neuf) → freshRack = true
//   • tirage « AB+CDE »  → reliquat AB + lettres piochées CDE (le « + » sépare)
//   • « ? » dans le tirage → joker
//   • mot « DU(L)CIFIE » → la/les lettre(s) entre parenthèses = joker posé
//                           → word="DULCIFIE", blanks=[index du L]
//   • position FFSC : « H6 » (lettre puis chiffre) = horizontal ;
//                     « 10E » / « 7A » (chiffre puis lettre) = vertical.
// ============================================================

const ROW_LETTERS = "ABCDEFGHIJKLMNO";

// "H6"/"H 6" → {row,col,dir:"H"} ; "10E"/"7A" → {row,col,dir:"V"}.
export function parseFfscPos(label) {
  if (!label) return null;
  const s = label.replace(/\s+/g, "").toUpperCase();
  let m = /^([A-O])(\d{1,2})$/.exec(s);            // horizontal : lettre puis nombre
  if (m) return { row: ROW_LETTERS.indexOf(m[1]), col: (+m[2]) - 1, dir: "H" };
  m = /^(\d{1,2})([A-O])$/.exec(s);                // vertical : nombre puis lettre
  if (m) return { row: ROW_LETTERS.indexOf(m[2]), col: (+m[1]) - 1, dir: "V" };
  return null;
}

// "DU(L)CIFIE" → { word:"DULCIFIE", blanks:[2] }
export function parseWordWithJokers(raw) {
  const word = [];
  const blanks = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "(") {
      // lettre(s) entre parenthèses = joker(s)
      i++;
      while (i < raw.length && raw[i] !== ")") {
        blanks.push(word.length);
        word.push(raw[i]);
        i++;
      }
      i++; // sauter ")"
    } else if (/[A-Za-zÀ-ÿ]/.test(ch)) {
      word.push(ch.toUpperCase());
      i++;
    } else {
      i++; // espaces, etc.
    }
  }
  return { word: word.join(""), blanks };
}

// Normalise un champ tirage : retire « - » (rejet) et « + » (séparateur),
// renvoie { letters, freshRack, kept }.
function parseRack(field) {
  let s = (field || "").trim();
  const freshRack = s.startsWith("-");
  if (freshRack) s = s.slice(1);
  let kept = "";
  if (s.includes("+")) {
    const [k, drawn] = s.split("+");
    kept = (k || "").toUpperCase();
    s = (k || "") + (drawn || "");
  }
  return { letters: s.toUpperCase(), freshRack, kept };
}

// Parse l'export TXT complet → { meta, moves }.
//   moves[i] = { moveNo, rack, freshRack, kept,
//                top: { word, blanks, row, col, dir, pos, score, words } }
export function parseFfscExport(txt) {
  const lines = String(txt).replace(/\r/g, "").split("\n");
  let mode = "duplicate", scrabbleBonus = 50, modeLabel = "";

  // Tableaux indexés par n° de coup.
  const rackByMove = {};   // moveNo → champ tirage brut
  const topByMove = {};    // moveNo → { wordRaw, pos, score }
  let maxMove = 0;
  let lastNumbered = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    // En-tête
    if (/prime de Scrabble/i.test(line)) {
      const m = /(\d+)/.exec(line); if (m) scrabbleBonus = +m[1];
      continue;
    }
    const fields = line.split("\t");
    const f0 = (fields[0] || "").trim();
    const numMatch = /^(\d+)\.$/.exec(f0);

    if (numMatch) {
      const k = +numMatch[1];
      lastNumbered = k;
      maxMove = Math.max(maxMove, k);
      const rackField = (fields[1] || "").trim();
      if (rackField) rackByMove[k] = rackField;
      // Le mot sur cette ligne (s'il y en a un) est le TOP du coup k-1.
      const wordRaw = (fields[2] || "").trim();
      if (wordRaw && k - 1 >= 1) {
        topByMove[k - 1] = { wordRaw, pos: (fields[3] || "").trim(), score: +(fields[4] || "0") };
      }
    } else {
      // Ligne sans numéro : soit le top du DERNIER coup, soit le total final.
      const wordRaw = (fields[2] || "").trim();
      const scoreOnly = (fields[4] || fields[fields.length - 1] || "").trim();
      if (wordRaw) {
        topByMove[lastNumbered] = { wordRaw, pos: (fields[3] || "").trim(), score: +(fields[4] || "0") };
      } else if (/^\d+$/.test(scoreOnly)) {
        // total final → ignoré (déduit de la somme des tops)
      }
      // 1ʳᵉ ligne non vide = libellé du mode
      if (!modeLabel && !/^\s*\d+\./.test(line) && wordRaw === "") {
        modeLabel = line.trim();
      }
    }
  }
  if (!modeLabel && lines.length) modeLabel = lines[0].trim();
  // Déduction du mode Topissimo depuis le libellé (best effort).
  if (/7\s*sur\s*8/i.test(modeLabel)) mode = "7sur8";
  else if (/7\s*et\s*8/i.test(modeLabel)) mode = "7et8";
  else if (/7.?8.?9|7,\s*8\s*et\s*9/i.test(modeLabel)) mode = "789";

  const moves = [];
  for (let m = 1; m <= maxMove; m++) {
    const rackField = rackByMove[m];
    const top = topByMove[m];
    if (!rackField || !top) continue;  // coup incomplet (ne devrait pas arriver)
    const { letters, freshRack, kept } = parseRack(rackField);
    const { word, blanks } = parseWordWithJokers(top.wordRaw);
    const p = parseFfscPos(top.pos);
    if (!p) continue;
    moves.push({
      moveNo: m,
      rack: letters,
      freshRack,
      kept,
      top: {
        word, blanks,
        row: p.row, col: p.col, dir: p.dir,
        pos: top.pos.replace(/\s+/g, ""),
        score: top.score,
        words: [{ word, score: top.score }],
      },
    });
  }

  return {
    meta: { modeLabel, mode, scrabbleBonus, withJoker: false },
    moves,
  };
}
