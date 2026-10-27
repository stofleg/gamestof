//  Grille puzzle (Jigsaw) — une grille finale est découpée en pièces irrégulières,
//  mélangées dans la réserve. Il faut la reconstituer : glisser chaque pièce à sa
//  place sur la grille vide. Une pièce peut être posée partout où elle tient (même
//  au mauvais endroit) et reprise ensuite ; la grille est validée quand chaque case
//  correspond à la solution.
//
//  Deux modes :
//   • entraînement (sans paramètre) : grille tirée au hasard, rejouable ;
//   • tournoi (?prepared=ID) : grille et découpage stockés avec la partie, identiques
//     pour tous. Un seul essai ; l'heure de départ est enregistrée en base, si bien
//     qu'un rechargement ne remet pas le chrono à zéro. Le temps réalisé est
//     enregistré comme résultat (0 point, 0 négatif) et s'ajoute au temps général.
import { afficheRegles } from "./regles.js?v=435";
import { chargeDico, grilleFinale, classeCase, jeton, appliqueTheme, fmt } from "./grille-finale.js?v=435";
import { decoupeRegions, piecesDepuisRegions } from "./puzzle-pieces.js?v=435";
import { emptyBoard, applyMove, modeDisplayName, modeNomOrigine } from "./engine.js?v=435";
import * as sonHalloween from "./halloween-son.js?v=435";

const $ = id => document.getElementById(id);
const N = 15;
const PARAMS = new URLSearchParams(location.search);
const PREPARED_ID = PARAMS.get("prepared");
const PUBLIC_EVENT = localStorage.getItem("currentScope") === "halloween";
let solution = null;      // board de la grille à reconstituer
let pieces = [];          // { id, cells: [[dr,dc]...], r0, c0 (place correcte), pose: {r,c}|null }
let occupe = [];          // occupe[r][c] = id de la pièce posée, ou null
let t0 = 0, minuteur = null, fini = false;
let tournoi = null;       // { sb, partie, pid, debut } en mode tournoi
let sansBonus = false;    // tournoi de la Mort : la grille n'affiche pas les cases multiplicatrices
const cls = (R, C) => sansBonus ? "normal" : classeCase(R, C);
const PENALITE_ABANDON = 900;   // abandon : temps écoulé + 15 minutes

appliqueTheme();

// --- rendu ------------------------------------------------------------------------
function htmlPiece(p) {
  const h = Math.max(...p.cells.map(x => x[0])) + 1, w = Math.max(...p.cells.map(x => x[1])) + 1;
  const dans = new Set(p.cells.map(([r, c]) => r * N + c));
  let s = `<table>`;
  for (let r = 0; r < h; r++) {
    s += "<tr>";
    for (let c = 0; c < w; c++) {
      if (!dans.has(r * N + c)) { s += `<td class="trou"></td>`; continue; }
      const R = p.r0 + r, C = p.c0 + c, t = solution[R][C];
      s += `<td class="${cls(R, C)}${t ? " has-tile" : ""}" data-dr="${r}" data-dc="${c}">${jeton(t)}</td>`;
    }
    s += "</tr>";
  }
  return s + "</table>";
}

function dessineGrille() {
  let s = "<table>";
  for (let r = 0; r < N; r++) {
    s += "<tr>";
    for (let c = 0; c < N; c++) {
      const id = occupe[r][c];
      if (id == null) { s += `<td class="vide" data-r="${r}" data-c="${c}"></td>`; continue; }
      // la case montre le contenu de la pièce posée, pas forcément la solution
      const p = pieces[id], dr = r - p.pose.r, dc = c - p.pose.c;
      const R = p.r0 + dr, C = p.c0 + dc, t = solution[R][C];
      s += `<td class="${cls(R, C)}${t ? " has-tile" : ""} posee" data-r="${r}" data-c="${c}" data-id="${id}">${jeton(t)}</td>`;
    }
    s += "</tr>";
  }
  $("pzBoard").innerHTML = s + "</table>";
}

