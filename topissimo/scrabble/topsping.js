// ============================================================
//  TopSping : tournoi façon Roland-Garros, joué contre le top.
//  Page autonome (comme Jigsaw) : topsping.html?prepared=<id>.
//  Les règles de score (jeux, sets, tie-break, tableau) sont dans topsping-regles.js ;
//  ici : affichage, saisie du mot, chrono, pauses et enregistrement.
//
//  Enregistrement (prepared_game_results, une ligne par joueur) :
//   • en cours : paused = { ts: état, enCours: { debut } } (enCours = un coup est affiché :
//     quitter la page pendant un coup le fait compter comme raté à la reprise) ;
//   • terminé  : paused = null, summary.ts = { niveau, rates, neg, ab, vainqueur, matchs }.
//  stof en mode admin : mode test, rien n'est envoyé au serveur (état dans le navigateur).
// ============================================================
import { GAME_MODES, BOARD_SIZE, CENTER, emptyBoard, applyMove, scoreMove, letterValue } from "./engine.js?v=483";
import { chargeDico, classeCase, fmt, melange } from "./grille-finale.js?v=483";
import {
  TOURS, TEMPS_COUP, nouveauTournoi, nouvellePartie, jouerPoint, scoreJeu, niveauAtteint, nomNiveau,
} from "./topsping-regles.js?v=483";

const $ = id => document.getElementById(id);
const PARAMS = new URLSearchParams(location.search);
const PREPARED_ID = PARAMS.get("prepared");
const ADMIN = (localStorage.getItem("currentPseudo") || "").toLowerCase() === "stof"
  && localStorage.getItem("topissimo:superadmin") === "1";
const CLE_TEST = "topsping:test";
const PAUSE_REVELATION_OK = 1600, PAUSE_REVELATION_KO = 3800;   // ms d'affichage du top avant le coup suivant

let dict = null;
let serveur = null;        // { sb, partie, pid } en tournoi (null en mode test)
let reserveNom = "ts1";
const reserves = {};       // tour → tableau de parties
let e = null;              // état du tournoi (topsping-regles.js)

// --- coup en cours ---
let coup = null;           // { donnees, board, rack:[{id,letter,used}], top, debut, meilleur, fini }
let curseur = null;        // { row, col, dir }
let poses = [];            // [{ row, col, letter, isBlank, id }]
let minuteur = null;
let pauseDemandee = false;
let revelation = null;     // coup du top affiché en fin de coup

// ------------------------------------------------------------ chargement
async function chargeSupabase() {
  const script = src => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  if (!window.SUPABASE_URL) await script("../config.js");
  if (!window.supabase) await script("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js");
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  await sb.auth.getSession();
  return sb;
}

async function reserveDuTour(t) {
  if (!reserves[t]) {
    const r = await fetch(`../topsping/${reserveNom}/tour-${t + 1}.json?v=483`);
    if (!r.ok) throw new Error(`parties du ${TOURS[t].nom} introuvables`);
    reserves[t] = (await r.json()).parties;
  }
  return reserves[t];
}

// ------------------------------------------------------------ sauvegarde
async function sauve(enCours = null) {
  const paused = { ts: e, enCours };
  if (!serveur) { try { localStorage.setItem(CLE_TEST, JSON.stringify(paused)); } catch {} return true; }
  const { sb, partie, pid } = serveur;
  const { error } = await sb.from("prepared_game_results").upsert({
    prepared_game_id: partie.id, player_id: pid,
    total_score: e.stats.points, sum_neg: e.stats.neg, total_time_seconds: Math.round(e.stats.temps),
    details: [], summary: null, paused,
    played_on_mobile: matchMedia("(max-width: 700px)").matches,
  }, { onConflict: "prepared_game_id,player_id" });
  if (error) { message(`⚠️ Sauvegarde impossible : ${error.message}`, "ko"); return false; }
  return true;
}

function resume() {
  return { niveau: niveauAtteint(e), rates: e.stats.rates, neg: e.stats.neg, ab: e.abandon, vainqueur: e.vainqueur, matchs: e.matchs };
}

