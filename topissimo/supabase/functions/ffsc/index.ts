// ============================================================
//  Edge Function Supabase : proxy + ingesteur FFSC (endirect)
//
//  Le navigateur ne peut pas appeler ffsc.fr (CORS). Cette fonction fait le
//  fetch côté serveur, parse, et renvoie du JSON à Topissimo.
//
//  Actions (query string `?action=`) :
//   • tournois                      → liste des tournois (id + nom)
//   • partie&tournoi=ID&numero=N    → la partie N parsée (moves Topissimo)
//   • raw&path=...                  → texte brut d'une page endirect (DEBUG,
//                                     restreint au domaine ffsc.fr/endirect)
//
//  Déploiement :
//     supabase functions deploy ffsc --no-verify-jwt
//  Appel :
//     https://<projet>.supabase.co/functions/v1/ffsc?action=tournois
// ============================================================

const BASE = "https://www.ffsc.fr/endirect/";
const UA = "Topissimo/2.0 (club La Garenna; analyse perso)";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function fetchFfsc(pathAndQuery: string): Promise<string> {
  const url = BASE + pathAndQuery.replace(/^\/+/, "");
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`FFSC ${res.status} sur ${url}`);
  // La FFSC sert en ISO-8859-1 / Windows-1252 → on décode explicitement
  // (sinon les accents des noms/labels sont cassés).
  const buf = await res.arrayBuffer();
  return new TextDecoder("windows-1252").decode(buf);
}

// ---------- Parsing de l'export TXT d'une partie ----------
// (cf. scrabble/ffsc-import.js — logique identique)
const ROW_LETTERS = "ABCDEFGHIJKLMNO";

function parseFfscPos(label: string) {
  if (!label) return null;
  const s = label.replace(/\s+/g, "").toUpperCase();
  let m = /^([A-O])(\d{1,2})$/.exec(s);
  if (m) return { row: ROW_LETTERS.indexOf(m[1]), col: (+m[2]) - 1, dir: "H" };
  m = /^(\d{1,2})([A-O])$/.exec(s);
  if (m) return { row: ROW_LETTERS.indexOf(m[2]), col: (+m[1]) - 1, dir: "V" };
  return null;
}

function parseWordWithJokers(raw: string) {
  const word: string[] = [];
  const blanks: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "(") {
      i++;
      while (i < raw.length && raw[i] !== ")") { blanks.push(word.length); word.push(raw[i].toUpperCase()); i++; }
      i++;
    } else if (/[A-Za-zÀ-ÿ]/.test(ch)) { word.push(ch.toUpperCase()); i++; }
    else i++;
  }
  return { word: word.join(""), blanks };
}

function parseRack(field: string) {
  let s = (field || "").trim();
  const freshRack = s.startsWith("-");
  if (freshRack) s = s.slice(1);
  let kept = "";
  if (s.includes("+")) { const [k, d] = s.split("+"); kept = (k || "").toUpperCase(); s = (k || "") + (d || ""); }
  return { letters: s.toUpperCase(), freshRack, kept };
}

function parseExport(txt: string) {
  const lines = String(txt).replace(/\r/g, "").split("\n");
  let scrabbleBonus = 50, modeLabel = "", mode = "duplicate";
  const rackByMove: Record<number, string> = {};
  const topByMove: Record<number, { wordRaw: string; pos: string; score: number }> = {};
  let maxMove = 0, lastNumbered = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (/prime de Scrabble/i.test(line)) { const m = /(\d+)/.exec(line); if (m) scrabbleBonus = +m[1]; continue; }
    if (!modeLabel && !/^\s*\d+\./.test(line) && !/\t/.test(line)) { modeLabel = line.trim(); continue; }
    const fields = line.split("\t");
    const f0 = (fields[0] || "").trim();
    const nm = /^(\d+)\.$/.exec(f0);
    if (nm) {
      const k = +nm[1]; lastNumbered = k; maxMove = Math.max(maxMove, k);
      const rackField = (fields[1] || "").trim();
      if (rackField) rackByMove[k] = rackField;
      const wordRaw = (fields[2] || "").trim();
      if (wordRaw && k - 1 >= 1) topByMove[k - 1] = { wordRaw, pos: (fields[3] || "").trim(), score: +(fields[4] || "0") };
    } else {
      const wordRaw = (fields[2] || "").trim();
      if (wordRaw) topByMove[lastNumbered] = { wordRaw, pos: (fields[3] || "").trim(), score: +(fields[4] || "0") };
    }
  }
  if (/7\s*sur\s*8/i.test(modeLabel)) mode = "7sur8";
  else if (/7\s*et\s*8/i.test(modeLabel)) mode = "7et8";
  else if (/7.?8.?9/i.test(modeLabel)) mode = "789";

  const moves = [];
  for (let m = 1; m <= maxMove; m++) {
    const rackField = rackByMove[m]; const top = topByMove[m];
    if (!rackField || !top) continue;
    const { letters, freshRack, kept } = parseRack(rackField);
    const { word, blanks } = parseWordWithJokers(top.wordRaw);
    const p = parseFfscPos(top.pos);
    if (!p) continue;
    moves.push({
      moveNo: m, rack: letters, freshRack, kept,
      top: { word, blanks, row: p.row, col: p.col, dir: p.dir, pos: top.pos.replace(/\s+/g, ""), score: top.score, words: [{ word, score: top.score }] },
    });
  }
  return { meta: { modeLabel, mode, scrabbleBonus, withJoker: false }, moves };
}