// La réserve est une zone libre : chaque pièce garde la place où on l'a posée (x, y en
// pixels dans la réserve), pour que le joueur puisse les trier et les regrouper.
let zMax = 1;
function dessineReserve() {
  const tray = $("pzTray");
  const enReserve = pieces.filter(p => !p.pose);
  const style = p => p.x == null ? "" : ` style="left:${p.x}px;top:${p.y}px;z-index:${p.z || 1}"`;
  tray.innerHTML = enReserve.map(p => `<div class="board piece" data-id="${p.id}"${style(p)}>${htmlPiece(p)}</div>`).join("");
  // Premier affichage : le navigateur range les pièces en rangées, puis on fige ces
  // positions et la réserve passe en placement libre.
  if (enReserve.some(p => p.x == null)) {
    if (document.body.classList.contains("pz-mort")) rangeAutourDeLaGrille(tray);
    else {
      tray.classList.remove("libre");
      for (const el of tray.children) {
        const p = pieces[+el.dataset.id];
        p.x = el.offsetLeft; p.y = el.offsetTop;
      }
      tray.classList.add("libre");
    }
    for (const el of tray.children) {
      const p = pieces[+el.dataset.id];
      Object.assign(el.style, { left: p.x + "px", top: p.y + "px" });
    }
  }
  ajusteReserve();
}
/** Tournoi de la Mort : la réserve couvre toute la page, la grille (réduite) est posée
 *  en haut à gauche. Premier rangement en rangées : à droite de la grille, puis dessous. */
function rangeAutourDeLaGrille(tray) {
  tray.classList.add("libre");
  const board = $("pzBoard"), ecart = 14;
  const bx1 = board.offsetWidth + ecart, by1 = board.offsetHeight + ecart, W = tray.clientWidth;
  let x = bx1, y = 0, hRangee = 0;
  for (const el of tray.children) {
    const p = pieces[+el.dataset.id], w = el.offsetWidth, h = el.offsetHeight;
    const debutRangee = () => (y < by1 ? bx1 : 0);
    if (x + w > W) {                       // rangée pleine : on passe à la suivante
      y += hRangee + ecart; hRangee = 0; x = debutRangee();
    }
    if (y < by1 && y + h > by1 - ecart && x < bx1) x = bx1;   // jamais sur la grille
    if (x + w > W && y < by1) { y = by1; x = 0; }             // trop large à côté de la grille : dessous
    p.x = x; p.y = y;
    x += w + ecart; hRangee = Math.max(hRangee, h);
  }
}
/** La réserve s'agrandit pour contenir la pièce la plus basse. */
function ajusteReserve() {
  const tray = $("pzTray");
  let bas = 0;
  for (const el of tray.children) bas = Math.max(bas, el.offsetTop + el.offsetHeight);
  tray.style.height = tray.classList.contains("libre") ? Math.max(bas + 16, tray.dataset.hInit || 0) + "px" : "";
}
/** Lâcher dans la réserve : la case saisie de la pièce arrive sous le pointeur. */
function deposeEnReserve(p, e, dr, dc) {
  const tray = $("pzTray"), box = tray.getBoundingClientRect();
  if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom + 40) return false;
  // Taille d'une case dans la réserve (80 % de la grille en entraînement, 100 % dans le tournoi).
  const ref = tray.querySelector(".piece td:not(.trou)"), td = $("pzBoard").querySelector("td");
  const cs = ref ? ref.getBoundingClientRect().width : (td ? td.getBoundingClientRect().width : 30) * 0.8;
  const w = (Math.max(...p.cells.map(x => x[1])) + 1) * cs;
  p.x = Math.round(Math.min(Math.max(0, e.clientX - box.left - (dc + .5) * cs), Math.max(0, box.width - w)));
  p.y = Math.round(Math.max(0, e.clientY - box.top - (dr + .5) * cs));
  p.z = ++zMax;
  return true;
}

// --- glisser-déposer ----------------------------------------------------------------
let prise = null;   // { p, el, dr, dc, dx, dy }