async function sauveFin() {
  if (!serveur) { try { localStorage.setItem(CLE_TEST, JSON.stringify({ ts: e, fin: true })); } catch {} return true; }
  const { sb, partie, pid } = serveur;
  const ts = resume();
  const { error } = await sb.from("prepared_game_results").upsert({
    prepared_game_id: partie.id, player_id: pid,
    total_score: e.stats.points, sum_neg: e.stats.neg, total_time_seconds: Math.round(e.stats.temps),
    details: [{ moveNo: 1, status: e.abandon ? "giveup" : "top", playerScore: e.stats.points, neg: e.stats.neg, timeMs: Math.round(e.stats.temps * 1000), top: null, topsping: true, v: 2 }],
    summary: { v: 1, mv: [1], tp: [], ab: e.abandon, topsping: true, ts },
    paused: null,
    played_on_mobile: matchMedia("(max-width: 700px)").matches,
  }, { onConflict: "prepared_game_id,player_id" });
  if (error) { message(`⚠️ Résultat non enregistré : ${error.message}`, "ko"); return false; }
  return true;
}

// ------------------------------------------------------------ affichage
function message(html, cls = "") { const m = $("message"); m.innerHTML = html; m.className = cls; }

function afficheTableau() {
  $("tsTableau").innerHTML = TOURS.map((t, i) => {
    const cls = (e.vainqueur || i < e.tour) ? "fait" : (i === e.tour && !e.fini ? "encours" : "");
    return `<span class="${cls}" title="${t.nom} : ${t.formule}">${t.court}</span>`;
  }).join("");
  const t = TOURS[Math.min(e.tour, TOURS.length - 1)];
  $("tsTour").textContent = e.vainqueur ? "Vainqueur !" : `${t.nom} · ${t.formule}`;
}

function afficheScore() {
  const m = e.match, [pj, po] = scoreJeu(m.jeu);
  const sets = m.sets.map(([a, b]) => [a, b]);
  const nb = Math.max(sets.length, 0);
  const ligne = (nom, cote) => {
    let h = `<td class="nom">${nom}</td>`;
    for (let i = 0; i < nb; i++) { const [a, b] = sets[i]; const v = cote ? a : b; h += `<td class="set${(cote ? a > b : b > a) ? " gagne" : ""}">${v}</td>`; }
    if (!e.fini) h += `<td class="jeuxcourants">${cote ? m.set.j : m.set.o}</td><td class="points">${cote ? pj : po}</td>`;
    return `<tr>${h}</tr>`;
  };
  let entete = `<td></td>${sets.map((_, i) => `<td>Set ${i + 1}</td>`).join("")}`;
  if (!e.fini) entete += `<td>Set ${nb + 1}</td><td>${m.jeu.tb ? "Tie-break" : "Jeu"}</td>`;
  $("tsScore").innerHTML = `<table><tr class="entete">${entete}</tr>${ligne("Vous", true)}${ligne("Le top", false)}</table>`;
}

function afficheStats() {
  const s = e.stats;
  $("tsStats").innerHTML = `<div><small>Tops trouvés</small>${s.points}</div><div><small>Tops ratés</small>${s.rates}</div>`
    + `<div><small>Négatif</small>${s.neg}</div>`;
}

function caseTuile(r, c) {
  const p = poses.find(x => x.row === r && x.col === c);
  if (p) return { ...p, pose: true };
  if (revelation && coup) {
    const { word, row, col, dir, blanks } = revelation;
    const dr = dir === "V" ? 1 : 0, dc = dir === "H" ? 1 : 0;
    for (let i = 0; i < word.length; i++) if (row + i * dr === r && col + i * dc === c && !coup.board[r][c]) return { letter: word[i], isBlank: blanks.includes(i), top: true };
  }
  return coup?.board[r][c] || null;
}

function afficheGrille() {
  let h = "<table>";
  for (let r = 0; r < BOARD_SIZE; r++) {
    h += "<tr>";
    for (let c = 0; c < BOARD_SIZE; c++) {
      const t = caseTuile(r, c), cls = [classeCase(r, c)];
      if (t) cls.push("has-tile");
      if (t?.pose) cls.push("pending-cell");
      if (t?.top) cls.push("ts-top");
      if (!revelation && curseur && curseur.row === r && curseur.col === c) cls.push("cursor", curseur.dir === "H" ? "dir-h" : "dir-v");
      const tuile = t ? `<div class="tile${t.isBlank ? " blank" : ""}">${t.letter}<span class="val">${t.isBlank ? "" : letterValue(t.letter)}</span></div>` : "";
      h += `<td class="${cls.join(" ")}" data-r="${r}" data-c="${c}">${tuile}</td>`;
    }
    h += "</tr>";
  }
  $("board").innerHTML = h + "</table>";
}

