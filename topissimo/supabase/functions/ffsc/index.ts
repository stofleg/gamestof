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

// Extraction de texte PDF (simultanés : tournois.exporter.parties.pdf.php).
import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";

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
  // Encodage VARIABLE selon l'endpoint : les pages HTML (endirect.php) sont en
  // UTF-8 (meta charset), l'export TXT (exporter.php) est en Latin-1/Windows-1252.
  // On détecte via l'en-tête, sinon via le meta charset, défaut Windows-1252.
  const buf = await res.arrayBuffer();
  let enc: string;
  if (/exporter\.php/i.test(pathAndQuery)) {
    // L'export TXT est en Latin-1 (mais parfois déclaré utf-8 à tort) → on force.
    enc = "windows-1252";
  } else {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    enc = (/charset=([\w-]+)/.exec(ct) || [])[1] || "";
    if (!enc) {
      const head = new TextDecoder("latin1").decode(buf.slice(0, 2048)).toLowerCase();
      enc = head.includes("charset=utf-8") ? "utf-8" : "windows-1252";
    }
  }
  try { return new TextDecoder(enc).decode(buf); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

// ---------- FISF (classement.fisf.net) : palmarès joueur ----------
// La fiche joueur est à /joueurs/details/11/<licence>.html (11 = fédération FR).
const FISF_BASE = "https://classement.fisf.net/";
async function fetchFisf(pathAndQuery: string): Promise<string> {
  const url = FISF_BASE + pathAndQuery.replace(/^\/+/, "");
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`FISF ${res.status} sur ${url}`);
  return new TextDecoder("utf-8").decode(await res.arrayBuffer());
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
  const out: { id: string; name: string; year: number | null }[] = [];
  // Parcours séquentiel : un en-tête « Année 2026 » fixe l'année courante ; les
  // liens de tournois qui suivent en héritent (l'index FFSC est un accordéon
  // groupé par année, en ordre décroissant).
  const re = /Ann.e\s*(\d{4})|endirect\.php\?tournoi_id=([^"'&]+)['"][^>]*>\s*([^<]+?)\s*</g;
  let m;
  let currentYear: number | null = null;
  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    if (m[1]) { currentYear = +m[1]; continue; }
    const id = (m[2] || "").trim();
    const name = (m[3] || "").replace(/\s+/g, " ").trim();
    if (!id) continue;
    if (seen.has(id)) {
      // Déjà vu (section « à la une » sans année en haut) : si on le retrouve
      // sous un en-tête d'année, on complète son année.
      const ex = out.find((t) => t.id === id);
      if (ex && ex.year == null && currentYear != null) ex.year = currentYear;
      continue;
    }
    seen.add(id);
    out.push({ id, name, year: currentYear });
  }
  // Repli : pour les tournois sans année (section « à la une » non répétée),
  // tenter de déduire l'année d'un « 20xx » présent dans l'id ou le nom.
  for (const t of out) {
    if (t.year == null) {
      const g = /20\d{2}/.exec(t.id) || /20\d{2}/.exec(t.name);
      if (g) t.year = +g[0];
    }
  }
  return out;
}