function prend(p, e, dr, dc) {
  const el = document.createElement("div");
  el.className = "board piece drag";
  el.innerHTML = htmlPiece(p);
  document.body.appendChild(el);
  const cell = el.querySelector(`td[data-dr="${dr}"][data-dc="${dc}"]`).getBoundingClientRect();
  const box = el.getBoundingClientRect();
  prise = { p, el, dr, dc, dx: cell.left - box.left + cell.width / 2, dy: cell.top - box.top + cell.height / 2 };
  bouge(e);
}
function bouge(e) {
  if (!prise) return;
  prise.el.style.left = (e.clientX - prise.dx) + "px";
  prise.el.style.top = (e.clientY - prise.dy) + "px";
}
function lache(e) {
  if (!prise) return;
  const { p, el, dr, dc } = prise;
  el.remove(); prise = null;
  const sous = document.elementFromPoint(e.clientX, e.clientY)?.closest("#pzBoard td");
  if (sous) {
    const r = +sous.dataset.r - dr, c = +sous.dataset.c - dc;
    if (tient(p, r, c)) pose(p, r, c);
  } else {
    deposeEnReserve(p, e, dr, dc);   // rangement libre dans la réserve (sinon elle garde sa place)
  }
  dessineGrille(); dessineReserve(); verifie();
}
function tient(p, r, c) {
  return p.cells.every(([dr, dc]) => {
    const y = r + dr, x = c + dc;
    return y >= 0 && y < N && x >= 0 && x < N && (occupe[y][x] == null || occupe[y][x] === p.id);
  });
}
function retire(p) {
  if (!p.pose) return;
  for (const [dr, dc] of p.cells) occupe[p.pose.r + dr][p.pose.c + dc] = null;
  p.pose = null;
}
function pose(p, r, c) {
  retire(p);
  p.pose = { r, c };
  for (const [dr, dc] of p.cells) occupe[r + dr][c + dc] = p.id;
}

$("pzTray").addEventListener("pointerdown", e => {
  if (fini) return;
  const td = e.target.closest("td[data-dr]"), el = e.target.closest(".piece");
  if (!td || !el) return;
  e.preventDefault();
  el.style.visibility = "hidden";       // la pièce « suit » le pointeur pendant le glisser
  prend(pieces[+el.dataset.id], e, +td.dataset.dr, +td.dataset.dc);
});
$("pzBoard").addEventListener("pointerdown", e => {
  if (fini) return;
  const td = e.target.closest("td.posee");
  if (!td) return;
  e.preventDefault();
  const p = pieces[+td.dataset.id];
  const dr = +td.dataset.r - p.pose.r, dc = +td.dataset.c - p.pose.c;
  retire(p); dessineGrille();
  prend(p, e, dr, dc);
});
window.addEventListener("pointermove", bouge);
window.addEventListener("pointerup", lache);
// clic droit sur une pièce posée : elle retourne dans la réserve
$("pzBoard").addEventListener("contextmenu", e => {
  const td = e.target.closest("td.posee");
  if (!td) return;
  e.preventDefault();
  retire(pieces[+td.dataset.id]); dessineGrille(); dessineReserve();
});

// --- partie ----------------------------------------------------------------------------
/** Grille reconstituée : chaque case affiche le même contenu que la solution. */
function verifie() {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const id = occupe[r][c];
    if (id == null) return;
    const p = pieces[id], R = p.r0 + r - p.pose.r, C = p.c0 + c - p.pose.c;
    const a = solution[R][C], b = solution[r][c];
    if (!sansBonus && classeCase(R, C) !== classeCase(r, c)) return;   // sans multiplicateurs : seules les lettres comptent
    if (!!a !== !!b || (a && (a.letter !== b.letter || !!a.isBlank !== !!b.isBlank))) return;
  }
  fini = true;
  clearInterval(minuteur);
  const s = tournoi ? (Date.now() - tournoi.debut) / 1000 : (performance.now() - t0) / 1000;
  $("pzChrono").textContent = fmt(s);
  $("pzBoard").classList.add("gagne");
  $("pzAbandon").hidden = true;
  if (tournoi) enregistreResultat(Math.round(s)).then(ok => annonce(`🧩 Grille reconstituée en <strong>${fmt(s)}</strong> !${ok ? "<br>Ton temps est enregistré." : ""}`));
  else $("pzMsg").textContent = `Grille reconstituée en ${fmt(s)} !`;
}