function afficheChevalet() {
  document.documentElement.style.setProperty("--rack-size", String(GAME_MODES[TOURS[e.tour].mode].rackSize));
  if (!coup) { $("rack").innerHTML = ""; return; }
  $("rack").innerHTML = coup.rack.map(t => {
    const blank = t.letter === "?";
    return `<div class="tile${t.used ? " used" : ""}${blank ? " blank" : ""}" data-id="${t.id}">${t.letter}<span class="val">${blank ? "" : letterValue(t.letter)}</span></div>`;
  }).join("");
}

function afficheTout() { afficheTableau(); afficheScore(); afficheStats(); afficheGrille(); afficheChevalet(); }

function afficheChrono() {
  if (!coup) return;
  const reste = coup.fini ? coup.reste : Math.max(0, TEMPS_COUP - (Date.now() - coup.debut) / 1000);
  $("tsChrono").textContent = Math.ceil(reste);
  $("tsChrono").classList.toggle("urgent", reste <= 10);
  $("tsBarre").style.width = `${(100 * reste) / TEMPS_COUP}%`;
}

// ------------------------------------------------------------ écrans (règles, pauses, fin)
function ecran(html, boutons) {
  return new Promise(ok => {
    $("tsEcranBoite").innerHTML = html + `<div class="ligne">${boutons.map((b, i) => `<button class="ts-btn${i ? "" : " plein"}" style="${i ? "color:var(--vert-rg);border-color:var(--vert-rg)" : ""}" data-i="${i}" type="button">${b}</button>`).join("")}</div>`;
    $("tsEcran").hidden = false;
    $("tsEcranBoite").querySelectorAll("button").forEach(b => b.onclick = () => { $("tsEcran").hidden = true; ok(+b.dataset.i); });
    $("tsEcranBoite").querySelector("button")?.focus();
  });
}

const urlTournoi = () => serveur?.partie.tournament_id ? `../index.html#tid=${serveur.partie.tournament_id}` : "../index.html";

const REGLES_HTML = `<h2>🎾 TopSping</h2>
<ul>
  <li>Vous affrontez <strong>le top</strong> : <strong>40 s</strong> par coup au maximum, le coup s'arrête dès que vous trouvez le top.</li>
  <li>Top trouvé : le point est pour vous ; raté : le point est pour le top.</li>
  <li>Jeu en 15, 30, 40, jeu (avantage à 40-40). Set en 6 jeux avec 2 d'écart, tie-break en 7 points à 6-6. Match en <strong>3 sets gagnants</strong>.</li>
  <li>Chaque jeu se joue sur une nouvelle partie : à partir du coup 1 au 1er set, du coup 5 au 2e set, du coup 9 au 3e…</li>
  <li>7 tours : 1er tour (Normale), 2e tour (Joker), 16es (7 sur 8), 8es (7 sur 8 joker), quarts (7 et 8), demie (7 et 8 joker), finale (7, 8 et 9).</li>
  <li>Un match perdu, ou un abandon, termine votre tournoi. Classement : tour atteint, puis tops ratés, puis négatif.</li>
  <li>Pauses : bouton Pause (prise à la fin du coup), changements de côté, fins de set et entre les matchs. Vous pouvez quitter pendant une pause et revenir plus tard ; quitter pendant un coup le fait compter comme raté.</li>
</ul>`;

async function ecranPause(titre, texte) {
  afficheTout();
  const choix = await ecran(`<h2>${titre}</h2><p>${texte}</p>`, ["Reprendre", "Quitter (reprendre plus tard)"]);
  if (choix === 1) { location.href = ADMIN && !serveur ? "../index.html" : urlTournoi(); return new Promise(() => {}); }
}

const AVEC_ARTICLE = ["le 1er tour", "le 2e tour", "les 16es de finale", "les 8es de finale", "les quarts de finale", "la demi-finale", "la finale"];
const ELIMINE = ["au 1er tour", "au 2e tour", "en 16es de finale", "en 8es de finale", "en quarts de finale", "en demi-finale", "en finale"];
function texteSets(sets) { return sets.map(([a, b]) => `${a}-${b}`).join(" ; "); }