// ---------- Liste des tournois (index endirect) ----------
function parseTournois(html: string) {
  const out: { id: string; name: string }[] = [];
  const re = /endirect\.php\?tournoi_id=([^"'&]+)['"][^>]*>\s*([^<]+?)\s*</g;
  let m;
  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    const id = m[1].trim();
    const name = m[2].replace(/\s+/g, " ").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

// ---------- Feuille de route d'un joueur (page table) ----------
function htmlText(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

function parseRouteSheet(html: string, numero: number) {
  // En-tête : « Feuille de route de NOM Prénom (table 52, série 1B) »
  const h = /Feuille de route de\s*([^(]+?)\s*\(table\s*(\d+),\s*série\s*([^)]+)\)/i.exec(html);
  const player = h ? h[1].trim() : "";
  const table = h ? +h[2] : null;
  const serie = h ? h[3].trim() : "";

  // Tables par partie (liens de navigation en haut) + la partie courante.
  const tablesByPartie: Record<number, number> = {};
  if (table) tablesByPartie[numero] = table;
  const navRe = /numero=(\d+)[^'"]*?num_table=(\d+)/g;
  let nm;
  while ((nm = navRe.exec(html))) tablesByPartie[+nm[1]] = +nm[2];

  // Total final : « 856 / 930 » puis « -74 ».
  const tot = /<strong>\s*(\d+)\s*\/\s*(\d+)\s*<\/strong>/.exec(html);
  const total = tot ? +tot[1] : null;
  const topTotal = tot ? +tot[2] : null;

  // Lignes de coups.
  const coups: any[] = [];
  const rowRe = /<td class='first'>(\d+)<\/td>\s*<td class='([^']*)'>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td class='([^']*)'>([^<]*)<\/td>\s*<td class='last'>([^<]*)<\/td>/g;
  let r;
  while ((r = rowRe.exec(html))) {
    const no = +r[1];
    const status = r[2];                 // top | sous_top | zero
    const { word, blanks } = parseWordWithJokers(htmlText(r[3]));
    const scoreStr = r[4].trim();        // « 106 » ou « 36 / 39 » ou « 0 / 60 »
    const parts = scoreStr.split("/").map(x => x.trim());
    const playerScore = parts[0] ? +parts[0] : 0;
    const topScore = parts[1] ? +parts[1] : playerScore;
    const negStr = htmlText(r[6]);       // « Top » ou « -3 » ou « -60 »
    const neg = /^-?\d+$/.test(negStr) ? +negStr : 0;
    const remark = htmlText(r[7]);       // "" | « Zéro » | « Avertissement »
    coups.push({ moveNo: no, status, word, blanks, playerScore, topScore, neg, remark });
  }

  return { player, table, serie, total, topTotal, tablesByPartie, coups };
}

// ---------- Handler ----------
export default {
  async fetch(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    if (action === "tournois") {
      // L'index (liste par année) est à la RACINE du dossier endirect/, pas
      // sur endirect.php (qui exige un tournoi_id et renvoie une erreur sinon).
      const html = await fetchFfsc("");
      return json({ tournois: parseTournois(html) });
    }

    if (action === "partie") {
      const tournoi = url.searchParams.get("tournoi");
      const numero = url.searchParams.get("numero");
      if (!tournoi || !numero) return json({ error: "tournoi et numero requis" }, 400);
      const txt = await fetchFfsc(`endirect.parties.exporter.php?tournoi_id=${encodeURIComponent(tournoi)}&numero=${encodeURIComponent(numero)}`);
      return json(parseExport(txt));
    }

    if (action === "route") {
      const tournoi = url.searchParams.get("tournoi");
      const numero = +(url.searchParams.get("numero") || "0");
      const table = url.searchParams.get("table");
      const idt = url.searchParams.get("id_tournoi") || tournoi;
      if (!tournoi || !numero || !table) return json({ error: "tournoi, numero, table requis" }, 400);
      const html = await fetchFfsc(`endirect.php?tournoi_id=${encodeURIComponent(tournoi)}&page=parties&numero=${numero}&action=scores&num_table=${encodeURIComponent(table)}&id_tournoi=${encodeURIComponent(idt)}`);
      return json(parseRouteSheet(html, numero));
    }

    // DEBUG : passe-plat brut, restreint à endirect (pour développer les
    // parseurs HTML des pages résultats/scores/feuille de route).
    if (action === "raw") {
      const path = url.searchParams.get("path") || "";
      const ok = path === "" || /^endirect[.\w]*\.php(\?.*)?$/.test(path) || /^endirect\.parties\.exporter\.php(\?.*)?$/.test(path);
      if (!ok) return json({ error: "path non autorisé" }, 400);
      const txt = await fetchFfsc(path);
      return new Response(txt, { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
    }

    return json({ error: "action inconnue", actions: ["tournois", "partie", "route", "raw"] }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
  },
};