/** Message : bandeau en entraînement, fenêtre centrale dans le tournoi de la Mort (interface épurée). */
function annonce(html) {
  if (!document.body.classList.contains("pz-mort")) { $("pzMsg").innerHTML = html; return; }
  $("pzFinTexte").innerHTML = html;
  $("pzFin").hidden = false;
}

// --- entraînement : grille au hasard ---------------------------------------------------
let dict = null;
async function nouvelle() {
  $("pzNew").disabled = true;
  $("pzMsg").textContent = "Génération de la grille…";
  fini = false; clearInterval(minuteur);
  $("pzBoard").classList.remove("gagne");
  if (!dict) dict = await chargeDico();
  await new Promise(r => setTimeout(r, 20));
  solution = grilleFinale(dict).board;
  demarre(piecesDepuisRegions(decoupeRegions()), performance.now());
  $("pzNew").disabled = false;
}

/** Installe les pièces et lance le chrono (`debut` : origine du chrono). */
function demarre(lesPieces, debut) {
  pieces = lesPieces;
  occupe = Array.from({ length: N }, () => Array(N).fill(null));
  dessineGrille(); dessineReserve();
  $("pzMsg").textContent = `${pieces.length} pièces à replacer — clic droit sur une pièce posée pour la reprendre.`;
  t0 = debut;
  const ecoule = () => tournoi ? (Date.now() - tournoi.debut) / 1000 : (performance.now() - t0) / 1000;
  minuteur = setInterval(() => { $("pzChrono").textContent = fmt(ecoule()); }, 250);
}

// --- tournoi : grille fixe, un seul essai, temps enregistré ----------------------------
async function chargeSupabase() {
  const script = src => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  if (!window.SUPABASE_URL) await script("../config.js");
  if (!window.supabase) await script("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js");
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  await sb.auth.getSession();
  return sb;
}

function afficheSolution() {
  pieces = []; occupe = Array.from({ length: N }, () => Array(N).fill(null));
  let s = "<table>";
  for (let r = 0; r < N; r++) {
    s += "<tr>";
    for (let c = 0; c < N; c++) { const t = solution[r][c]; s += `<td class="${cls(r, c)}${t ? " has-tile" : ""}">${jeton(t)}</td>`; }
    s += "</tr>";
  }
  $("pzBoard").innerHTML = s + "</table>";
  $("pzTray").innerHTML = "";
}

async function enregistreResultat(secondes, abandon = false) {
  const { sb, partie, pid } = tournoi;
  const { error } = await sb.from("prepared_game_results").upsert({
    prepared_game_id: partie.id, player_id: pid,
    total_score: 0, sum_neg: 0, total_time_seconds: secondes,
    details: [{ moveNo: 1, status: abandon ? "giveup" : "top", playerScore: 0, neg: 0, timeMs: secondes * 1000, top: null, puzzle: true, v: 2 }],
    summary: { v: 1, mv: [1], tp: abandon ? [] : [1], ab: abandon, puzzle: true },
    paused: null,
    played_on_mobile: matchMedia("(max-width: 700px)").matches,
  }, { onConflict: "prepared_game_id,player_id" });
  if (error) { annonce(`⚠️ Temps non enregistré : ${error.message}`); return false; }
  if (PUBLIC_EVENT) sb.rpc("note_ip", { p_evenement: "partie" }).then(() => {}, () => {});
  return true;
}

/** Abandon (tournoi) : le temps écoulé plus une pénalité est enregistré. */
async function abandonne() {
  if (fini || !tournoi?.debut) return;
  if (!confirm(`Abandonner Jigsaw ? Ton temps sera compté : temps écoulé + ${PENALITE_ABANDON / 60} minutes de pénalité.`)) return;
  fini = true;
  clearInterval(minuteur);
  const s = Math.round((Date.now() - tournoi.debut) / 1000) + PENALITE_ABANDON;
  $("pzAbandon").hidden = true;
  const ok = await enregistreResultat(s, true);
  if (ok) annonce(`Jigsaw abandonné.<br>Temps compté : <strong>${fmt(s)}</strong> (pénalité comprise).`);
}