async function ecranFin() {
  afficheTout();
  $("tsPause").hidden = $("tsAbandon").hidden = true;
  coup = null; revelation = null; afficheChevalet();
  const n = niveauAtteint(e), dernier = e.matchs[e.matchs.length - 1];
  const titre = e.vainqueur ? "🏆 Vous remportez TopSping !" : e.abandon ? "Abandon" : `Éliminé ${ELIMINE[e.tour]}`;
  const detail = e.vainqueur ? `Finale gagnée ${texteSets(dernier.sets)}.`
    : e.abandon ? `Votre tournoi s'arrête : ${nomNiveau(n)} atteint.`
    : dernier ? `Match perdu ${texteSets(dernier.sets)}.` : "";
  message(`${titre}`, e.vainqueur ? "ok" : "");
  await ecran(`<h2>${titre}</h2><p>${detail}</p><p>Niveau atteint : <strong>${nomNiveau(n)}</strong><br>Tops ratés : <strong>${e.stats.rates}</strong> · Négatif : <strong>${e.stats.neg}</strong></p>`, ["Retour au tournoi"]);
  location.href = serveur ? urlTournoi() : "../index.html";
}

// ------------------------------------------------------------ déroulement
async function demarreCoup(info = "") {
  const reserve = await reserveDuTour(e.tour);
  if (e.partie === null) nouvellePartie(e, reserve);
  const partie = reserve[e.partie];
  let board = emptyBoard();
  for (let i = 0; i < e.coup; i++) { const [, word, row, col, dir, blanks] = partie[i]; board = applyMove(board, { word, row, col, dir, blanks }); }
  const [tirage, word, row, col, dir, blanks, score] = partie[e.coup];
  coup = {
    board, top: { word, row, col, dir, blanks, score }, debut: Date.now(), meilleur: 0, fini: false,
    rack: melange([...tirage].map((letter, id) => ({ id, letter, used: false }))),
  };
  poses = []; revelation = null;
  // 1er coup : curseur sur l'étoile ; ensuite, le joueur touche la case de départ de son mot.
  curseur = board[CENTER][CENTER] ? null : { row: CENTER, col: CENTER, dir: "H" };
  afficheTout();
  message(`${info ? info + "<br>" : ""}Coup ${e.coup + 1} de la partie ${e.partie + 1} · top : <strong>${score}</strong> points`);
  if (!(await sauve({ debut: coup.debut }))) return;
  clearInterval(minuteur);
  minuteur = setInterval(() => {
    afficheChrono();
    if (!coup.fini && Date.now() - coup.debut >= TEMPS_COUP * 1000) finCoup(false);
  }, 200);
  afficheChrono();
}

function finCoup(gagne) {
  if (!coup || coup.fini) return;
  coup.fini = true;
  const ecoule = Math.min(TEMPS_COUP, (Date.now() - coup.debut) / 1000);
  coup.reste = TEMPS_COUP - ecoule;
  clearInterval(minuteur);
  const s = e.stats;
  s.coups++; s.temps += ecoule;
  if (gagne) s.points++; else { s.rates++; s.neg += coup.meilleur - coup.top.score; }
  revelation = gagne ? null : coup.top;
  if (!gagne) poses = [];
  afficheChrono(); afficheGrille(); afficheStats();
  const t = coup.top;
  message(gagne ? `✅ Top trouvé : <strong>${t.word}</strong> (${t.score}) en ${Math.round(ecoule)} s. Point pour vous !`
    : `❌ Temps écoulé. Le top était <strong>${t.word}</strong> (${t.score})${coup.meilleur ? `, votre meilleur coup : ${coup.meilleur}` : ""}. Point pour le top.`, gagne ? "ok" : "ko");
  setTimeout(() => apresCoup(gagne), gagne ? PAUSE_REVELATION_OK : PAUSE_REVELATION_KO);
}