// ---------- Feuille de route d'un joueur (page table) ----------
function htmlText(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

function parseRouteSheet(html: string, numero: number) {
  // En-tête : « Feuille de route de NOM Prénom (table 52, série 1B) »
  // Tolérant à l'accent (série) et à l'encodage : on capture nom + table, puis
  // la série (forme « 1B », « 5D ») dans le reste, où qu'elle soit.
  const h = /Feuille de route de\s*([^(]+?)\s*\(table\s*(\d+)([^)]*)\)/i.exec(html);
  const player = h ? h[1].trim() : "";
  const table = h ? +h[2] : null;
  const serie = h ? ((/(\d[A-Z])/.exec(h[3]) || [])[1] || "") : "";

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

// ---------- FISF : palmarès d'un joueur (fiche details) ----------
// Les lignes du tableau Fabrik rendu : <tr id="list_25_com_fabrik_25_row_NNN">
// avec des <td class="tic_result_epreuve___CHAMP ...">valeur</td>.
function parseFisfPalmares(html: string) {
  const nm = /<h2>\s*([^<]+?)\s*<\/h2>/.exec(html);
  const player = nm ? nm[1].replace(/\s+/g, " ").trim() : "";

  const tournois: any[] = [];
  const seen = new Set<number>();
  const rowRe = /<tr id="list_25_com_fabrik_25_row_\d+"[^>]*>([\s\S]*?)<\/tr>/g;
  let r;
  while ((r = rowRe.exec(html))) {
    const row = r[1];
    const ep = /\/duplicate-epreuves\/details\/21\/(\d+)\.html">([\s\S]*?)<\/a>/.exec(row);
    if (!ep) continue;
    const fisfId = +ep[1];
    if (seen.has(fisfId)) continue;
    seen.add(fisfId);
    const date = (/dateEpreuve[^"]*"\s*>\s*([0-3]?\d-[01]?\d-\d{4})/.exec(row) || [])[1] || "";
    const place = (/___iPlace[^"]*"\s*>\s*(\d+)/.exec(row) || [])[1];
    const neg = (/___iScore0[^"]*"\s*>\s*(-?\d+)/.exec(row) || [])[1];
    const serie = (/___Serie[^"]*"\s*>\s*([0-9][A-Z]?)/.exec(row) || [])[1] || "";
    const calYear = date ? +date.slice(6) : null;   // année civile (dd-mm-YYYY)
    const mo = date ? +date.slice(3, 5) : 0;
    const saisonStart = calYear ? (mo >= 9 ? calYear : calYear - 1) : null;
    tournois.push({
      fisfId,
      name: htmlText(ep[2]).replace(/\s+/g, " ").trim(),
      date,
      year: calYear,   // pour le recoupement avec l'index endirect (par année civile)
      saison: saisonStart ? `${saisonStart}-${saisonStart + 1}` : "",
      place: place != null ? +place : null,
      neg: neg != null ? +neg : null,
      serie,
    });
  }
  return { player, tournois };
}

// ---------- Simultanés : PDF des parties (tournois.exporter.parties.pdf.php) ----------
// Même structure que l'export endirect, mais en PDF et séparé par espaces :
//   « N. TIRAGE  MOT  POS  SCORE  [remarque] » — le MOT est le top du coup N-1,
//   le top du dernier coup est sur une ligne finale sans numéro, puis le total.
function deburr(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Page HTML du site principal ffsc.fr (hors endirect), en UTF-8.
async function fetchFfscPage(path: string): Promise<string> {
  const res = await fetch("https://www.ffsc.fr/" + path.replace(/^\/+/, ""), { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`FFSC ${res.status} sur ${path}`);
  return new TextDecoder("utf-8").decode(await res.arrayBuffer());
}

// Liste des tournois d'une année (tournois.php?annee=YYYY) avec leur DATE.
// Structure : <li class='date_tournoi'>Dim 04/01</li> puis
//             <li class='nom_tournoi'>… <a href='tournois.php?id=N'>NOM</a> …</li>
// L'id numérique de tournois.php est aussi l'id endirect du tournoi.
function parseTournoisFfsc(html: string, annee: string) {
  const out: { id: number; name: string; date: string | null }[] = [];
  let cur: string | null = null;
  const re = /<li class='date_tournoi'>\s*[A-Za-zÀ-ÿ.]+\s*(\d{2})\/(\d{2})|tournois\.php\?id=(\d+)'[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) cur = `${m[1]}-${m[2]}-${annee}`;
    else if (m[3]) out.push({ id: +m[3], name: htmlText(m[4]), date: cur });
  }
  return out;
}

async function fetchFfscPdfText(pathAndQuery: string): Promise<string[]> {
  const url = "https://www.ffsc.fr/" + pathAndQuery.replace(/^\/+/, "");
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`FFSC PDF ${res.status} sur ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

const SPOS = "(?:[A-O]\\s?\\d{1,2}|\\d{1,2}\\s?[A-O])";
function parseSimuPartie(text: string) {
  // Le point après le numéro est optionnel : « 12. RACK… » (simultanés) ou
  // « 12 RACK… » (interclubs).
  const reNum = new RegExp("^\\s*(\\d+)\\.?\\s+(\\S+)(?:\\s+(\\S+)\\s+(" + SPOS + ")\\s+(\\d+)(?:\\s+(.*))?)?\\s*$");
  const reTail = new RegExp("^\\s*(\\S+)\\s+(" + SPOS + ")\\s+(\\d+)\\s*$");
  const rack: Record<number, string> = {};
  const top: Record<number, { w: string; pos: string; sc: number }> = {};
  let maxm = 0, last = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const m = reNum.exec(line);
    if (m) {
      const k = +m[1]; last = k; maxm = Math.max(maxm, k);
      rack[k] = m[2];
      if (m[3] && k - 1 >= 1) top[k - 1] = { w: m[3], pos: m[4], sc: +m[5] };
      continue;
    }
    const t = reTail.exec(line);
    if (t && last) top[last] = { w: t[1], pos: t[2], sc: +t[3] };
  }
  const moves = [];
  for (let k = 1; k <= maxm; k++) {
    if (!rack[k] || !top[k]) continue;
    const { letters, freshRack, kept } = parseRack(rack[k]);
    const { word, blanks } = parseWordWithJokers(deburr(top[k].w));
    const p = parseFfscPos(top[k].pos);
    if (!p) continue;
    moves.push({
      moveNo: k, rack: letters, freshRack, kept,
      top: { word, blanks, row: p.row, col: p.col, dir: p.dir, pos: top[k].pos.replace(/\s+/g, ""), score: top[k].sc, words: [{ word, score: top[k].sc }] },
    });
  }
  return { meta: { mode: "duplicate", withJoker: false }, moves };
}

// ---------- Page des scores : table ↔ joueur ----------
function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

function parseScores(html: string) {
  const out: { table: number; idTournoi: number | null; name: string }[] = [];
  // Liens « ...num_table=N&amp;id_tournoi=T">NOM Prénom</a> »
  const re = /num_table=(\d+)&amp;id_tournoi=(\d+)"[^>]*>\s*([^<]+?)\s*<\/a>/g;
  let m;
  const seen = new Set<number>();
  while ((m = re.exec(html))) {
    const table = +m[1];
    if (seen.has(table)) continue;
    seen.add(table);
    out.push({ table, idTournoi: +m[2], name: htmlText(m[3]) });
  }
  return out;
}

function findPlayer(scores: { table: number; idTournoi: number | null; name: string }[], query: string) {
  const q = normName(query);
  const matches = scores.filter((s) => normName(s.name).includes(q));
  const exact = scores.find((s) => normName(s.name) === q);
  return { hit: exact || matches[0] || null, matches };
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

    if (action === "import") {
      const tournoi = url.searchParams.get("tournoi");
      const nom = url.searchParams.get("nom");
      if (!tournoi || !nom) return json({ error: "tournoi et nom requis" }, 400);
      const enc = encodeURIComponent;
      // 1) table du joueur en partie 1 (page des scores : table ↔ joueur).
      const scoresHtml = await fetchFfsc(`endirect.php?tournoi_id=${enc(tournoi)}&page=parties&numero=1&coup=1&action=scores&tri=table`);
      const { hit, matches } = findPlayer(parseScores(scoresHtml), nom);
      if (!hit) return json({ error: "joueur introuvable", candidats: matches.slice(0, 12).map((s) => s.name) }, 404);
      const idt = hit.idTournoi || +tournoi;
      // 2) feuille de route partie 1 → tables de toutes les parties + coups.
      const route1 = parseRouteSheet(
        await fetchFfsc(`endirect.php?tournoi_id=${enc(tournoi)}&page=parties&numero=1&action=scores&num_table=${hit.table}&id_tournoi=${idt}`), 1);
      const tables = route1.tablesByPartie;
      // 3) chaque partie : export (tirages+tops) + feuille de route (négatifs).
      const parties = [];
      for (const numStr of Object.keys(tables).sort((a, b) => +a - +b)) {
        const numero = +numStr;
        const table = tables[numero];
        const game = parseExport(await fetchFfsc(`endirect.parties.exporter.php?tournoi_id=${enc(tournoi)}&numero=${numero}`));
        const route = numero === 1 ? route1
          : parseRouteSheet(await fetchFfsc(`endirect.php?tournoi_id=${enc(tournoi)}&page=parties&numero=${numero}&action=scores&num_table=${table}&id_tournoi=${idt}`), numero);
        parties.push({ numero, table, meta: game.meta, moves: game.moves, coups: route.coups, total: route.total, topTotal: route.topTotal });
      }
      return json({ player: route1.player, serie: route1.serie, tournoi, parties });
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

    // Liste datée des tournois d'une année (tournois.php) → matching par date.
    // ?action=tournois_ffsc&annee=2026
    if (action === "tournois_ffsc") {
      const annee = url.searchParams.get("annee");
      if (!annee || !/^\d{4}$/.test(annee)) return json({ error: "annee (YYYY) requise" }, 400);
      const html = await fetchFfscPage(`tournois.php?annee=${annee}`);
      return json({ annee: +annee, tournois: parseTournoisFfsc(html, annee) });
    }

    // Simultanés : parties depuis le PDF officiel (id = id FFSC du tournoi).
    // ?action=simu&id=20294   (&raw=1 → renvoie le texte PDF extrait, debug)
    if (action === "simu") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id requis" }, 400);
      const pages = await fetchFfscPdfText(`tournois.exporter.parties.pdf.php?id_tournoi=${encodeURIComponent(id)}`);
      if (url.searchParams.get("raw")) return json({ id, pages });
      // Les premières pages sont des consignes (0 coup) → filtrées ; on
      // renumérote les parties restantes séquentiellement (1, 2, …).
      const parties = pages
        .map((t) => parseSimuPartie(t))
        .filter((r) => r.moves.length)
        .map((r, i) => ({ numero: i + 1, meta: r.meta, moves: r.moves, topTotal: r.moves.reduce((s, m) => s + (m.top.score || 0), 0) }));
      return json({ id, parties });
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

    // FISF : palmarès d'un joueur (par n° de licence) → JSON.
    // ?action=fisf&licence=2231415  (pays=11 par défaut = France)
    if (action === "fisf") {
      const licence = url.searchParams.get("licence");
      const pays = url.searchParams.get("pays") || "11";
      if (!licence) return json({ error: "licence requise" }, 400);
      const enc = encodeURIComponent;
      const base = `joueurs/details/${enc(pays)}/${enc(licence)}.html`;
      // Le tableau est paginé (50/page). On récupère les 2 premières pages
      // (≈100 tournois, largement suffisant) et on fusionne.
      const [h1, h2] = await Promise.all([
        fetchFisf(base),
        fetchFisf(`${base}?limitstart25=50`).catch(() => ""),
      ]);
      const p1 = parseFisfPalmares(h1);
      const p2 = h2 ? parseFisfPalmares(h2) : { player: "", tournois: [] };
      const seen = new Set(p1.tournois.map((t: any) => t.fisfId));
      for (const t of p2.tournois) if (!seen.has(t.fisfId)) p1.tournois.push(t);
      return json({ player: p1.player, licence, tournois: p1.tournois });
    }

    // FISF : palmarès brut d'un joueur (DEBUG, le temps d'écrire le parseur).
    // ?action=fisf_raw&licence=2231415  → HTML de la fiche FISF
    // ?action=fisf_raw&path=...          → autre page fisf (restreint au domaine)
    if (action === "fisf_raw") {
      const licence = url.searchParams.get("licence");
      const pays = url.searchParams.get("pays") || "11";
      let path = url.searchParams.get("path") || "";
      if (licence) path = `joueurs/details/${encodeURIComponent(pays)}/${encodeURIComponent(licence)}.html`;
      if (!/^[\w./?=&%+-]*$/.test(path)) return json({ error: "path non autorisé" }, 400);
      const txt = await fetchFisf(path);
      return new Response(txt, { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
    }

    return json({ error: "action inconnue", actions: ["tournois", "tournois_ffsc", "partie", "route", "import", "fisf", "simu", "raw", "fisf_raw"] }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
  },
};