async function lanceTournoi() {
  $("pzNew").hidden = true;
  $("pzMsg").textContent = "Chargement de la partie…";
  const sb = await chargeSupabase();
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  const { data: partie, error } = await sb.from("prepared_games").select("*").eq("id", PREPARED_ID).maybeSingle();
  if (error || !partie) { $("pzMsg").textContent = "Partie introuvable."; return; }
  const regions = partie.moves?.[0]?._puzzle;
  if (!Array.isArray(regions)) { $("pzMsg").textContent = "Cette partie n'a pas de découpage en pièces : elle doit être regénérée."; return; }
  // Tournoi de la Mort : thème et titre Halloween.
  let mort = PUBLIC_EVENT;
  if (!mort && partie.tournament_id) {
    const { data: t } = await sb.from("tournaments").select("est_public").eq("id", partie.tournament_id).maybeSingle();
    mort = !!t?.est_public;
  }
  const versTournoi = () => { location.href = PUBLIC_EVENT ? "../halloween/" : "../index.html"; };
  if (mort) {
    // Interface Halloween épurée : chrono + Abandonner, grille réduite sans multiplicateurs.
    document.body.classList.add("theme-halloween", "pz-mort");
    sansBonus = true;
    document.title = `${modeDisplayName("puzzle", false, true)} · Le tournoi de la Mort`;
    sonHalloween.ambiance(true);
    $("pzAbandon").hidden = false;
    $("pzAbandon").onclick = abandonne;
    $("pzFinBouton").onclick = versTournoi;
  }
  const retour = $("pzRetour");
  retour.onclick = versTournoi;
  retour.textContent = PUBLIC_EVENT || mort ? "← Tournoi" : "Retour";

  let b = emptyBoard();
  for (const m of partie.moves) b = applyMove(b, m.top);
  solution = b;
  tournoi = { sb, partie, pid, debut: null };
  if (!pid) { annonce("Connecte-toi d'abord pour jouer cette partie."); return; }

  const { data: res } = await sb.from("prepared_game_results")
    .select("paused, summary, total_time_seconds").eq("prepared_game_id", partie.id).eq("player_id", pid).maybeSingle();
  if (res && !res.paused && res.summary?.puzzle) {          // déjà terminée : on montre le résultat
    afficheSolution();
    $("pzChrono").textContent = fmt(res.total_time_seconds || 0);
    $("pzAbandon").hidden = true;
    annonce(res.summary.ab ? `Jigsaw abandonné : temps compté ${fmt(res.total_time_seconds || 0)}.` : `Grille déjà reconstituée en ${fmt(res.total_time_seconds || 0)}.`);
    fini = true;
    return;
  }
  if (res?.paused?.puzzleDebut) {                           // reprise : le chrono continue
    tournoi.debut = res.paused.puzzleDebut;
  } else {
    await afficheRegles("puzzle", mort ? modeDisplayName("puzzle", false, true) : null, mort ? modeNomOrigine("puzzle") : null);
    tournoi.debut = Date.now();
    const { error: e2 } = await sb.from("prepared_game_results").upsert({
      prepared_game_id: partie.id, player_id: pid, total_score: 0, sum_neg: 0, total_time_seconds: 0,
      details: [], summary: null, paused: { puzzleDebut: tournoi.debut },
    }, { onConflict: "prepared_game_id,player_id" });
    if (e2) { annonce(`Impossible de démarrer : ${e2.message}`); return; }
  }
  demarre(piecesDepuisRegions(regions), 0);
}

if (PREPARED_ID) {
  lanceTournoi().catch(e => annonce(`Erreur : ${e.message}`));
} else {
  $("pzNew").onclick = nouvelle;
  afficheRegles("puzzle").then(nouvelle);
}