async function apresCoup(gagne) {
  const tourAvant = e.tour;
  const ev = jouerPoint(e, gagne, reserves[tourAvant]);   // le coup fini reste affiché pendant les pauses
  if (ev.tournoi) { await sauveFin(); return ecranFin(); }
  if (!(await sauve())) return;
  let info = "";
  if (ev.match) {
    const m = e.matchs[e.matchs.length - 1];
    $("tsPause").classList.remove("pause-demandee"); pauseDemandee = false;
    await ecranPause(`🎉 Qualifié pour ${AVEC_ARTICLE[e.tour]}`,
      `${TOURS[tourAvant].nom} gagné ${texteSets(m.sets)}.<br>Prochain match : <strong>${TOURS[e.tour].nom}</strong>, en ${TOURS[e.tour].formule}.`);
    return demarreCoup();
  }
  if (ev.jeu) {
    const m = e.match;
    info = ev.set ? `Set ${m.sets.length} ${ev.gagneJeu ? "pour vous" : "pour le top"} (${texteSets(m.sets.slice(-1))}). Sets : ${m.setsJ}-${m.setsO}.`
      : `Jeu ${ev.gagneJeu ? "pour vous" : "pour le top"} : ${m.set.j}-${m.set.o}.${m.jeu.tb ? " Tie-break !" : ""}`;
  }
  if (pauseDemandee || ev.cote || ev.set) {
    const titre = pauseDemandee ? "⏸ Pause" : ev.set ? "Fin du set" : "Changement de côté";
    pauseDemandee = false; $("tsPause").classList.remove("pause-demandee"); $("tsPause").textContent = "⏸ Pause";
    await ecranPause(titre, info || "Reprenez quand vous voulez.");
  }
  demarreCoup(info);
}

// ------------------------------------------------------------ saisie
function coupDepuisPoses() {
  if (!poses.length) return null;
  const memeLigne = poses.every(p => p.row === poses[0].row), memeCol = poses.every(p => p.col === poses[0].col);
  let dir = poses.length > 1 ? (memeLigne ? "H" : memeCol ? "V" : null) : (curseur?.dir || "H");
  if (!dir) return null;
  if (poses.length === 1) {   // une seule lettre : sens où elle forme un mot
    const p = poses[0], b = coup.board, voisin = (r, c) => r >= 0 && c >= 0 && r < BOARD_SIZE && c < BOARD_SIZE && b[r][c];
    const h = voisin(p.row, p.col - 1) || voisin(p.row, p.col + 1), v = voisin(p.row - 1, p.col) || voisin(p.row + 1, p.col);
    if (h && !v) dir = "H"; else if (v && !h) dir = "V";
  }
  const dr = dir === "V" ? 1 : 0, dc = dir === "H" ? 1 : 0;
  const pos = p => dir === "H" ? p.col : p.row;
  const tri = poses.slice().sort((a, b) => pos(a) - pos(b));
  let r = tri[0].row, c = tri[0].col;
  // remonte sur les lettres déjà posées avant
  while (r - dr >= 0 && c - dc >= 0 && coup.board[r - dr][c - dc]) { r -= dr; c -= dc; }
  const row = r, col = c;
  let word = "", blanks = [];
  for (;;) {
    if (r >= BOARD_SIZE || c >= BOARD_SIZE) break;
    const p = poses.find(x => x.row === r && x.col === c), t = coup.board[r][c];
    if (p) { if (p.isBlank) blanks.push(word.length); word += p.letter; }
    else if (t) word += t.letter;
    else break;
    r += dr; c += dc;
  }
  const couverts = poses.every(p => {
    const k = dir === "H" ? p.col - col : p.row - row;
    return (dir === "H" ? p.row === row : p.col === col) && k >= 0 && k < word.length;
  });
  if (!couverts) return null;
  return { word, row, col, dir, blanks };
}

function valide() {
  if (!coup || coup.fini) return;
  const mv = coupDepuisPoses();
  if (!mv) { message("Les lettres doivent former un seul mot, sur une ligne ou une colonne, sans trou.", "ko"); return; }
  const mode = GAME_MODES[TOURS[e.tour].mode];
  if (poses.length > mode.maxPlayed) { message(`Au plus ${mode.maxPlayed} lettres jouées dans cette formule.`, "ko"); return; }
  const res = scoreMove(coup.board, mv, dict, { bonuses: mode.bonuses });
  if (res.errors.length) { message(`❌ ${res.errors[0]}`, "ko"); return; }
  coup.meilleur = Math.max(coup.meilleur, res.score);
  if (res.score >= coup.top.score) return finCoup(true);
  message(`<strong>${mv.word}</strong> : ${res.score} points. Le top fait ${coup.top.score} : cherchez encore !`, "ko");
  efface();
}

function efface() {
  for (const p of poses) coup.rack.find(t => t.id === p.id).used = false;
  if (poses.length) { const p0 = poses[0]; curseur = { row: p0.row, col: p0.col, dir: curseur?.dir || "H" }; }
  poses = [];
  afficheGrille(); afficheChevalet();
}

function retireDerniere() {
  const p = poses.pop();
  if (!p) return;
  coup.rack.find(t => t.id === p.id).used = false;
  curseur = { row: p.row, col: p.col, dir: curseur?.dir || "H" };
  afficheGrille(); afficheChevalet();
}

function avanceCurseur() {
  if (!curseur) return;
  const dr = curseur.dir === "V" ? 1 : 0, dc = curseur.dir === "H" ? 1 : 0;
  let r = curseur.row, c = curseur.col;
  do { r += dr; c += dc; } while (r < BOARD_SIZE && c < BOARD_SIZE && (coup.board[r][c] || poses.some(p => p.row === r && p.col === c)));
  curseur = r < BOARD_SIZE && c < BOARD_SIZE ? { row: r, col: c, dir: curseur.dir } : null;
}

/** Pose une lettre au curseur : tuile `id` du chevalet (ou, à défaut, la lettre tapée, puis le joker). */
function pose(lettre, id = null) {
  if (!coup || coup.fini) return;
  if (!curseur) { message("Touchez d'abord la case où commence votre mot (touchez-la encore pour changer de sens).", "ko"); return; }
  // le curseur saute les cases déjà occupées
  while (curseur && coup.board[curseur.row][curseur.col]) avanceCurseur();
  if (!curseur) return;
  let t = id !== null ? coup.rack.find(x => x.id === id && !x.used) : coup.rack.find(x => !x.used && x.letter === lettre);
  if (!t && id === null) t = coup.rack.find(x => !x.used && x.letter === "?");
  if (!t) return;
  let isBlank = t.letter === "?";
  if (isBlank && (!lettre || lettre === "?")) {
    lettre = (prompt("Lettre représentée par le joker ?") || "").trim().toUpperCase();
    if (!/^[A-Z]$/.test(lettre)) return;
  }
  t.used = true;
  poses.push({ row: curseur.row, col: curseur.col, letter: lettre, isBlank, id: t.id });
  avanceCurseur();
  afficheGrille(); afficheChevalet();
}

function clicCase(ev) {
  const td = ev.target.closest("td[data-r]");
  if (!td || !coup || coup.fini) return;
  const r = +td.dataset.r, c = +td.dataset.c;
  if (coup.board[r][c]) return;
  if (curseur && curseur.row === r && curseur.col === c && !poses.length) curseur.dir = curseur.dir === "H" ? "V" : "H";
  else { if (poses.length) efface(); curseur = { row: r, col: c, dir: curseur?.dir || "H" }; }
  afficheGrille();
}

document.addEventListener("keydown", ev => {
  if (!$("tsEcran").hidden || !coup || coup.fini || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key;
  if (/^[a-zA-Z]$/.test(k)) { ev.preventDefault(); pose(k.toUpperCase()); }
  else if (k === "?" ) { ev.preventDefault(); pose("?"); }
  else if (k === "Backspace") { ev.preventDefault(); retireDerniere(); }
  else if (k === "Escape") { ev.preventDefault(); efface(); }
  else if (k === "Enter") { ev.preventDefault(); valide(); }
  else if (k === " " && curseur && !poses.length) { ev.preventDefault(); curseur.dir = curseur.dir === "H" ? "V" : "H"; afficheGrille(); }
  else if (k.startsWith("Arrow") && curseur && !poses.length) {
    ev.preventDefault();
    const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    curseur = { row: Math.min(14, Math.max(0, curseur.row + dr)), col: Math.min(14, Math.max(0, curseur.col + dc)), dir: dr ? "V" : "H" };
    afficheGrille();
  }
});
$("board").addEventListener("click", clicCase);
$("rack").addEventListener("click", ev => { const t = ev.target.closest(".tile[data-id]"); if (t) pose(null, +t.dataset.id); });
$("tsValider").onclick = valide;
$("tsEffacer").onclick = () => coup && !coup.fini && efface();
$("tsMelanger").onclick = () => { if (coup) { melange(coup.rack); afficheChevalet(); } };
$("tsPause").onclick = () => {
  pauseDemandee = !pauseDemandee;
  $("tsPause").classList.toggle("pause-demandee", pauseDemandee);
  $("tsPause").textContent = pauseDemandee ? "⏸ Pause à la fin du coup" : "⏸ Pause";
};
$("tsAbandon").onclick = async () => {
  if (!e || e.fini) return;
  if (!confirm("Abandonner TopSping ? Votre tournoi s'arrête ici (niveau atteint : " + nomNiveau(niveauAtteint(e)) + ").")) return;
  clearInterval(minuteur);
  if (coup && !coup.fini) { e.stats.coups++; e.stats.rates++; e.stats.neg += coup.meilleur - coup.top.score; }
  e.fini = true; e.abandon = true; coup = null;
  await sauveFin();
  ecranFin();
};

// ------------------------------------------------------------ lancement
/** Reprise : un coup interrompu (page quittée en plein coup) compte comme raté. */
async function reprend(etat) {
  e = etat.ts;
  if (etat.enCours && e.partie !== null) {
    const reserve = await reserveDuTour(e.tour);
    const top = reserve[e.partie][e.coup][6];
    e.stats.coups++; e.stats.rates++; e.stats.neg -= top; e.stats.temps += TEMPS_COUP;
    const ev = jouerPoint(e, false, reserve);
    if (ev.tournoi) { await sauveFin(); return ecranFin(); }
    await sauve();
    await ecranPause("Reprise du tournoi", "Vous aviez quitté la page pendant un coup : ce coup compte comme raté (point pour le top).");
  } else {
    await ecranPause("Reprise du tournoi", `Vous en êtes au <strong>${TOURS[e.tour].nom}</strong> (${TOURS[e.tour].formule}).`);
  }
  demarreCoup();
}

async function lance() {
  message("Chargement du dictionnaire…");
  const dico = chargeDico();
  let etat = null;
  if (PREPARED_ID && !ADMIN) {
    const sb = await chargeSupabase();
    const pid = +(localStorage.getItem("currentPlayerId") || 0);
    const { data: partie, error } = await sb.from("prepared_games").select("*").eq("id", PREPARED_ID).maybeSingle();
    if (error || !partie) { message("Tournoi introuvable.", "ko"); return; }
    reserveNom = partie.moves?.[0]?._topsping?.reserve || "ts1";
    serveur = { sb, partie, pid };
    $("tsRetour").href = urlTournoi();
    if (!pid) { message("Connectez-vous d'abord pour jouer.", "ko"); return; }
    const { data: res } = await sb.from("prepared_game_results").select("paused, summary").eq("prepared_game_id", partie.id).eq("player_id", pid).maybeSingle();
    if (res && !res.paused && res.summary?.ts) {
      e = { ...nouveauTournoi(), fini: true };
      const ts = res.summary.ts;
      message(`Tournoi terminé : <strong>${nomNiveau(ts.niveau)}</strong>${ts.ab ? " (abandon)" : ""} · ${ts.rates} tops ratés · négatif ${ts.neg}.`);
      $("tsTour").textContent = "Tournoi terminé";
      return;
    }
    if (res?.paused?.ts) etat = res.paused;
  } else {
    // stof (admin) : mode test, état gardé dans ce navigateur, rien n'est enregistré.
    if (!ADMIN) { message("TopSping se joue depuis la page du tournoi.", "ko"); return; }
    $("tsTest").hidden = false;
    reserveNom = PARAMS.get("reserve") || "ts1";
    try { etat = JSON.parse(localStorage.getItem(CLE_TEST) || "null"); } catch {}
    if (etat?.fin) etat = null;
    if (etat && await ecran("<h2>Mode test</h2><p>Une partie de test est en cours.</p>", ["La reprendre", "Recommencer"]) === 1) etat = null;
  }
  dict = await dico;
  $("tsPause").hidden = $("tsAbandon").hidden = false;
  window.__topsping = { etat: () => e, coup: () => coup, valide, pose, poses: () => poses, curseur: c => { curseur = c; } };   // tests automatiques
  if (etat) return reprend(etat);
  await ecran(REGLES_HTML, ["C'est parti !"]);
  e = nouveauTournoi();
  demarreCoup();
}

lance().catch(err => message(`Erreur : ${err.message}`, "ko"));
