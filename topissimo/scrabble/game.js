// Détection mode app (PWA standalone/fullscreen/minimal-ui)
(function () {
  const isApp =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true;
  if (isApp) document.body.classList.add("app-mode");
})();

// ============================================================
//  La Garenna — Jeu Scrabble (mode entraînement)
//
//  Boucle :
//    - Tirage aléatoire (7 lettres, min voyelles/consonnes)
//    - Le top est calculé en arrière-plan
//    - Le joueur clique sur la grille → curseur (H, ou V au 2e clic)
//    - Il tape son mot, les jetons sortent du chevalet
//    - Entrée valide :
//        si score == top : on enregistre, on passe au coup suivant
//                          (top placé sur le plateau)
//        sinon : feedback, on garde le tirage, on peut réessayer
//                ou cliquer "Voir le top" pour révéler & passer
// ============================================================

import {
  emptyBoard, BOARD_BONUSES, BOARD_SIZE, CENTER, LETTER_VALUE, LETTER_BAG,
  VOWELS, drawForDuplicate, scoreMove, applyMove,
  bagTotalVowels, bagTotalConsonants, GAME_MODES, modeDisplayName, randomBoardLayout, snakeEndpointsAfter,
} from "./engine.js?v=302";
import { Dictionary } from "./dictionary.js?v=302";
import { findTop, findTopRanked, rankIsotops, snakeBestTop, snakeMoveLegal } from "./topfinder.js?v=302";

// État du mode review (parcours coup par coup)
const review = {
  active: false,
  game: null,           // prepared_games row
  result: null,         // prepared_game_results row (peut être null)
  historyByMove: {},    // moveNo → entrée du joueur
  userPicks: {},        // moveNo → { word,pos,score } | { zero:true } saisis en Revoir
  step: 1,              // coup courant affiché (1..N)
};

// ============================================================
//  État
// ============================================================
// Modes d'accès via URL :
//   ?prepared=ID → jouer la partie pré-tirée
//   ?review=ID   → revoir une partie déjà jouée (lecture seule)
const URL_PARAMS = new URLSearchParams(location.search);
const PREPARED_ID = URL_PARAMS.get("prepared");
const REVIEW_ID = URL_PARAMS.get("review");
const TRAINING_ID = URL_PARAMS.get("training");
const PUZZLE_GAME_ID = URL_PARAMS.get("puzzle");
const PUZZLE_MOVE_NO = +URL_PARAMS.get("move") || 1;
const TOURNAMENT_ID = URL_PARAMS.get("tid");  // ID du tournoi pour le retour
const FFSC_REVIEW = URL_PARAMS.get("ffscreview");  // revoir une partie FFSC importée

// Version de ce build JS. Doit correspondre au CACHE du service worker (sw.js)
// et à EXPECTED_SW_CACHE (app.js). Sert à détecter un code périmé servi par un
// service worker non mis à jour (cause probable des "tirages d'ailleurs").
const BUILD_VERSION = "garenna-v302";

// ============================================================
//  Diagnostic — journal d'événements transmis en fin de partie
// ============================================================
// Objectif : savoir EXACTEMENT ce qui s'est passé côté joueur quand un bug
// survient (tirage inattendu en tournoi, joker surnuméraire, etc.).
// Le journal est poussé dans prepared_game_results.diagnostics à la sauvegarde.
const diag = {
  build: BUILD_VERSION,        // version attendue par ce JS
  swCache: null,               // version réellement servie par le service worker
  swScriptURL: null,           // URL du SW contrôleur
  ua: (typeof navigator !== "undefined" && navigator.userAgent) || "",
  startedAt: null,             // ISO timestamp du démarrage de partie
  mode: null,
  withJoker: null,
  preparedId: null,
  events: [],                  // [{seq, event, ...data}]
};
let _diagSeq = 0;
function diagLog(event, data = {}) {
  try {
    diag.events.push({ seq: ++_diagSeq, event, ...data });
    // Garde-fou mémoire : on ne garde que les 800 derniers événements.
    if (diag.events.length > 800) diag.events.shift();
  } catch { /* le diagnostic ne doit jamais casser le jeu */ }
}
// Y avait-il déjà un SW contrôleur au chargement de la page ? Sert à distinguer
// une VRAIE mise à jour (recharger) d'une simple première prise de contrôle
// (ne pas recharger, sinon reload parasite à la 1ʳᵉ visite).
const _swHadControllerAtLoad =
  typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
let _swRefreshing = false;          // empêche tout double rechargement
let _swUpdatesRegistered = false;

// Service worker SUPPRIMÉ (cf. sw.js kill-switch). On ne fait plus AUCUN
// rechargement piloté par le SW ici : la page d'accueil tire le kill-switch qui
// désinscrit le SW, vide les caches et recharge proprement. On se contente d'un
// relevé de diagnostic (sans effet de bord).
function captureSwVersion() {
  try {
    if (typeof caches !== "undefined" && caches.keys) {
      caches.keys().then(keys => {
        const garenna = keys.filter(k => k.startsWith("garenna-"));
        diag.swCache = garenna.join(",") || keys.join(",") || "(aucun)";
      }).catch(() => {});
    }
  } catch { /* ignore */ }
}

// Mécanisme STANDARD de mise à jour du SW sur la page de jeu :
//  • à l'ouverture, on demande au navigateur de vérifier une nouvelle version ;
//  • si un SW est "waiting"/"installed", on lui demande de s'activer (skipWaiting) ;
//  • quand le nouveau SW prend le contrôle (controllerchange), on recharge UNE
//    fois — uniquement s'il y avait déjà un contrôleur (vraie MAJ) et jamais en
//    pleine partie.
function registerSwUpdates() {
  if (_swUpdatesRegistered) return;
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  _swUpdatesRegistered = true;
  try {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (_swRefreshing) return;
      if (!_swHadControllerAtLoad) return;     // 1ʳᵉ prise de contrôle → pas de reload
      if (state.started) { diagLog("SW_RELOAD_DEFERRED", { reason: "game_in_progress" }); return; }
      _swRefreshing = true;
      diagLog("SW_CONTROLLER_CHANGE_RELOAD", {});
      try { window.location.reload(); } catch {}
    });
    navigator.serviceWorker.getRegistration?.().then(reg => {
      if (!reg) return;
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            sw.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      reg.update().catch(() => {});
    }).catch(() => {});
  } catch { /* ignore */ }
}

// Filet de sécurité : le code EN COURS est plus ancien que le cache présent
// (l'onglet tournait sur l'ancien JS au moment de la MAJ, aucun controllerchange
// n'arrivera). On force un reload, UNE SEULE FOIS PAR VERSION CIBLE (clé = jeu de
// caches trouvés) → pas de boucle même si le rechargement ne suffisait pas, et
// nouvelle tentative dès qu'une version encore plus récente apparaît.
function selfHealStaleCache(foundCaches) {
  try {
    const target = (foundCaches || []).join(",");
    const KEY = "swHealTarget";
    if (sessionStorage.getItem(KEY) === target) {
      diagLog("SW_HEAL_SKIPPED", { reason: "already_attempted", target });
      return;
    }
    if (state.started) {
      diagLog("SW_HEAL_SKIPPED", { reason: "game_in_progress", target });
      return;
    }
    sessionStorage.setItem(KEY, target);
    diagLog("SW_HEAL_START", { expected: BUILD_VERSION, target });
    const reload = () => { if (_swRefreshing) return; _swRefreshing = true; try { window.location.reload(); } catch {} };
    if (navigator.serviceWorker?.getRegistration) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
          reg.update().then(reload).catch(reload);
        } else { reload(); }
      }).catch(reload);
    } else { reload(); }
  } catch { /* ignore */ }
}

const state = {
  dict: null,
  bag: { ...LETTER_BAG },
  board: emptyBoard(),
  rack: [],           // array of {letter, used:bool, id}
  // Partie pré-tirée
  prepared: null,     // { id, name, mode, withJoker, timePerMove, moves: [...] }
  preparedIdx: 0,     // index du prochain coup à jouer
  cursor: null,       // {row, col, dir:"H"|"V"} ou null
  pending: [],        // [{row, col, letter, rackId, isBlank}]
  jokerPending: false,// vrai si on attend la lettre à associer au ?
  topMove: null,      // {score, move, words}
  currentRackFresh: true,  // le tirage courant est-il un chevalet complet neuf ?
  currentKept: "",         // reliquat (lettres conservées) du tirage courant
  moveMaxPlaced: 0,        // max de jetons posés dans un mot VALIDE ce coup (scrabble ?)
  moveNo: 1,
  totalScore: 0,
  sumNeg: 0,
  // Chrono global
  started: false,
  chronoStart: null,
  chronoPenalty: 0,
  chronoFinal: null,
  // Chrono par coup
  moveStart: null,            // performance.now() au début du coup
  moveTimeLeft: 0,            // secondes restantes (si timePerMove > 0)
  // Surbrillance du dernier coup
  lastPlaced: [],             // [{row, col}] — nouvelles cases du top
  lastTopCells: [],           // [{row, col}] — toutes les cases du mot top (surbrillance dorée)
  // Historique pour feuille de route
  history: [],                // [{moveNo, rack, top, played, score, isTop, timeMs, status}]
  // Mode joker : nb de jokers "actifs" restants (2 au départ en mode joker)
  spareJokers: 0,
  // Meilleur essai sur le coup courant (réinitialisé à chaque coup)
  bestAttempt: null,          // { word, score }
  moveInvalidCount: 0,       // mots hors dico tentés sur le coup courant
  // Annotations sur la grille (mode entraînement)
  annotations: {},            // "r,c" → { tl, tr, bl, br, center, dot }
  arrowAnnotations: [],       // [{fromR, fromC, toR, toC}]
  annotTool: "",              // outil sélectionné dans la toolbar
  settings: loadSettings(),
};

// Préférences personnelles : 2 couches de persistance
//  1. localStorage (navigateur, survit aux mises à jour de l'app et du SW)
//  2. Supabase `players.settings` (source de vérité, restaurée à chaque login)
// Toute nouvelle préférence ajoutée plus tard prend sa valeur par défaut
// sans écraser les choix existants (Object.assign sur defaults).
function loadSettings() {
  const defaults = {
    rackPos: "bottom", sortRack: false, showCoords: true,
    timePerMove: 120, gameMode: "duplicate", withJoker: false,
    colorTheme: "classic",
    chronoType: "challenge",
    highlightTop: true,
    // Axe « Mode de jeu » (entraînement) : orthogonal à la formule (gameMode).
    //   topping   : on enchaîne dès que le top est trouvé (comportement historique) ;
    //   duplicate : on attend la fin du chrono, puis le top est sélectionné ;
    //   editor    : on ne joue pas, on construit une partie (pose libre + supertop).
    playMode: "topping",
    autoDraw: true,      // duplicate : tirage automatique (sinon saisi à la main)
    autoTop: true,       // duplicate : sélection automatique du top en fin de chrono
    signalZeros: false,  // duplicate : prévenir quand le mot validé est faux (zéro)
  };
  try {
    const local = JSON.parse(localStorage.getItem("scrabbleSettings") || "{}");
    return Object.assign({}, defaults, local);
  } catch { return defaults; }
}
async function loadSettingsFromSupabase() {
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  if (!pid) return;
  if (!window._sb) await loadSupabaseClient();
  const { data, error } = await window._sb.from("players").select("settings").eq("id", pid).maybeSingle();
  if (error || !data?.settings) return;
  // Merge sans écraser les nouvelles clés introduites par une mise à jour de l'app
  // (les defaults de loadSettings ont déjà été appliqués).
  Object.assign(state.settings, data.settings);
  saveSettings();              // miroir local
  applyRackPos();
  applyColorTheme();
  renderRack();
  renderBoard();
  renderGameTitle();
}
async function saveSettingsToSupabase() {
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  if (!pid) return;
  if (!window._sb) await loadSupabaseClient();
  // Persiste UNIQUEMENT les préférences personnelles (pas les params de jeu
  // qui peuvent être imposés par un tournoi : mode / joker / temps par coup).
  const persisted = {
    rackPos:    state.settings.rackPos,
    sortRack:   state.settings.sortRack,
    showCoords: state.settings.showCoords,
    colorTheme: state.settings.colorTheme,
    chronoType: state.settings.chronoType,
    highlightTop: state.settings.highlightTop,
  };
  await window._sb.from("players").update({ settings: persisted }).eq("id", pid);
}

function currentMode() {
  return GAME_MODES[state.settings.gameMode] || GAME_MODES.duplicate;
}
function saveSettings() {
  localStorage.setItem("scrabbleSettings", JSON.stringify(state.settings));
}

// ============================================================
//  Helpers DOM
// ============================================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const bonusClass = (ch) => ({
  ".":"normal", "d":"dl", "t":"tl", "D":"dw", "T":"tw", "*":"center"
}[ch] || "normal");
const bonusLabel = (ch) => ({
  "d":"LD", "t":"LT", "D":"MD", "T":"MT",
}[ch] || "");

function tileHtml(letter, value, opts = {}) {
  const cls = ["tile"];
  if (opts.blank) cls.push("blank");
  if (opts.pending) cls.push("pending");
  if (opts.used) cls.push("used");
  if (opts.empty) cls.push("empty");
  if (opts.empty) return `<div class="${cls.join(" ")}"></div>`;
  return `<div class="${cls.join(" ")}">${letter || ""}<span class="val">${value ?? ""}</span></div>`;
}

// ============================================================
//  Rendu
// ============================================================
const ROW_LETTERS = "ABCDEFGHIJKLMNO";

function renderBoard() {
  const div = $("#board");
  // Sur mobile (< 700 px) on supprime les coords pour gagner de la place
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
  const showCoords = state.settings.showCoords && !isMobile;
  document.body.classList.toggle("show-coords", showCoords);
  // Étiquette de score PROGRESSIF : petite pastille au coin supérieur droit de la
  // DERNIÈRE lettre du mot en cours. Comptée au fur et à mesure, même si le mot
  // n'est pas encore valide (on ignore les erreurs de dico). Ne masque pas le curseur.
  let badgeCell = null, badgeScore = null, badgeDir = "H";
  if (state.pending.length > 0) {
    const mv = buildMoveFromPending();
    if (mv) {
      const r0 = scoreMove(state.board, mv, null, { bonuses: currentMode().bonuses, jokerPays: currentMode().jokerPays, layout: state.boardLayout, raw: true });
      badgeScore = r0.score;
      badgeDir = mv.dir;
      const dr = mv.dir === "V" ? 1 : 0, dc = mv.dir === "H" ? 1 : 0;
      badgeCell = { r: mv.row + (mv.word.length - 1) * dr, c: mv.col + (mv.word.length - 1) * dc };
    }
  }
  let html = "<table>";
  if (showCoords) {
    html += `<tr><td class="coord corner"></td>`;
    for (let c = 0; c < BOARD_SIZE; c++) html += `<td class="coord">${c + 1}</td>`;
    html += `<td class="coord corner"></td></tr>`;
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    html += "<tr>";
    if (showCoords) html += `<td class="coord">${ROW_LETTERS[r]}</td>`;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const bonus = (state.boardLayout || BOARD_BONUSES)[r][c];
      // Centre : en grille random, on garde la couleur de la case tirée + une étoile
      // de départ (classe "start") ; sinon case centre classique (mot ×2 + étoile).
      let cls;
      if (r === CENTER && c === CENTER) cls = state.boardLayout ? [bonusClass(bonus), "start"] : ["center"];
      else cls = [bonusClass(bonus)];
      const tile = cellTile(r, c);
      if (tile) cls.push("has-tile");
      const isCursor = state.cursor && state.cursor.row === r && state.cursor.col === c;
      if (isCursor) cls.push("cursor", state.cursor.dir === "H" ? "dir-h" : "dir-v");
      const isInvalidCell = state.invalidCells && state.invalidCells.some(p => p.r === r && p.c === c);
      let tileHtmlStr = "";
      if (tile) {
        const tcls = ["tile"];
        if (tile.isBlank) tcls.push("blank");
        if (tile.pending) tcls.push("pending");
        if (tile.invalid || isInvalidCell) tcls.push("invalid");
        const tval = tile.isBlank ? "" : LETTER_VALUE[tile.letter];
        // Les tuiles "pending" sont draggables (pour les déplacer)
        const dragAttr = tile.pending ? `draggable="true" data-pending-r="${r}" data-pending-c="${c}"` : "";
        tileHtmlStr = `<div class="${tcls.join(" ")}" ${dragAttr}>${tile.letter}<span class="val">${tval ?? ""}</span></div>`;
      }
      // Badge de score progressif : dans la case calculée (après le mot).
      let badge = "";
      if (badgeCell && badgeCell.r === r && badgeCell.c === c && badgeScore != null) {
        badge = `<span class="score-badge${badgeDir === "V" ? " badge-v" : ""}">${badgeScore}</span>`;
        cls.push("has-badge");   // remonte la case au-dessus du curseur voisin
      }
      const annot = renderAnnotations(r, c);
      html += `<td class="${cls.join(" ")}" data-r="${r}" data-c="${c}">${tileHtmlStr}${badge}${annot}</td>`;
    }
    if (showCoords) html += `<td class="coord">${ROW_LETTERS[r]}</td>`;
    html += "</tr>";
  }
  if (showCoords) {
    html += `<tr><td class="coord corner"></td>`;
    for (let c = 0; c < BOARD_SIZE; c++) html += `<td class="coord">${c + 1}</td>`;
    html += `<td class="coord corner"></td></tr>`;
  }
  html += "</table>";
  div.innerHTML = html;
  div.querySelectorAll("td[data-r]").forEach(td => {
    const r = +td.dataset.r, c = +td.dataset.c;
    td.onclick = () => handleBoardClick(r, c);
    td.addEventListener("contextmenu", (e) => { e.preventDefault(); handleBoardRightClick(r, c); });
    td.addEventListener("dragover", onCellDragOver);
    td.addEventListener("dragleave", onCellDragLeave);
    td.addEventListener("drop", onCellDrop);
    td.addEventListener("mousedown", (e) => onCellMouseDown(e, r, c));
    td.addEventListener("mouseup",   (e) => onCellMouseUp(e, r, c));
    td.addEventListener("touchstart", (e) => onCellTouchStart(e, r, c), { passive: true });
    td.addEventListener("touchend",   (e) => onCellTouchEnd(e, r, c));
    td.addEventListener("touchcancel",() => { _swipeStart = null; });
  });
  // Tuiles "pending" sur le plateau : draggables pour déplacement
  div.querySelectorAll(".tile[data-pending-r]").forEach(el => {
    el.addEventListener("dragstart", onPendingTileDragStart);
    el.addEventListener("dragend", onDragEnd);
  });
  renderTopFrame();
}

// Cadre de mise en évidence du mot top : un SEUL rectangle posé en superposition
// par-dessus tout le plateau (z-index élevé) → il passe AU-DESSUS des flèches des
// cases multiplicatrices, contrairement à des bordures de cellules. Recalculé à
// chaque rendu à partir des cases du mot (persiste jusqu'au clic sur la grille).
function renderTopFrame() {
  const board = $("#board");
  if (!board) return;
  let frame = board.querySelector(".top-frame");
  const tw = (state.settings.highlightTop !== false) ? (state.lastTopCells || []) : [];
  if (!tw.length) { if (frame) frame.remove(); return; }
  const first = board.querySelector(`td[data-r="${tw[0].row}"][data-c="${tw[0].col}"]`);
  const last  = board.querySelector(`td[data-r="${tw[tw.length - 1].row}"][data-c="${tw[tw.length - 1].col}"]`);
  if (!first || !last) { if (frame) frame.remove(); return; }
  const br = board.getBoundingClientRect();
  const a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
  const left   = Math.min(a.left, b.left)   - br.left;
  const top    = Math.min(a.top, b.top)     - br.top;
  const right  = Math.max(a.right, b.right) - br.left;
  const bottom = Math.max(a.bottom, b.bottom) - br.top;
  if (!frame) { frame = document.createElement("div"); frame.className = "top-frame"; board.appendChild(frame); }
  // On déborde légèrement (2 px) pour que le cadre entoure bien les jetons.
  frame.style.left   = (left - 2) + "px";
  frame.style.top    = (top - 2) + "px";
  frame.style.width  = (right - left + 4) + "px";
  frame.style.height = (bottom - top + 4) + "px";
}

// Renvoie la tuile à afficher en (r,c) : prioritaire pending, sinon plateau
function cellTile(r, c) {
  const pending = state.pending.find(p => p.row === r && p.col === c);
  if (pending) {
    return { letter: pending.letter, isBlank: pending.isBlank, pending: true, invalid: !!pending.invalid };
  }
  return state.board[r][c];
}

function renderRack() {
  const div = $("#rack");
  // Taille du chevalet pour le calibrage des jetons sur mobile : on prend la
  // taille MAX du mode (7/8/9), constante toute la partie, et JAMAIS le nombre
  // courant de lettres → les jetons gardent la même taille même s'il n'en reste
  // que 2 ou 3 en fin de partie (sinon ils deviendraient énormes).
  const rackSize = currentMode().rackSize;
  document.documentElement.style.setProperty("--rack-size", String(rackSize));
  if (state.rack.length === 0 && !state.started) {
    const size = currentMode().rackSize;
    div.innerHTML = Array.from({ length: size }, () => `<div class="tile empty"></div>`).join("");
    return;
  }
  let tiles = [...state.rack];
  // _tempUnsorted : override transitoire (F1 / drag-reorder) qui ignore le tri pour ce render
  if (state.settings.sortRack && !state._tempUnsorted) {
    tiles.sort((a, b) => {
      if (a.letter === "?" && b.letter !== "?") return 1;
      if (b.letter === "?" && a.letter !== "?") return -1;
      return a.letter.localeCompare(b.letter);
    });
  }
  // Mémoriser l'ordre AFFICHÉ (ids) → sert au réordonnancement directionnel.
  _rackOrder = tiles.map(t => t.id);
  // Génère les tuiles draggables
  div.innerHTML = tiles.map(t => {
    const blank = t.letter === "?";
    const val = blank ? "" : LETTER_VALUE[t.letter];
    const cls = ["tile"];
    if (t.used) cls.push("used");
    if (blank) cls.push("blank");
    const draggable = t.used ? "" : `draggable="true" data-rack-id="${t.id}"`;
    return `<div class="${cls.join(" ")}" ${draggable}>${t.letter || ""}<span class="val">${val ?? ""}</span></div>`;
  }).join("");
  // Bind handlers DnD + tap (mobile-friendly : tap = place la lettre au curseur,
  // tap sur joker = ouvre le sélecteur A-Z).
  div.querySelectorAll(".tile[data-rack-id]").forEach(el => {
    el.addEventListener("dragstart", onRackTileDragStart);
    el.addEventListener("dragend", onDragEnd);
    el.addEventListener("dragover", onRackTileDragOver);
    el.addEventListener("drop", onRackTileDrop);
    el.addEventListener("click", onRackTileTap);
    el.addEventListener("touchstart", onRackTileTouchStart, { passive: false });
  });
}

// Pose la tuile de chevalet d'id donné au curseur courant (joker → sélecteur).
// Appelé soit par le click natif (desktop), soit directement au touchend (mobile).
function tapRackTile(id) {
  if (review.active) return;
  const t = state.rack.find(x => x.id === id);
  if (!t || t.used) return;
  if (!state.cursor) {
    flashFeedback("error", "Pas de curseur", "Touche d'abord une case du plateau.");
    return;
  }
  if (t.letter === "?") {
    openJokerPicker();
  } else {
    // On passe l'ID de la tuile cliquée pour que ce soit CETTE tuile-là qui
    // disparaisse du chevalet (pas la première de la même lettre).
    placeLetter(t.letter, t.id);
  }
}
function onRackTileTap(e) {
  tapRackTile(+e.currentTarget.dataset.rackId);
}

// --- Sélecteur de lettre pour joker (mobile + desktop) ---
function openJokerPicker() {
  let modal = document.getElementById("jokerPicker");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "jokerPicker";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="backdrop" onclick="closeJokerPicker()"></div>
      <div class="content" style="max-width:340px">
        <button class="close" onclick="closeJokerPicker()">×</button>
        <h2 style="margin-top:0;font-size:1.1rem">Joker : choisir la lettre</h2>
        <div id="jokerPickerGrid" class="joker-picker-grid"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const grid = modal.querySelector("#jokerPickerGrid");
  grid.innerHTML = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(L =>
    `<button class="joker-pick" data-letter="${L}">${L}</button>`).join("");
  grid.querySelectorAll(".joker-pick").forEach(b => {
    b.onclick = () => {
      const L = b.dataset.letter;
      closeJokerPicker();
      state.jokerPending = true;
      placeLetter(L);
    };
  });
  modal.hidden = false;
}
window.closeJokerPicker = () => {
  const m = document.getElementById("jokerPicker");
  if (m) m.hidden = true;
};

// ===== Drag & Drop : chevalet + tuiles posées =====
let _dragRackId = null;
let _dragPendingFrom = null;     // { row, col } pour déplacement d'une tuile pending
let _rackOrder = [];             // ordre AFFICHÉ des tuiles (ids) — pour le réordonnancement
let _touchDrag = null;           // état du glisser tactile (mobile)

// Réordonne le chevalet en déplaçant la tuile `dragId` PAR RAPPORT à `targetId`,
// sans remélanger le reste. Direction : si on déplace vers la DROITE, la tuile
// se place à DROITE de la cible ; vers la GAUCHE, à GAUCHE. Pas besoin de viser
// l'interstice exact : lâcher au-dessus d'une lettre suffit.
function reorderRack(dragId, targetId) {
  if (dragId === targetId) return;
  const order = (_rackOrder && _rackOrder.length) ? _rackOrder.slice() : state.rack.map(t => t.id);
  const fromI = order.indexOf(dragId);
  const toI = order.indexOf(targetId);
  if (fromI < 0 || toI < 0 || fromI === toI) return;
  const movingRight = fromI < toI;
  order.splice(fromI, 1);
  let insertAt = order.indexOf(targetId);
  if (movingRight) insertAt += 1;          // à droite de la cible ; sinon à gauche
  order.splice(insertAt, 0, dragId);
  state.rack = order.map(id => state.rack.find(t => t.id === id)).filter(Boolean);
  state._tempUnsorted = true;              // fige cet ordre manuel (pas de re-tri)
  renderRack();
}

// Pose une lettre du chevalet (rackId) sur la case (r,c). Factorisé pour être
// réutilisé par le drag HTML5 (desktop) ET le drag tactile (mobile).
function placeRackTileOnCell(rackId, r, c) {
  if (clearInvalidFlash()) renderRack();
  if (state.board[r][c] || state.pending.some(p => p.row === r && p.col === c)) return;
  const tile = state.rack.find(t => t.id === rackId);
  if (!tile || tile.used) return;
  let letter = tile.letter, isBlank = false;
  if (tile.letter === "?") {
    const L = (prompt("Lettre à associer au joker (A-Z) :", "") || "").trim().toUpperCase();
    if (!/^[A-Z]$/.test(L)) return;
    letter = L; isBlank = true;
  }
  tile.used = true;
  state.pending.push({ row: r, col: c, letter, rackId: tile.id, isBlank });
  updateCursorAfterDrop(r, c);
  renderBoard();
  renderRack();
}

// ===== Glisser TACTILE (mobile) : réordonner le chevalet OU poser sur la grille =====
function onRackTileTouchStart(e) {
  if (!e.touches || e.touches.length !== 1) return;
  const el = e.currentTarget;
  const t = e.touches[0];
  _touchDrag = { id: +el.dataset.rackId, startX: t.clientX, startY: t.clientY, moved: false, ghost: null, srcEl: el };
  document.addEventListener("touchmove", onRackTouchMove, { passive: false });
  document.addEventListener("touchend", onRackTouchEnd, { passive: false });
  document.addEventListener("touchcancel", onRackTouchEnd, { passive: false });
}
function onRackTouchMove(e) {
  if (!_touchDrag) return;
  const t = e.touches[0];
  if (!_touchDrag.moved) {
    // Seuil généreux : en dessous, on reste sur un TAP (pose au curseur). Un appui
    // « ferme » bouge souvent de quelques pixels — un seuil trop bas le requalifiait
    // à tort en glisser, et le tap était perdu (d'où l'impression d'« appuyer fort »).
    if (Math.hypot(t.clientX - _touchDrag.startX, t.clientY - _touchDrag.startY) < 14) return;
    _touchDrag.moved = true;
    const tile = state.rack.find(x => x.id === _touchDrag.id);
    const g = document.createElement("div");
    g.className = "tile drag-ghost";
    const v = tile && tile.letter !== "?" ? (LETTER_VALUE[tile.letter] ?? "") : "";
    g.innerHTML = `${tile?.letter || ""}<span class="val">${v}</span>`;
    if (tile?.letter === "?") g.classList.add("blank");
    document.body.appendChild(g);
    _touchDrag.ghost = g;
    _touchDrag.srcEl.classList.add("dragging");
  }
  e.preventDefault();   // empêche le défilement pendant le glisser
  if (_touchDrag.ghost) { _touchDrag.ghost.style.left = t.clientX + "px"; _touchDrag.ghost.style.top = t.clientY + "px"; }
  $$(".board td.drop-target").forEach(td => td.classList.remove("drop-target"));
  const under = document.elementFromPoint(t.clientX, t.clientY);
  const td = under && under.closest && under.closest("td[data-r]");
  if (td && !td.classList.contains("has-tile")) td.classList.add("drop-target");
}
function onRackTouchEnd(e) {
  document.removeEventListener("touchmove", onRackTouchMove);
  document.removeEventListener("touchend", onRackTouchEnd);
  document.removeEventListener("touchcancel", onRackTouchEnd);
  const drag = _touchDrag; _touchDrag = null;
  if (!drag) return;
  if (drag.ghost) drag.ghost.remove();
  drag.srcEl && drag.srcEl.classList.remove("dragging");
  $$(".board td.drop-target").forEach(td => td.classList.remove("drop-target"));
  if (!drag.moved) {
    // Tap simple : on pose IMMÉDIATEMENT au touchend, sans attendre le click natif.
    // Celui-ci arrive en différé (≈300 ms / détection double-tap), peut être avalé
    // lors de taps rapides, et — surtout — viserait une tuile reconstruite par
    // renderRack() (donc une AUTRE lettre). On bloque ce click synthétique via
    // preventDefault (listener non passif) pour éviter toute double pose.
    e.preventDefault();
    tapRackTile(drag.id);
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }
    return;
  }
  const t = e.changedTouches && e.changedTouches[0];
  // Glisser sans point de relâche exploitable → on retombe sur un tap (pose au curseur).
  if (!t) { tapRackTile(drag.id); return; }
  const under = document.elementFromPoint(t.clientX, t.clientY);
  const td = under && under.closest && under.closest("td[data-r]");
  if (td) { placeRackTileOnCell(drag.id, +td.dataset.r, +td.dataset.c); return; }
  const rt = under && under.closest && under.closest(".tile[data-rack-id]");
  // Relâché sur une AUTRE tuile → réordonnancement ; sur la même tuile → tap.
  if (rt && +rt.dataset.rackId !== drag.id) { reorderRack(drag.id, +rt.dataset.rackId); return; }
  // Petit glissé qui ne vise ni une case ni une autre tuile (resté sur le chevalet
  // ou relâché « dans le vide ») → on est indulgent : on pose au curseur comme un tap.
  tapRackTile(drag.id);
}

function onRackTileDragStart(e) {
  _dragRackId = +e.currentTarget.dataset.rackId;
  _dragPendingFrom = null;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(_dragRackId));
  e.currentTarget.classList.add("dragging");
}
function onPendingTileDragStart(e) {
  const r = +e.currentTarget.dataset.pendingR;
  const c = +e.currentTarget.dataset.pendingC;
  _dragPendingFrom = { row: r, col: c };
  _dragRackId = null;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", `pending:${r},${c}`);
  e.currentTarget.classList.add("dragging");
}
function onDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  _dragRackId = null;
  _dragPendingFrom = null;
  $$(".board td.drop-target").forEach(td => td.classList.remove("drop-target"));
}
function onRackTileDragOver(e) {
  if (_dragRackId == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}
function onRackTileDrop(e) {
  if (_dragRackId == null) return;
  e.preventDefault();
  reorderRack(_dragRackId, +e.currentTarget.dataset.rackId);
}

// Drop sur une case de la grille = pose la lettre tirée du chevalet
function onCellDragOver(e) {
  if (_dragRackId == null && !_dragPendingFrom) return;
  const td = e.currentTarget;
  const r = +td.dataset.r, c = +td.dataset.c;
  // Cible doit être vide (ni committed, ni pending — sauf si on déplace une tuile sur sa propre case)
  if (state.board[r][c]) return;
  const occupiedByOtherPending = state.pending.some(p =>
    p.row === r && p.col === c &&
    !(_dragPendingFrom && p.row === _dragPendingFrom.row && p.col === _dragPendingFrom.col)
  );
  if (occupiedByOtherPending) return;
  e.preventDefault();
  td.classList.add("drop-target");
}
function onCellDragLeave(e) {
  e.currentTarget.classList.remove("drop-target");
}
function onCellDrop(e) {
  if (_dragRackId == null && !_dragPendingFrom) return;
  e.preventDefault();
  const td = e.currentTarget;
  td.classList.remove("drop-target");
  const r = +td.dataset.r, c = +td.dataset.c;
  // ===== Déplacement d'une tuile pending =====
  if (_dragPendingFrom) {
    const src = _dragPendingFrom;
    if (state.board[r][c]) return;
    if (src.row === r && src.col === c) return;
    const occupiedByOther = state.pending.some(p => p.row === r && p.col === c);
    if (occupiedByOther) return;
    const tile = state.pending.find(p => p.row === src.row && p.col === src.col);
    if (!tile) return;
    tile.row = r;
    tile.col = c;
    updateCursorAfterDrop(r, c);
    renderBoard();
    return;
  }
  // ===== Pose depuis le chevalet =====
  placeRackTileOnCell(_dragRackId, r, c);
}

// Repositionne le curseur en déduisant le sens H/V d'après les tuiles posées.
// Saute par-dessus les lettres committées et pending sur le chemin.
function updateCursorAfterDrop(r, c) {
  const pending = state.pending;
  if (pending.length === 0) return;
  let row, col, dir;
  if (pending.length === 1) {
    row = r; col = c + 1; dir = "H";
  } else {
    const sameRow = pending.every(p => p.row === pending[0].row);
    const sameCol = pending.every(p => p.col === pending[0].col);
    if (sameRow) {
      row = pending[0].row;
      col = Math.max(...pending.map(p => p.col)) + 1;
      dir = "H";
    } else if (sameCol) {
      col = pending[0].col;
      row = Math.max(...pending.map(p => p.row)) + 1;
      dir = "V";
    } else {
      return; // non aligné, on laisse
    }
  }
  // Sauter les cases occupées (committées ou pending) dans la direction du jeu
  const dr = dir === "V" ? 1 : 0;
  const dc = dir === "H" ? 1 : 0;
  while (row < BOARD_SIZE && col < BOARD_SIZE && (state.board[row]?.[col] || state.pending.some(p => p.row === row && p.col === col))) {
    row += dr; col += dc;
  }
  if (row < BOARD_SIZE && col < BOARD_SIZE) state.cursor = { row, col, dir };
}

function shuffleRack() {
  const idxs = state.rack.map((t, i) => t.used ? -1 : i).filter(i => i >= 0);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.rack[idxs[i]], state.rack[idxs[j]]] = [state.rack[idxs[j]], state.rack[idxs[i]]];
  }
  state._tempUnsorted = true;   // override le tri alpha pour montrer le mélange
  renderRack();
}
function restoreRackSort() {
  // Tri alpha forcé (indépendant du réglage sortRack) : F2 doit toujours ranger.
  const free = state.rack.map((t, i) => ({ t, i })).filter(x => !x.t.used);
  free.sort((a, b) => (a.t.letter === "?" ? "ZZ" : a.t.letter).localeCompare(
                       b.t.letter === "?" ? "ZZ" : b.t.letter));
  let k = 0;
  for (let i = 0; i < state.rack.length; i++) {
    if (!state.rack[i].used) { state.rack[i] = free[k++].t; }
  }
  state._tempUnsorted = false;
  renderRack();
}

function renderInfo() {
  const moveNoEl = document.getElementById("moveNo");
  if (moveNoEl) moveNoEl.textContent = state.moveNo;
  const prevNoEl = document.getElementById("prevMoveNo");
  const prevNegEl = document.getElementById("prevNeg");
  const prevTimeEl = document.getElementById("prevTime");
  // ===== Mode éditeur : on n'affiche que CUMUL (somme des tops) et COUP. =====
  if (editorActive()) {
    $("#totalScore").textContent = state.totalScore || 0;
    $("#sumNeg").textContent = "—";
    const coup = (state._coups ? state._coups.length : 0) + 1;
    if (prevNoEl) prevNoEl.textContent = coup;        // « Coup » = coup en cours
    if (prevNegEl) prevNegEl.textContent = "—";
    if (prevTimeEl) prevTimeEl.textContent = "—";
    setInfoLabel("prevMoveNo", "Coup");
    renderChrono(); renderMoveTimer(); renderBag();
    return;
  }
  $("#totalScore").textContent = state.totalScore;
  $("#sumNeg").textContent = state.sumNeg;
  // Section "coup précédent"
  const last = state.history?.[state.history.length - 1];
  const noTime = playMode() === "duplicate";   // temps non pertinent
  if (prevNoEl)   prevNoEl.textContent   = last ? last.moveNo : "—";
  if (prevNegEl)  prevNegEl.textContent  = last ? last.neg : "—";
  if (prevTimeEl) prevTimeEl.textContent = noTime ? "—" : (last ? fmtChrono(Math.round((last.timeMs || 0) / 1000)) : "—");
  renderChrono();
  renderMoveTimer();
  renderBag();
}
// Met à jour le libellé (.label) au-dessus d'une valeur de l'info-bar.
function setInfoLabel(valueId, text) {
  const v = document.getElementById(valueId);
  const item = v && v.closest(".item");
  const lbl = item && item.querySelector(".label");
  if (lbl) lbl.textContent = text;
}

const VOYELLES_SET = ["A","E","I","O","U","Y"];
// En partie pré-tirée/tournoi/puzzle, state.bag n'est pas suivi. On reconstitue
// le contenu réel du sac à partir de l'invariant : chaque jeton est soit dans le
// sac, soit sur le chevalet, soit sur le plateau.
//   lettres restantes[L] = TOTAL[L] − posées sur le plateau − présentes en main
//   jokers restants       = TOTAL["?"] − blancs posés − jokers en main
// (un joker remplacé par une vraie lettre redevient disponible : il ne consomme
//  un joker que s'il reste blanc sur le plateau.)
function computeRemainingBagFromBoard() {
  const counts = { ...LETTER_BAG };
  const jokerTotal = LETTER_BAG["?"] || 0;
  let boardBlanks = 0;
  for (let r = 0; r < state.board.length; r++) {
    for (let c = 0; c < state.board[r].length; c++) {
      const cell = state.board[r][c];
      if (!cell) continue;
      if (cell.isBlank) boardBlanks++;
      else counts[cell.letter] = (counts[cell.letter] || 0) - 1;
    }
  }
  let rackJokers = 0;
  for (const t of state.rack) {
    if (t.letter === "?") rackJokers++;
    else counts[t.letter] = (counts[t.letter] || 0) - 1;
  }
  counts["?"] = Math.max(0, jokerTotal - boardBlanks - rackJokers);
  return counts;
}

function renderBag() {
  const el = $("#bagDisplay");
  if (!el) return;
  // Pas de sac en review (on revoit les coups, le sac n'a pas de sens).
  if (!state.started || review.active) { el.hidden = true; return; }
  el.hidden = false;
  let counts;
  if (state.prepared || state.isPuzzle) {
    // Partie pré-tirée : reconstitution exacte depuis le plateau + le chevalet.
    counts = computeRemainingBagFromBoard();
  } else {
    counts = { ...state.bag };
    if (effJoker() && state.spareJokers > 0) {
      counts["?"] = (counts["?"] || 0) + state.spareJokers;
    }
  }
  const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const consonnes = allLetters.filter(l => !VOYELLES_SET.includes(l));
  const ordered = [...VOYELLES_SET, ...consonnes, "?"];
  const total = Object.values(counts).reduce((a, n) => a + (n > 0 ? n : 0), 0);
  $("#bagCount").textContent = total;
  const picking = !!state._drawPhase;   // tirage manuel : les jetons du sac sont cliquables
  $("#bagTiles").innerHTML = ordered.map(l => {
    const n = counts[l] || 0;
    if (n <= 0) return "";   // jamais de compteur négatif (double-décompte transitoire)
    const cls = ["bag-chip"];
    if (l === "?") cls.push("joker");
    if (picking) cls.push("pickable");
    const attr = picking ? ` data-pick="${l}" role="button" tabindex="0"` : "";
    return `<span class="${cls.join(" ")}"${attr}>${l}<span class="ct">${n}</span></span>`;
  }).join("");
  if (picking) {
    $("#bagTiles").querySelectorAll("[data-pick]").forEach(ch => {
      ch.onclick = () => drawPickLetter(ch.dataset.pick);
    });
  }
}

// Case où placer le badge de score (rightmost en H, bottommost en V, sinon dernière posée).
// On essaie d'éviter une case déjà occupée par un jeton (mieux lisible) : on avance
// d'une case dans la direction du mot vers une case libre ; à défaut on prend la case
// avant le mot ; si rien de libre n'est trouvé, on retombe sur la dernière case pending.

function computePendingScore() {
  if (state.pending.length === 0) return null;
  const m = buildMoveFromPending();
  if (!m) return null;
  const r = scoreMove(state.board, m, null, { bonuses: currentMode().bonuses, jokerPays: currentMode().jokerPays, layout: state.boardLayout });
  if (r.errors.length) return null;
  return r.score;
}

function renderMoveTimer() {
  const chip = $("#moveTimerChip");
  const el = $("#moveTimer");
  const label = $("#moveTimerLabel");
  if (!el || !chip) return;
  if (editorActive()) { chip.style.display = "none"; return; }   // pas de minuteur en éditeur
  if (label) label.textContent = `Coup ${state.moveNo}`;
  if (state.settings.timePerMove > 0 && state.started && !state.chronoFinal) {
    el.textContent = `${state.moveTimeLeft}s`;
    // Chrono Challenge : la chip passe en rouge dans les 10 dernières secondes.
    // Chrono Zen : pas de changement de couleur, même apparence du début à la fin.
    const zen = state.settings.chronoType === "zen";
    chip.classList.toggle("danger", !zen && state.moveTimeLeft <= 10);
    chip.style.display = "";
  } else if (playMode() === "duplicate" && state.started) {
    // Duplicate sans temps par coup → « — » plutôt que de masquer la chip.
    el.textContent = "—";
    chip.classList.remove("danger");
    chip.style.display = "";
  } else {
    chip.style.display = "none";
  }
}

function elapsedSeconds() {
  if (state.chronoFinal !== null) return state.chronoFinal;
  if (!state.started || !state.chronoStart) return 0;
  return Math.floor((Date.now() - state.chronoStart) / 1000) + state.chronoPenalty;
}

function fmtChrono(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function renderChrono() {
  // En duplicate et en éditeur, le temps général n'est pas pertinent → « — ».
  if (playMode() === "duplicate" || editorActive()) {
    $("#chrono").textContent = "—";
    return;
  }
  $("#chrono").textContent = fmtChrono(elapsedSeconds());
}

let chronoTimer = null;
function startChrono() {
  state.chronoStart = Date.now();
  if (chronoTimer) clearInterval(chronoTimer);
  chronoTimer = setInterval(renderChrono, 1000);
}
function stopChrono() {
  state.chronoFinal = elapsedSeconds();
  clearInterval(chronoTimer);
  chronoTimer = null;
}

// ===== Minuteur par coup =====
let moveTimer = null;
function startMoveTimer() {
  state.moveStart = performance.now();
  if (moveTimer) clearInterval(moveTimer);
  if (state.settings.timePerMove > 0) {
    state.moveTimeLeft = state.settings.timePerMove;
    renderMoveTimer();
    moveTimer = setInterval(() => {
      state.moveTimeLeft--;
      renderMoveTimer();
      if (state.moveTimeLeft <= 0) {
        clearInterval(moveTimer);
        timeoutAdvance();
      }
    }, 1000);
  } else {
    renderMoveTimer();   // affiche « — » en duplicate sans temps, masque sinon
  }
}
function stopMoveTimer() {
  if (moveTimer) { clearInterval(moveTimer); moveTimer = null; }
  return state.moveStart ? performance.now() - state.moveStart : 0;
}

// Coup non trouvé dans le temps : on révèle le top sans pénalité supplémentaire
function timeoutAdvance() {
  if (!state.started) return;
  // Mode duplicate : fin de chrono → sélection du top puis coup suivant.
  if (playMode() === "duplicate") { duplicateChronoEnd(); return; }
  ensureTopReady();
  // Si le top reste introuvable (dictionnaire vraiment indisponible), on ne fige
  // PAS la partie : on relance le minuteur pour laisser une chance au dico de se
  // charger, plutôt que de rester bloqué sur le coup avec le chrono qui défile.
  if (!state.topMove) {
    if (!state.dict) { startMoveTimer(); return; }
    // Dico chargé mais aucun coup possible (ex. Snake bloqué) → fin de partie.
    endGame();
    return;
  }
  // Mode Top/sous-top : temps écoulé → crédit partiel des deux meilleurs mots trouvés.
  if (currentMode().dualTop) {
    const d = state._dual || {};
    const playerScore = (d.best?.score || 0) + (d.second?.score || 0);
    recordMove({ status: "timeout", playerScore, playedWord: d.best?.word || null, dual: dualSnapshot() });
    placeTopAndAdvance(playerScore, d.best?.word || null, playerScore, null);
    const st = state.subTop;
    const maxScore = (state.topMove.score || 0) + (st?.score || 0);
    showFeedback("miss", `⏱ Temps écoulé — tu marques ${playerScore} / ${maxScore}`, "");
    setTimeout(nextMove, 1000);
    return;
  }
  let playerScore = 0, playedWord = null;
  if (state.pending.length) {
    const m = buildMoveFromPending();
    if (m) {
      const r = scoreMove(state.board, m, state.dict, { bonuses: currentMode().bonuses, jokerPays: currentMode().jokerPays, layout: state.boardLayout });
      if (!r.errors.length) { playerScore = r.score; playedWord = m.word; }
    }
  }
  if (state.bestAttempt && state.bestAttempt.score > playerScore) {
    playerScore = state.bestAttempt.score;
    playedWord = state.bestAttempt.word;
  }
  const tm = state.topMove;
  // Coordonnées du mot joué (pending courant, sinon meilleur essai) pour que la
  // barre orange affiche "MOT — XX pts en POS" et la feuille de route la position.
  let playedMoveObj = state.pending.length ? buildMoveFromPending() : null;
  if (!playedMoveObj && state.bestAttempt?.move) playedMoveObj = state.bestAttempt.move;
  recordMove({ status: "timeout", playerScore, playedWord, playedMove: playedMoveObj });
  placeTopAndAdvance(playerScore, playedWord || null, playedWord ? playerScore : null, playedMoveObj);
  showFeedback("miss", `⏱ Temps écoulé — tu marques ${playerScore} pts`, "");
  setTimeout(nextMove, 1000);
}

// Enveloppe un mot Scrabble dans un lien cliquable vers elimots.com
function dictUrl(word) {
  return `https://elimots.com/ods?mot=${word.toLowerCase()}`;
}
function wLink(word) {
  if (!word) return word;
  return `<a href="${dictUrl(word)}" class="word-link" onclick="event.preventDefault();event.stopPropagation();openDictPanel('${word}')">${word}</a>`;
}

window.openDictPanel = function(word) {
  // Pas de dictionnaire pendant une partie tournoi en cours
  if (document.body.classList.contains("mode-tournament") && state.started && state.chronoFinal == null && !review.active) return;
  const url = dictUrl(word);
  // Si la feuille de route est ouverte, utiliser le volet latéral de la feuille
  if (!$("#sheet").hidden) {
    $("#sheetDictWord").textContent = word;
    $("#sheetDictExt").href = url;
    $("#sheetDictIframe").src = url;
    $("#sheetDictPanel").hidden = false;
    $("#sheet .sheet-content").classList.add("with-dict");
    return;
  }
  // En mode review : volet intégré dans la moitié basse du panneau review
  if (review.active) {
    $("#reviewDictWord").textContent = word;
    $("#reviewDictExt").href = url;
    $("#reviewDictIframe").src = url;
    $("#reviewDictPanel").hidden = false;
    document.querySelector(".review-split")?.classList.add("with-dict");
    return;
  }
  // Sinon volet inline du panneau droit
  $("#dictWord").textContent = word;
  $("#dictExt").href = url;
  $("#dictIframe").src = url;
  $("#dictPanel").hidden = false;
};

window.closeReviewDict = function() {
  $("#reviewDictPanel").hidden = true;
  $("#reviewDictIframe").src = "";
  document.querySelector(".review-split")?.classList.remove("with-dict");
};

window.closeDictPanel = function() {
  $("#dictPanel").hidden = true;
  $("#dictIframe").src = "";
};

window.closeSheetDict = function() {
  $("#sheetDictPanel").hidden = true;
  $("#sheetDictIframe").src = "";
  $("#sheet .sheet-content").classList.remove("with-dict");
};

function showFeedback(kind, title, detail = "", topReveal = "") {
  const div = $("#feedback");
  if (!title && !detail && !topReveal) { div.hidden = true; return; }
  div.hidden = false;
  div.className = "feedback " + (kind || "");
  div.innerHTML = `
    <div class="title">${title}</div>
    ${detail ? `<div class="detail">${detail}</div>` : ""}
    ${topReveal ? `<div class="top-reveal">${topReveal}</div>` : ""}
  `;
}
function hideFeedback() {
  const div = $("#feedback");
  div.hidden = true;
  // Sur mobile la zone est forcée visible par CSS (espace réservé) ; on vide
  // donc explicitement le contenu pour que rien ne traîne d'un coup à l'autre.
  div.innerHTML = "";
  div.className = "feedback";
  hideTopFeedback();
  // Effacer aussi la surbrillance bleue du mot top et annuler son timer
  if (topWordTimer) { clearTimeout(topWordTimer); topWordTimer = null; }
  state.lastTopCells = [];
}

function showTransientError(title, detail = "", ms = 1600) {
  showFeedback("error", title, detail);
  clearTimeout(state._errorTimeout);
  // À la fin du message d'erreur, on NE masque pas : on restaure l'info
  // persistante (meilleur essai du coup, sinon repère du coup précédent) →
  // aucun message « pose invalide / rien à valider… » ne fait perdre le score.
  state._errorTimeout = setTimeout(() => restorePersistentFeedback(), ms);
}

// HTML du "meilleur essai" courant, avec sa position (ex. "NI — 9 pts en B12 — meilleur essai").
function bestAttemptHTML() {
  const b = state.bestAttempt;
  if (!b) return null;
  const pos = b.move ? ` en ${posLabel(b.move)}` : "";
  return `<strong>${wLink(b.word)}</strong> — <strong>${b.score}</strong> pts${pos} — meilleur essai`;
}

// Réaffiche l'information persistante de la fenêtre orange : meilleur essai du
// coup en cours s'il existe, sinon le repère du coup précédent (showLastTopFeedback).
function restorePersistentFeedback() {
  const html = bestAttemptHTML();
  if (html) { showFeedback("miss", html, ""); return; }
  showLastTopFeedback();
}

function showTopFeedback(word, score, pos = "") {
  const div = $("#feedbackTop");
  if (!div) return;
  div.className = "feedback success";
  const posStr = pos ? ` en ${pos}` : "";
  div.innerHTML = `<div class="title">✅ Top : <strong>${wLink(word)}</strong> — <strong>${score}</strong> pts${posStr}</div>`;
  div.hidden = false;
}
function hideTopFeedback() {
  const div = $("#feedbackTop");
  if (div) { div.hidden = true; div.innerHTML = ""; }
}

function applyRackPos() {
  const wrap = $("#gameWrap");
  wrap.classList.toggle("rack-top", state.settings.rackPos === "top");
  wrap.classList.toggle("rack-bottom", state.settings.rackPos !== "top");
}
function applyColorTheme() {
  document.body.classList.toggle("theme-duplijeu", state.settings.colorTheme === "duplijeu");
}

function renderGameTitle() {
  const el = $("#gameTitle");
  if (!el) return;
  const modeLabel = modeDisplayName(state.settings.gameMode, state.settings.withJoker);
  const timeLabel = state.settings.timePerMove > 0 ? ` · ${state.settings.timePerMove}s/coup` : "";
  // .gt-context = badge + nom (masqué sur mobile) ; .gt-params = mode + temps
  // (toujours affiché, y compris sur mobile).
  const params = `<span class="gt-params">${modeLabel}${timeLabel}</span>`;
  if (review.active && review.game) {
    el.innerHTML = `<span class="gt-context"><span class="badge review">REVOIR</span> « ${escapeHtmlS(review.game.name)} » · </span>${params}`;
  } else if (state.prepared) {
    el.innerHTML = `<span class="gt-context"><span class="badge">PARTIE</span> « ${escapeHtmlS(state.prepared.name)} » · </span>${params}`;
  } else {
    el.innerHTML = `<span class="gt-context"><span class="badge">ENTRAÎNEMENT</span> </span>${params}`;
  }
}

function escapeHtmlS(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ============================================================
//  Curseur & frappe
// ============================================================
// Efface le contour du mot top (persistant). Appelé dès que le joueur clique
// sur la grille → le contour reste affiché tant qu'il n'a pas cliqué.
function clearTopHighlight() {
  if (state.lastTopCells && state.lastTopCells.length) {
    state.lastTopCells = [];
    state.lastPlaced = [];
    renderBoard();
  }
}

function handleBoardClick(r, c) {
  if (review.active) return;
  if (state.annotTool) { annotateCell(r, c); return; }
  // En éditeur : clic = placer le curseur (même sur une case occupée). 2e clic
  // sur la même case = bascule H↔V. On annule d'abord un éventuel aperçu.
  if (editorActive()) {
    editorRestoreBoard();
    if (state.cursor && state.cursor.row === r && state.cursor.col === c)
      state.cursor.dir = state.cursor.dir === "H" ? "V" : "H";
    else state.cursor = { row: r, col: c, dir: state.cursor?.dir || "H" };
    renderBoard();
    return;
  }
  // Flash "mot faux" en cours → on l'annule pour que le clic agisse tout de
  // suite (les cases redeviennent libres, les lettres reviennent au chevalet).
  if (clearInvalidFlash()) renderRack();
  clearTopHighlight();   // tout clic sur la grille efface le contour du top
  if (state.board[r][c]) return;   // case déjà validée → intouchable
  const clickedOnPending = state.pending.some(p => p.row === r && p.col === c);
  // Clic sur un jeton qu'on vient de SAISIR : on le récupère (avec ceux posés
  // après) au chevalet et on replace le curseur sur cette case, pour pouvoir
  // repartir immédiatement (ex. changer de sens). Plus besoin de cliquer
  // ailleurs d'abord pour « vider la grille ». 2e clic même case = bascule H↔V.
  if (clickedOnPending) {
    const sameCursor = state.cursor && state.cursor.row === r && state.cursor.col === c;
    clearPendingFrom(r, c);
    state.cursor = { row: r, col: c, dir: sameCursor ? (state.cursor.dir === "H" ? "V" : "H") : "H" };
    renderRack();
    renderBoard();
    return;
  }
  // Si on a des tuiles en cours de pose et qu'on clique en dehors, on les renvoie
  // sur le chevalet (annule la saisie) puis on repositionne le curseur.
  if (state.pending.length > 0) {
    // Sur MOBILE : un clic sur la grille ne renvoie PLUS les lettres au chevalet
    // (trop d'annulations accidentelles). On ne fait rien → le joueur voit que
    // ce n'est pas validé, et annule volontairement via le bouton ✕ rouge.
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
    if (isMobile) return;
    clearPending();
    state.cursor = { row: r, col: c, dir: "H" };
    renderRack();
    renderBoard();
    return;
  }
  if (state.cursor && state.cursor.row === r && state.cursor.col === c) {
    state.cursor.dir = state.cursor.dir === "H" ? "V" : "H";
  } else {
    // Nouvelle case : on repart toujours en horizontal (2e clic = bascule en V).
    state.cursor = { row: r, col: c, dir: "H" };
  }
  renderBoard();
}

// Clic droit : place le curseur en vertical directement (sans nécessiter
// un 2ème clic). N'agit que sur les cases libres, hors mode annotation/review.
function handleBoardRightClick(r, c) {
  if (review.active) return;
  if (state.annotTool) return;
  // En éditeur : clic droit = curseur vertical sur la case (même occupée).
  if (editorActive()) {
    editorRestoreBoard();
    state.cursor = { row: r, col: c, dir: "V" };
    renderBoard();
    return;
  }
  if (state.board[r][c]) return;
  if (state.pending.length > 0) {
    const clickedOnPending = state.pending.some(p => p.row === r && p.col === c);
    // Clic droit sur un jeton qu'on vient de saisir : on le récupère (et ceux
    // posés après) au chevalet, puis on place le curseur EN VERTICAL sur cette
    // case → on peut retaper le mot dans l'autre sens sans manip préalable.
    if (clickedOnPending) clearPendingFrom(r, c);
    else clearPending();
    renderRack();
  }
  state.cursor = { row: r, col: c, dir: "V" };
  renderBoard();
}

function clearPending() {
  for (const t of state.rack) t.used = false;
  state.pending = [];
  state.jokerPending = false;
}

// Renvoie au chevalet le jeton posé sur (r,c) ET tous ceux saisis APRÈS lui
// (ordre de pose), en libérant leurs cases. Sert à re-cliquer sur une case déjà
// occupée par un jeton qu'on vient de saisir pour y replacer le curseur.
// Renvoie true si un jeton en cours s'y trouvait.
// Repose les jetons en cours de saisie dans l'autre sens, en conservant la MÊME
// case de départ (la 1ʳᵉ lettre du mot). Les lettres gardent leur ordre ; on les
// place sur des cases libres consécutives dans le nouveau sens. Le curseur se
// place juste après la dernière lettre.
function relayPendingInDirection(newDir) {
  const oldDir = state.cursor.dir;
  const ps = state.pending.slice().sort((a, b) => oldDir === "H" ? a.col - b.col : a.row - b.row);
  if (!ps.length) { state.cursor.dir = newDir; return; }
  const dr = newDir === "V" ? 1 : 0, dc = newDir === "H" ? 1 : 0;
  let r = ps[0].row, c = ps[0].col;   // même case de départ que le mot d'origine
  for (const p of ps) {
    // prochaine case libre (non occupée par un jeton DÉJÀ validé) dans le nouveau sens
    while (r < BOARD_SIZE && c < BOARD_SIZE && state.board[r][c]) { r += dr; c += dc; }
    if (r >= BOARD_SIZE || c >= BOARD_SIZE) break;
    p.row = r; p.col = c;
    r += dr; c += dc;
  }
  // Curseur après la dernière lettre, sur une case libre.
  while (r < BOARD_SIZE && c < BOARD_SIZE && state.board[r][c]) { r += dr; c += dc; }
  state.cursor = (r < BOARD_SIZE && c < BOARD_SIZE)
    ? { row: r, col: c, dir: newDir }
    : { row: ps[0].row, col: ps[0].col, dir: newDir };
}

function clearPendingFrom(r, c) {
  const idx = state.pending.findIndex(p => p.row === r && p.col === c);
  if (idx < 0) return false;
  const removed = state.pending.splice(idx);
  for (const p of removed) {
    const t = state.rack.find(tt => tt.id === p.rackId);
    if (t) t.used = false;
  }
  state.jokerPending = false;
  return true;
}

function moveCursorKey(key) {
  const delta = {
    ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
  }[key];
  if (!delta) return;
  // Déplacement d'UNE case (le curseur n'enjambe plus les jetons : il passe
  // par-dessus toutes les cases, occupées ou non).
  const row = (state.cursor.row + delta[0] + BOARD_SIZE) % BOARD_SIZE;
  const col = (state.cursor.col + delta[1] + BOARD_SIZE) % BOARD_SIZE;
  state.cursor.row = row;
  state.cursor.col = col;
  renderBoard();
}

// ===== Annotations sur la grille =====

function setAnnotTool(t) {
  state.annotTool = t || "";
  $$(".annot-btn").forEach(b => b.classList.toggle("active", (b.dataset.tool ?? "") === state.annotTool));
  $("#board").classList.toggle("annot-mode", !!state.annotTool);
}

function annotateCell(r, c) {
  const key = `${r},${c}`;
  const t = state.annotTool;
  if (!t) return false;
  if (t === "erase") {
    delete state.annotations[key];
    // Effacer aussi les flèches qui passent par cette case
    state.arrowAnnotations = (state.arrowAnnotations || []).filter(a => !arrowPassesThrough(a, r, c));
  } else if (t === "arrow") {
    return false;   // la flèche se trace au mousedown/up, pas au click
  } else if (t.startsWith("dot-")) {
    const color = t.split("-")[1];
    const cur = state.annotations[key] || {};
    cur.dot = (cur.dot === color) ? null : color;   // re-clic même couleur = retire
    if (!cur.dot) delete cur.dot;
    state.annotations[key] = cur;
    if (Object.keys(cur).length === 0) delete state.annotations[key];
  } else {
    // texte dans un coin / centre
    const text = (prompt(`Texte (1-3 caractères max) :`, (state.annotations[key]?.[t]) || "") || "").trim().slice(0, 3);
    const cur = state.annotations[key] || {};
    if (text) cur[t] = text; else delete cur[t];
    if (Object.keys(cur).length === 0) delete state.annotations[key];
    else state.annotations[key] = cur;
  }
  renderBoard();
  return true;
}

window.clearAllAnnotations = function () {
  const hasAny = Object.keys(state.annotations).length || (state.arrowAnnotations || []).length;
  if (!hasAny) return;
  if (confirm("Effacer toutes les annotations ?")) {
    state.annotations = {};
    state.arrowAnnotations = [];
    renderBoard();
  }
};

// ===== Dessin de flèches par cliquer-glisser =====
let _arrowStart = null;
// --- Swipe sur mobile : swipe → = curseur H, swipe ↓ = curseur V ---
let _swipeStart = null;
const SWIPE_MIN = 24;        // pixels minimum pour distinguer swipe vs tap
const SWIPE_TIMEOUT = 700;   // ms : au-delà on ignore (probable hold)

function onCellTouchStart(e, r, c) {
  if (review.active) return;
  // En mode annotation "arrow" : start = case touchée, on enregistrera la flèche
  // sur le touchend (peu importe si le doigt termine sur une autre case).
  if (state.annotTool === "arrow") {
    _arrowStart = { r, c };
    return;
  }
  if (state.annotTool) return;
  if (state.board[r][c]) return;
  const t = e.touches[0];
  _swipeStart = { r, c, x: t.clientX, y: t.clientY, t: Date.now() };
}

function onCellTouchEnd(e, r, c) {
  // Mode annotation "arrow" : on calcule la case d'arrivée à partir des
  // coordonnées de touchend (le finger peut avoir glissé hors de la case
  // de départ, mais aussi être resté dans la même → on filtre ce cas).
  if (state.annotTool === "arrow" && _arrowStart) {
    const start = _arrowStart;
    _arrowStart = null;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const td = el && el.closest("td[data-r]");
    if (!td) return;
    const endR = +td.dataset.r, endC = +td.dataset.c;
    if (start.r === endR && start.c === endC) return;  // pas de flèche sur un simple tap
    const dr = Math.abs(endR - start.r), dc = Math.abs(endC - start.c);
    let toR = endR, toC = endC;
    if (dr > dc) toC = start.c; else toR = start.r;   // aligne sur l'axe dominant
    state.arrowAnnotations = state.arrowAnnotations || [];
    state.arrowAnnotations.push({ fromR: start.r, fromC: start.c, toR, toC });
    e.preventDefault();
    renderBoard();
    return;
  }
  if (!_swipeStart) return;
  const start = _swipeStart;
  _swipeStart = null;
  if (Date.now() - start.t > SWIPE_TIMEOUT) return;
  const t = (e.changedTouches && e.changedTouches[0]);
  if (!t) return;
  const dx = t.clientX - start.x;
  const dy = t.clientY - start.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < SWIPE_MIN && ady < SWIPE_MIN) return;   // tap : on laisse le click natif faire
  if (adx > ady && dx > 0) {
    // Swipe → : curseur en horizontal, départ = case touchée au début
    e.preventDefault();
    clearInvalidFlash();
    if (state.pending.length > 0) { clearPending(); renderRack(); }
    state.lastTopCells = []; state.lastPlaced = [];   // interaction grille → efface le cadre top
    state.cursor = { row: start.r, col: start.c, dir: "H" };
    renderBoard();
  } else if (ady > adx && dy > 0) {
    // Swipe ↓ : curseur en vertical
    e.preventDefault();
    clearInvalidFlash();
    if (state.pending.length > 0) { clearPending(); renderRack(); }
    state.lastTopCells = []; state.lastPlaced = [];   // interaction grille → efface le cadre top
    state.cursor = { row: start.r, col: start.c, dir: "V" };
    renderBoard();
  }
}

function onCellMouseDown(e, r, c) {
  if (state.annotTool !== "arrow") return;
  _arrowStart = { r, c };
  e.preventDefault();
}
function onCellMouseUp(e, r, c) {
  if (state.annotTool !== "arrow" || !_arrowStart) return;
  const start = _arrowStart;
  _arrowStart = null;
  if (start.r === r && start.c === c) return; // pas de flèche sur un seul clic
  // Aligner le point d'arrivée sur l'axe dominant (purement H ou V)
  const dr = Math.abs(r - start.r), dc = Math.abs(c - start.c);
  let endR = r, endC = c;
  if (dr > dc) endC = start.c; else endR = start.r;
  state.arrowAnnotations = state.arrowAnnotations || [];
  state.arrowAnnotations.push({ fromR: start.r, fromC: start.c, toR: endR, toC: endC });
  renderBoard();
}

function renderAnnotations(r, c) {
  if (!state.annotations) return "";
  let html = "";
  // Segments de flèches dans la case
  for (const a of (state.arrowAnnotations || [])) {
    const seg = arrowSegmentAt(a, r, c);
    if (!seg) continue;
    html += `<span class="arrow-line ${seg.cls}"></span>`;
    if (seg.head) html += `<span class="arrow-head ${seg.head}"></span>`;
  }
  const a = state.annotations[`${r},${c}`];
  if (a) {
    if (a.dot) html += `<span class="dot-mark ${a.dot}"></span>`;
    if (a.center) html += `<span class="annot center">${escapeHtmlS(a.center)}</span>`;
  }
  return html;
}

// Segment d'une flèche dans une case donnée (null si la case n'est pas sur le chemin)
function arrowSegmentAt(a, r, c) {
  if (a.fromR === a.toR && a.fromC === a.toC) return null;
  if (a.fromR === a.toR) {
    if (r !== a.fromR) return null;
    const minC = Math.min(a.fromC, a.toC), maxC = Math.max(a.fromC, a.toC);
    if (c < minC || c > maxC) return null;
    const right = a.toC > a.fromC;
    if (c === a.fromC) return { cls: right ? "h-half-right" : "h-half-left" };
    if (c === a.toC)   return { cls: right ? "h-half-left"  : "h-half-right", head: right ? "right" : "left" };
    return { cls: "h-full" };
  }
  if (a.fromC === a.toC) {
    if (c !== a.fromC) return null;
    const minR = Math.min(a.fromR, a.toR), maxR = Math.max(a.fromR, a.toR);
    if (r < minR || r > maxR) return null;
    const down = a.toR > a.fromR;
    if (r === a.fromR) return { cls: down ? "v-half-down" : "v-half-up" };
    if (r === a.toR)   return { cls: down ? "v-half-up"   : "v-half-down", head: down ? "down" : "up" };
    return { cls: "v-full" };
  }
  return null;
}

function arrowPassesThrough(a, r, c) {
  return !!arrowSegmentAt(a, r, c);
}

function isOccupied(r, c) {
  return !!state.board[r][c] || state.pending.some(p => p.row === r && p.col === c);
}

// Avance le curseur à la prochaine case libre dans la direction
function advanceCursor() {
  if (!state.cursor) return;
  const dr = state.cursor.dir === "V" ? 1 : 0;
  const dc = state.cursor.dir === "H" ? 1 : 0;
  let r = state.cursor.row + dr;
  let c = state.cursor.col + dc;
  while (r < BOARD_SIZE && c < BOARD_SIZE && isOccupied(r, c)) {
    r += dr; c += dc;
  }
  if (r >= BOARD_SIZE || c >= BOARD_SIZE) return; // bout du plateau
  state.cursor.row = r;
  state.cursor.col = c;
}

function handleKey(e) {
  // Laisser passer tous les raccourcis avec modificateur (Cmd+Opt+I, Cmd+R, etc.)
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // ignore si on est dans un input du modal
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  // En mode review, seules les flèches gauche/droite passent (déjà gérées ailleurs)
  if (review.active) return;

  // Démarrage : 1re Entrée lance la partie (lance chrono + 1er tirage)
  if (!state.started) {
    if (e.key === "Enter") {
      e.preventDefault();
      startGame();
    }
    return;
  }

  // ===== Tirage manuel en cours : la frappe compose le chevalet =====
  if (state._drawPhase) {
    if (e.key === "Enter") { e.preventDefault(); confirmManualDraw(); return; }
    if (e.key === "-" || e.key === "Subtract") { e.preventDefault(); rejectManualDraw(); return; }
    if (e.key === "Backspace") { e.preventDefault(); drawPopLast(); return; }
    if (e.key === "?") { e.preventDefault(); drawPickLetter("?"); return; }
    if (e.key.length === 1 && /[a-zA-ZàâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/.test(e.key)) {
      e.preventDefault();
      const L = e.key.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      drawPickLetter(L);
    }
    return;   // pendant le tirage, rien d'autre n'agit
  }

  // ===== Sélection manuelle du top en cours (mode duplicate) =====
  if (state._dupSols) {
    if (e.key === "Enter") { e.preventDefault(); dupConfirmSelection(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); dupMoveSelection(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); dupMoveSelection(-1); return; }
    return;   // pendant la sélection, rien d'autre n'agit
  }

  // ===== Mode ÉDITEUR : pose libre directe sur la grille =====
  if (state._editor) {
    if (e.key === "Enter") { e.preventDefault(); editorCommitSelected(); return; }
    if (e.key === "Escape") { e.preventDefault(); editorRestoreBoard(); return; }
    if (e.key === "Backspace") { e.preventDefault(); editorEraseAtCursor(); return; }
    if (e.key === " ") {
      e.preventDefault();
      if (state.cursor) { state.cursor.dir = state.cursor.dir === "H" ? "V" : "H"; renderBoard(); }
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault(); editorMoveCursor(e.key); return;
    }
    if (e.key === "?") { e.preventDefault(); editorPlaceJokerPrompt(!e.shiftKey); return; }
    if (e.key.length === 1 && /[a-zA-ZàâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/.test(e.key)) {
      e.preventDefault();
      const L = e.key.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      editorPlace(L, !e.shiftKey, false);   // Maj = jeton hors sac
      return;
    }
    return;
  }

  if (e.key === "Enter") { e.preventDefault(); validate(); return; }
  if (e.key === "Escape") {
    e.preventDefault();
    if (state.annotTool) { setAnnotTool(""); return; }   // Échap : sort du mode annotation
    cancelCurrent();
    return;
  }
  if (e.key === "Backspace") { e.preventDefault(); backspace(); return; }
  // F1 : Voir le top (−20 s)  [anciennement touche "1"]
  if (e.key === "F1") {
    e.preventDefault();
    if (state.started && state.chronoFinal == null) revealTop();
    return;
  }
  // F2 : raccourci Abandonner (mode entraînement uniquement)
  if (e.key === "F2") {
    e.preventDefault();
    if (!state.prepared && state.started && state.chronoFinal == null &&
        confirm("Abandonner la partie ? Les coups restants seront révélés automatiquement.")) {
      abandonRest();
    }
    return;
  }
  // Touche "1" : Mélanger le chevalet  [anciennement F1]
  if (e.key === "1" || e.code === "Digit1" || e.code === "Numpad1") {
    e.preventDefault(); shuffleRack(); return;
  }
  // Touche "2" : Trier le chevalet (alpha)  [anciennement F2]
  if (e.key === "2" || e.code === "Digit2" || e.code === "Numpad2") {
    e.preventDefault(); restoreRackSort(); return;
  }
  // Flèches : déplacer le curseur. Pendant un flash "mot faux", on l'annule
  // d'abord (les lettres reviennent au chevalet) pour que le curseur bouge tout
  // de suite avec les flèches, sans attendre la fin du flash.
  if (state.cursor && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) {
    if (state._invalidFlash) { clearInvalidFlash(); renderRack(); renderBoard(); }
    if (state.pending.length === 0) {
      e.preventDefault();
      moveCursorKey(e.key);
      return;
    }
  }
  // Barre espace : bascule le sens du mot (H ↔ V). Si des lettres sont déjà
  // posées, on REPOSE tout le mot dans l'autre sens en gardant la MÊME case de
  // départ (1ʳᵉ lettre inchangée).
  //   Ex. : ACE tapé en I8 (horizontal) → Espace → ACE en I8 vertical (vers le bas).
  if (state.cursor && e.key === " ") {
    if (state._invalidFlash) { clearInvalidFlash(); renderRack(); }
    e.preventDefault();
    const newDir = state.cursor.dir === "H" ? "V" : "H";
    if (state.pending.length > 0) relayPendingInDirection(newDir);
    else state.cursor.dir = newDir;
    renderBoard();
    return;
  }

  if (e.key === "?") {
    // Active le mode joker pour la prochaine lettre
    if (state.rack.find(t => t.letter === "?" && !t.used)) {
      state.jokerPending = true;
      flashFeedback("info", "Mode joker actif", "Tape la lettre à associer.");
    }
    return;
  }

  if (e.key.length === 1 && /[a-zA-ZàâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/.test(e.key)) {
    e.preventDefault();
    const L = e.key.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    placeLetter(L);
  }
}

function placeLetter(L, preferTileId = null) {
  // Si un flash "mot faux" est en cours, on l'annule d'abord (libère les cases)
  // pour pouvoir retaper immédiatement.
  if (clearInvalidFlash()) renderRack();
  if (!state.cursor) {
    flashFeedback("error", "Pas de curseur", "Clique d'abord sur une case du plateau.");
    return;
  }
  // Si la case courante est occupée, tenter d'avancer
  let { row, col } = state.cursor;
  if (isOccupied(row, col)) {
    const before = { row, col };
    advanceCursor();
    if (state.cursor.row === before.row && state.cursor.col === before.col) {
      flashFeedback("error", "Plus de place", "Bout du plateau atteint.");
      return;
    }
    row = state.cursor.row; col = state.cursor.col;
  }

  // Trouver tuile à utiliser : préférer celle pointée par preferTileId si valide,
  // sinon la lettre exacte, sinon joker.
  let rackTile;
  let isBlank = false;
  if (state.jokerPending) {
    rackTile = state.rack.find(t => t.letter === "?" && !t.used);
    if (!rackTile) {
      flashFeedback("error", "Pas de joker disponible", "");
      state.jokerPending = false;
      return;
    }
    isBlank = true;
    state.jokerPending = false;
  } else {
    if (preferTileId != null) {
      rackTile = state.rack.find(t => t.id === preferTileId && !t.used && t.letter === L);
    }
    if (!rackTile) rackTile = state.rack.find(t => t.letter === L && !t.used);
    if (!rackTile) {
      rackTile = state.rack.find(t => t.letter === "?" && !t.used);
      if (rackTile) isBlank = true;
    }
  }
  if (!rackTile) {
    flashFeedback("error", `Pas de "${L}" dans le chevalet`, "Et plus de joker disponible non plus.");
    return;
  }
  rackTile.used = true;
  // feedback conservé jusqu'à la prochaine validation
  state.pending.push({ row, col, letter: L, rackId: rackTile.id, isBlank });
  advanceCursor();
  renderBoard();
  renderRack();
}

function backspace() {
  // Flash "mot faux" en cours : on l'annule mais on GARDE les tuiles pour
  // pouvoir corriger la dernière lettre (on retire juste le rouge + le minuteur).
  if (state._invalidFlash) {
    state._invalidFlash = false;
    clearTimeout(state._flashTimer);
    state.pending.forEach(p => delete p.invalid);
    state.invalidCells = [];
  }
  if (!state.pending.length) return;
  const last = state.pending.pop();
  const tile = state.rack.find(t => t.id === last.rackId);
  if (tile) tile.used = false;
  // remettre le curseur sur la case retirée
  state.cursor.row = last.row;
  state.cursor.col = last.col;
  renderBoard();
  renderRack();
}

function cancelCurrent() {
  clearPending();
  state.cursor = null;
  renderBoard();
  renderRack();
  // Le feedback reste inchangé : on conserve l'état jusqu'à la prochaine validation.
}

// Gros panneau « changement de sens » clignotant ~0,5 s (mode Horizontal/Vertical).
function flashDirectionWarning() {
  let el = document.getElementById("dirFlash");
  if (!el) {
    el = document.createElement("div");
    el.id = "dirFlash";
    el.innerHTML = "↻ Changement de sens !";
    document.body.appendChild(el);
  }
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 600);
}

let flashTimer = null;
let topWordTimer = null;   // efface la surbrillance bleue du mot top après 3s
function flashFeedback(kind, title, detail) {
  showFeedback(kind, title, detail);
  clearTimeout(flashTimer);
  // Message TRANSITOIRE : après un court délai on restaure l'info persistante
  // (meilleur essai du coup, sinon repère du coup précédent) → un message du type
  // « Pas de I dans le chevalet » ne masque plus durablement le meilleur essai.
  flashTimer = setTimeout(() => restorePersistentFeedback(), 1600);
}

// ============================================================
//  Validation
// ============================================================
// Si le calcul du top a été différé (cf. nextMove), on le force maintenant :
// garantit que state.topMove est prêt avant toute comparaison.
function ensureTopReady() {
  // On ne lève le drapeau « à calculer » QUE si le calcul a effectivement abouti.
  // Si le dictionnaire n'est pas encore chargé (mobile lent, partie démarrée
  // pendant le chargement), computeTop() renvoie false et on reste en attente —
  // le prochain ensureTopReady (validation, timeout, fin de chargement du dico)
  // réessaiera, au lieu de figer topMove à null pour tout le coup.
  if (state._topPending && computeTop()) state._topPending = false;
}

// Aucun coup possible (dico chargé, top introuvable) → fin de partie immédiate
// (sans laisser le chrono défiler dans le vide, ex. Snake bloqué).
function endIfNoMove() {
  if (state.started && state.chronoFinal == null && state.dict && !review.active && !state.topMove) {
    endGame();
    return true;
  }
  return false;
}

// ===== Mode Top/sous-top : suivi des deux meilleurs mots DISTINCTS du joueur =====
// d.best = meilleur mot ; d.second = meilleur AUTRE mot de score strictement
// inférieur (le sous-top du joueur). Score du coup = best + second.
function dualSnapshot() {
  const d = state._dual || {};
  const tm = state.topMove, st = state.subTop;
  return {
    topPts: d.best?.score || 0, topWord: d.best?.word || null,
    subPts: d.second?.score || 0, subWord: d.second?.word || null,
    officialTop: tm?.score || 0, officialTopWord: tm?.move.word || null,
    officialSub: st?.score ?? null, officialSubWord: st?.move.word || null,
  };
}
function handleDualValidate(move, result) {
  const officialTop = state.topMove?.score || 0;
  const officialSub = state.subTop?.score ?? null;   // null si pas de sous-top
  const s = result.score, w = move.word;
  state.moveMaxPlaced = Math.max(state.moveMaxPlaced, result.placed?.length || 0);
  const d = state._dual = state._dual || { best: null, second: null };
  if (!d.best || s > d.best.score) {
    if (d.best && d.best.word !== w && (!d.second || d.best.score > d.second.score)) d.second = d.best;
    d.best = { word: w, score: s };
    if (d.second && (d.second.word === w || d.second.score >= d.best.score)) d.second = null;
  } else if (s < d.best.score && w !== d.best.word && (!d.second || s > d.second.score)) {
    d.second = { word: w, score: s };
  }
  const topFound = d.best && d.best.score === officialTop;
  const subFound = officialSub == null ? true : (d.second && d.second.score === officialSub);
  // Message : ce que le joueur vient de réaliser sur CE mot.
  let msg;
  if (s === officialTop) msg = `🏆 Top trouvé : <strong>${wLink(w)}</strong> — ${s} pts`;
  else if (officialSub != null && s === officialSub) msg = `✅ Sous-top trouvé : <strong>${wLink(w)}</strong> — ${s} pts`;
  else msg = `Essai : <strong>${wLink(w)}</strong> — ${s} pts`;
  const état = `Top ${topFound ? "✅" : "—"}${officialSub != null ? ` · Sous-top ${subFound ? "✅" : "—"}` : ""}`;
  // On ne pose jamais le coup du joueur : les tuiles reviennent au chevalet.
  clearPending(); state.cursor = null; renderBoard(); renderRack();
  if (topFound && subFound) {
    const playerScore = officialTop + (officialSub || 0);
    recordMove({ status: "top", playerScore, playedWord: w, playedMove: move, dual: dualSnapshot() });
    hideTopFeedback();
    placeTopAndAdvance(playerScore, w, playerScore, move);
    nextMove();
    return;
  }
  showFeedback("miss", msg, état);
}

// ============================================================
//  Mode DUPLICATE (entraînement)
// ============================================================
// Le joueur saisit des mots ; chaque mot LÉGAL validé devient son « dernier mot
// validé » (remplace le précédent). On ne révèle pas le top et on n'enchaîne pas :
// on attend la fin du chrono. À l'échéance, le top est sélectionné (auto ou par
// le joueur) et le négatif est calculé depuis le dernier mot validé.
function validateDuplicate(move, mode) {
  const opts = { bonuses: mode.bonuses, jokerPays: mode.jokerPays, layout: state.boardLayout };
  const result = bestJokerVariant(state.board, move, state.dict, opts);
  const wait = state.settings.timePerMove > 0 ? " · en attente de la fin du chrono" : "";
  if (result.errors.length) {
    if (state.settings.signalZeros) {
      // Signalement des zéros activé → on prévient (flash rouge), le joueur corrige.
      flashInvalidWord(result.errors.join("<br>"), result.invalidCells);
      return;
    }
    // Signalement DÉSACTIVÉ : le mot faux est retenu et présenté COMME S'IL ÉTAIT
    // BON (on affiche son score brut). Il vaudra en réalité 0, révélé en fin de
    // chrono. Les jetons restent posés, comme pour un mot valide.
    const raw = scoreMove(state.board, move, state.dict, { ...opts, raw: true });
    state._dupLast = { word: move.word, score: 0, move: null, invalid: true };
    state.moveMaxPlaced = Math.max(state.moveMaxPlaced, result.placed?.length || state.pending.length);
    renderBoard(); renderRack();
    showFeedback("info", `<strong>${wLink(move.word)}</strong> — ${raw.score} pts retenu${wait}`, "");
    return;
  }
  if (result.placed.length > mode.maxPlayed) {
    showTransientError(`Trop de lettres posées (max ${mode.maxPlayed})`,
      `Le mode ${mode.label} limite à ${mode.maxPlayed} lettres jouées par coup.`);
    return;
  }
  // Mot légal retenu (remplace le précédent). Les jetons restent visibles ; le
  // joueur peut annuler (Échap / ✕) pour proposer un autre mot.
  state._dupLast = { word: move.word, score: result.score, move, invalid: false };
  state.moveMaxPlaced = Math.max(state.moveMaxPlaced, result.placed.length);
  renderBoard(); renderRack();
  showFeedback("info", `<strong>${wLink(move.word)}</strong> — ${result.score} pts retenu${wait}`, "");
}

// Solutions au TOP (isotops), CLASSÉES par pertinence Topissimo (mêmes critères
// que findTopRanked). Le 1er élément est le choix qu'aurait fait le logiciel.
// Dédupliquées par mot + position.
function topSolutions() {
  const mode = currentMode();
  const rackLetters = state.rack.map(t => t.letter);
  const ranked = rankIsotops(state.board, rackLetters, state.dict, state.bag, {
    maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses,
    jokerPays: mode.jokerPays, layout: state.boardLayout,
    preserveJoker: effJoker() && state.spareJokers > 0,
  });
  const seen = new Set();
  const out = [];
  for (const c of ranked) {
    const key = `${c.move.word}@${c.move.row},${c.move.col},${c.move.dir}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Le coup choisi par le logiciel (1er du classement = celui de findTopRanked).
function isSameMove(a, b) {
  return a && b && a.word === b.word && a.row === b.row && a.col === b.col && a.dir === b.dir;
}

// Fin de chrono en mode duplicate : sélection du top (auto ou manuelle) puis
// passage au coup suivant.
function duplicateChronoEnd() {
  ensureTopReady();
  if (!state.topMove) {
    if (!state.dict) { startMoveTimer(); return; }   // dico pas prêt → on patiente
    endGame();
    return;
  }
  if (state.settings.autoTop) {
    finishDuplicateMove(state.topMove.move);
  } else {
    showTopSelection();
  }
}

// Pose le top choisi (chosenMove) et enchaîne. Le négatif est calculé depuis le
// dernier mot validé par le joueur.
function finishDuplicateMove(chosenMove) {
  if (chosenMove) state.topMove.move = chosenMove;
  const topScore = state.topMove.score;
  const last = state._dupLast || {};
  const playerScore = last.score || 0;
  const playedWord = last.word || null;
  const playedMove = last.move || null;
  const wasInvalid = !!last.invalid;
  clearPending();
  recordMove({ status: playerScore === topScore ? "top" : "timeout", playerScore, playedWord, playedMove });
  hideTopFeedback();
  // 3e argument = score AFFICHÉ pour le mot du joueur (pas le score du top).
  placeTopAndAdvance(playerScore, playedWord, playerScore, playedMove);
  state._dupLast = null;
  nextMove();
  // Révélation en fin de chrono : si le dernier mot validé était faux → 0 pt.
  // Fenêtre en ROUGE (kind "error") pour bien marquer le zéro.
  if (wasInvalid && playedWord) {
    showFeedback("error", `⚠️ Dernier mot validé « ${escapeHtmlS(playedWord)} » non valide → 0 pt`, "");
  }
}

// Sélection MANUELLE du top, à la manière de la review : panneau listant les
// solutions au top ; cliquer une ligne POSE le mot sur la grille (aperçu) ;
// Entrée valide la sélection et enchaîne sur le coup suivant.
function showTopSelection() {
  const sols = topSolutions();
  // Aucune ou UNE seule solution au top (pas d'isotop) → on pose directement,
  // sans ouvrir la fenêtre de sélection.
  if (sols.length <= 1) { finishDuplicateMove(sols[0]?.move || state.topMove.move); return; }
  clearPending();                                   // retirer la réponse du joueur de la grille
  renderRack();
  state._dupBaseBoard = state.board.map(r => r.slice());   // plateau AVANT pose du top
  state._dupSols = sols;
  state._dupSel = 0;
  const panel = document.getElementById("dupTopPicker");
  if (!panel) { finishDuplicateMove(sols[0].move); return; }   // sécurité
  const list = panel.querySelector(".dtp-list");
  // Le choix Topissimo (1er du classement = celui du logiciel) est marqué en vert.
  list.innerHTML = `<table><thead><tr><th>Mot</th><th>Place</th><th>Score</th></tr></thead><tbody>${
    sols.map((s, i) => {
      const isPick = i === 0 || isSameMove(s.move, state.topMove?.move);
      return `<tr data-i="${i}" class="${isPick ? "tps-pick" : ""}"><td>${wLink(s.move.word)}${isPick ? " ✓" : ""}</td><td>${posLabel(s.move)}</td><td>${s.score}</td></tr>`;
    }).join("")
  }</tbody></table>`;
  list.querySelectorAll("tr[data-i]").forEach(tr => {
    // Simple clic : aperçu / sélection. Double clic (ou Entrée) : valide.
    tr.onclick = () => dupPreviewSolution(+tr.dataset.i);
    tr.ondblclick = () => { dupPreviewSolution(+tr.dataset.i); dupConfirmSelection(); };
  });
  panel.hidden = false;
  dupPreviewSolution(0);
}

// Aperçu d'une solution sur la grille (à la place du top), + sélection de la ligne.
function dupPreviewSolution(i) {
  const sols = state._dupSols; if (!sols || !sols[i]) return;
  state._dupSel = i;
  state.board = applyMove(state._dupBaseBoard.map(r => r.slice()), sols[i].move);
  state.lastPlaced = computeLastPlacedCells(state._dupBaseBoard, sols[i].move);
  renderBoard();
  const panel = document.getElementById("dupTopPicker");
  if (panel) panel.querySelectorAll("tr[data-i]").forEach(tr =>
    tr.classList.toggle("selected", +tr.dataset.i === i));
}

// Déplacement clavier de la sélection (↑/↓).
function dupMoveSelection(delta) {
  if (!state._dupSols) return;
  const n = state._dupSols.length;
  dupPreviewSolution((state._dupSel + delta + n) % n);
  // Garder la ligne visible.
  const tr = document.querySelector(`#dupTopPicker tr[data-i="${state._dupSel}"]`);
  if (tr) tr.scrollIntoView({ block: "nearest" });
}

// Validation de la sélection (Entrée) : on pose le top choisi et on enchaîne.
function dupConfirmSelection() {
  if (!state._dupSols) return;
  const chosen = state._dupSols[state._dupSel].move;
  state.board = state._dupBaseBoard.map(r => r.slice());   // restaurer avant pose officielle
  state._dupSols = null; state._dupBaseBoard = null;
  const panel = document.getElementById("dupTopPicker");
  if (panel) panel.hidden = true;
  finishDuplicateMove(chosen);
}

function validate() {
  // Tirage manuel en cours : « ✓ » valide le tirage (et lance le chrono).
  if (state._drawPhase) { confirmManualDraw(); return; }
  ensureTopReady();
  if (!state.pending.length) {
    showTransientError("Rien à valider", "Place d'abord des lettres sur la grille.");
    return;
  }
  // Reconstituer le coup (mot principal dans la direction)
  const move = buildMoveFromPending();
  if (!move) {
    showTransientError("Pose invalide", "Les lettres doivent être alignées et contiguës.");
    return;
  }
  const mode = currentMode();
  // Mode Horizontal/Vertical : un mot validé dans le MAUVAIS sens compte 0
  // (gros panneau « changement de sens » clignotant pour alerter le joueur).
  if (mode.alternateDir) {
    const forcedDir = state.moveNo % 2 === 1 ? "H" : "V";
    if (move.dir !== forcedDir) {
      flashDirectionWarning();
      clearPending(); state.cursor = null; renderBoard(); renderRack();
      showFeedback("miss", "↻ Mauvais sens — ce coup compte 0",
        `Sens imposé ce coup : ${forcedDir === "H" ? "horizontal ↔" : "vertical ↕"}`);
      return;
    }
  }
  // ===== Mode DUPLICATE : on ne révèle PAS le top, on ne valide PAS le coup
  // immédiatement. On retient le dernier mot validé (son score réel à l'endroit
  // posé) ; le passage au coup suivant se fait à la fin du chrono. =====
  if (playMode() === "duplicate") { validateDuplicate(move, mode); return; }
  const topMv = state.topMove?.move;
  // ===== Premier coup : valorisation INDÉPENDANTE de la position =====
  // Au 1er coup, le plateau est vide : n'importe quel mot valide peut être placé
  // de plein de façons à travers le centre. On valorise donc le mot tapé à son
  // MEILLEUR placement possible (toute position/orientation), où qu'il ait été
  // saisi — pas besoin de toucher l'étoile.
  //   • si cet optimum atteint le score du top → c'est le top (ou un isotop) :
  //     on enchaîne ;
  //   • sinon → c'est un essai valorisé à son optimum (ex. HEURE = 24 pts en H4),
  //     enregistré comme « meilleur essai » sans pénalité de position.
  if (state.moveNo === 1 && topMv && state.topMove && !mode.dualTop) {
    const topScore = state.topMove.score;
    const rackLetters = state.rack.map(t => t.letter);
    const allMoves = findTop(state.board, rackLetters, state.dict, {
      all: true, maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses,
      jokerPays: mode.jokerPays, layout: state.boardLayout,
    }) || [];
    const sameWord = allMoves.filter(c => c.move.word === move.word);
    if (sameWord.length) {
      const best = sameWord.reduce((a, b) => (b.score > a.score ? b : a));
      if (best.score >= topScore) {
        // Mot du top ou isotop (même score que le top) → validé, on enchaîne.
        state.moveMaxPlaced = Math.max(state.moveMaxPlaced, state.pending.length);
        recordMove({ status: "top", playerScore: topScore, playedWord: move.word, playedMove: best.move });
        hideTopFeedback();
        placeTopAndAdvance(topScore, move.word, topScore, best.move);
        nextMove();
        return;
      }
      // Mot valide sous le top → valorisé à son optimum (meilleur essai), sans
      // exiger qu'il touche le centre ni qu'il soit posé à l'emplacement optimal.
      if (!state.bestAttempt || best.score > state.bestAttempt.score) {
        state.bestAttempt = { word: move.word, score: best.score, move: best.move };
      }
      state.moveMaxPlaced = Math.max(state.moveMaxPlaced, state.pending.length);
      const startR = move.row, startC = move.col;
      clearPending();
      state.cursor = { row: startR, col: startC, dir: move.dir };
      renderBoard();
      renderRack();
      const b = state.bestAttempt;
      const optPos = posLabel(best.move);
      const isNewBest = b.word === move.word && b.score === best.score;
      const line = isNewBest
        ? `<strong>${wLink(move.word)}</strong> — <strong>${best.score}</strong> pts (optimum en ${optPos}) — meilleur essai`
        : `<strong>${wLink(move.word)}</strong> — ${best.score} pts (optimum en ${optPos})<br>${bestAttemptHTML()}`;
      hideTopFeedback();
      showFeedback("miss", line, "");
      return;
    }
    // Mot introuvable comme 1er coup (hors dico ou tirage insuffisant) → on laisse
    // la validation normale ci-dessous signaler l'erreur (flash « mot invalide »).
  }
  // Règle FFSC : si le joker a un homonyme (même lettre) dans le mot, on permute
  // automatiquement vers la combinaison la plus avantageuse en points.
  const result = bestJokerVariant(state.board, move, state.dict, { bonuses: mode.bonuses, jokerPays: mode.jokerPays, layout: state.boardLayout });
  // bestJokerVariant peut avoir modifié move.blanks ; on relit ici.
  if (result.errors.length) {
    // Coup invalide : on flash le mot en rouge sur le plateau (1s), puis on
    // renvoie les tuiles au chevalet et on restaure le message précédent.
    flashInvalidWord(result.errors.join("<br>"), result.invalidCells);
    return;
  }
  // Vérification mode 7sur8 / 7et8 / 789 : nb de tuiles posées
  if (result.placed.length > mode.maxPlayed) {
    showTransientError(`Trop de lettres posées (max ${mode.maxPlayed})`, `Le mode ${mode.label} limite à ${mode.maxPlayed} lettres jouées par coup.`);
    return;
  }
  // Mode Snake : le coup doit prolonger le serpent (s'accrocher à une extrémité ;
  // les mots croisés latéraux sont permis), sinon « non accepté ».
  if (mode.snake && !snakeMoveLegal(state.board, state.snakeEnds, move)) {
    flashInvalidWord("Ce coup ne continue pas le serpent 🐍 — non accepté", result.placed || []);
    return;
  }
  // Mode Top/sous-top : on cherche le top ET le sous-top (gestion dédiée).
  if (mode.dualTop) { handleDualValidate(move, result); return; }
  // Comparer au top
  const topScore = state.topMove?.score || 0;
  const topWord = state.topMove?.move.word || "?";
  const diff = result.score - topScore;
  // Exception 1er coup : accepter le top même si la position n'est pas optimale
  const isFirstMoveTopWord = state.moveNo === 1 && move.word === topWord;
  // Exception joker : même mot + même position que le top mais joker à un autre
  // emplacement (lettre dupliquée) → on accepte comme top.
  const isSameAsTopButJokerElsewhere = topMv &&
    move.word === topMv.word &&
    move.row === topMv.row &&
    move.col === topMv.col &&
    move.dir === topMv.dir;
  state.moveMaxPlaced = Math.max(state.moveMaxPlaced, result.placed?.length || 0);
  if (result.score === topScore || isFirstMoveTopWord || isSameAsTopButJokerElsewhere) {
    // TOP trouvé
    recordMove({ status: "top", playerScore: topScore, playedWord: move.word, playedMove: move });
    hideTopFeedback();  // efface le top du coup précédent dès validation
    placeTopAndAdvance(topScore, move.word, topScore, move);
    nextMove();
  } else {
    // Miss : on garde la trace du meilleur essai
    if (!state.bestAttempt || result.score > state.bestAttempt.score) {
      state.bestAttempt = { word: move.word, score: result.score, move };
    }
    const startR = move.row, startC = move.col;
    clearPending();
    state.cursor = { row: startR, col: startC, dir: move.dir };
    // Avancer le curseur au-delà des cases occupées (committées)
    let guard = 0;
    while (isOccupied(state.cursor.row, state.cursor.col) && guard++ < BOARD_SIZE) {
      const before = { row: state.cursor.row, col: state.cursor.col };
      advanceCursor();
      if (state.cursor.row === before.row && state.cursor.col === before.col) {
        // bout du plateau atteint
        state.cursor = null;
        break;
      }
    }
    renderBoard();
    renderRack();
    const best = state.bestAttempt;
    const curPos = ` en ${posLabel(move)}`;
    const isNewBest = best.word === move.word && best.score === result.score;
    const bestLine = isNewBest
      ? `<strong>${wLink(move.word)}</strong> — <strong>${result.score}</strong> pts${curPos} — meilleur essai`
      : `<strong>${wLink(move.word)}</strong> — ${result.score} pts${curPos}<br>${bestAttemptHTML()}`;
    hideTopFeedback();  // efface le top du coup précédent dès validation
    showFeedback("miss", bestLine, "");
  }
}

// Règle FFSC : pour chaque joker du coup, si la lettre qu'il représente apparaît
// aussi en tant que vraie tuile dans le mot (parmi les tuiles posées), on essaie
// les permutations joker ↔ vraie tuile et on retient le placement qui maximise
// le score. Mute move.blanks vers la meilleure variante.
function bestJokerVariant(board, move, dict, opts) {
  const blanks = move.blanks || [];
  let best = scoreMove(board, move, dict, opts);
  if (!blanks.length || best.errors.length) return best;
  const dr = move.dir === "V" ? 1 : 0;
  const dc = move.dir === "H" ? 1 : 0;
  // Positions des tuiles nouvellement posées (par index dans le mot)
  const placedIdx = [];
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (!board[r][c]) placedIdx.push(i);
  }
  let bestBlanks = blanks.slice();
  for (const b of blanks) {
    const letter = move.word[b];
    for (const i of placedIdx) {
      if (i === b) continue;
      if (move.word[i] !== letter) continue;
      if (bestBlanks.includes(i)) continue;
      const trial = bestBlanks.filter(x => x !== b).concat([i]).sort((a, b) => a - b);
      const trialMove = { ...move, blanks: trial };
      const r = scoreMove(board, trialMove, dict, opts);
      if (r.errors.length === 0 && r.score > best.score) {
        best = r;
        bestBlanks = trial;
      }
    }
  }
  move.blanks = bestBlanks;
  return best;
}

// Coup invalide : fait clignoter les tuiles posées en rouge pendant 1s puis les
// renvoie au chevalet. Affiche le meilleur essai en cours s'il existe,
// sinon conserve le feedback précédent tel quel.
function flashInvalidWord(detail, invalidCells) {
  state.moveInvalidCount++;  // compteur de mots hors dico
  // Point de départ de la saisie + direction → on y replace le curseur pour que
  // le joueur puisse reprendre immédiatement (ex. AXAO raté en B2 → curseur B2).
  const ps = [...state.pending];
  let startCell = null, dir = state.cursor?.dir || "H";
  if (ps.length) {
    const sameRow = ps.every(p => p.row === ps[0].row);
    dir = sameRow ? "H" : "V";
    startCell = ps.slice().sort((a, b) => dir === "H" ? a.col - b.col : a.row - b.row)[0];
  }
  // Mémoriser le feedback courant (barre verte du top / consigne) pour le restaurer.
  const fb = $("#feedback");
  const prevHTML = fb.innerHTML, prevClass = fb.className, prevHidden = fb.hidden;
  // Mémoriser ce qu'il faudra restaurer si le flash arrive à son terme sans action.
  state._invalidFlashRestore = { html: prevHTML, cls: prevClass, hidden: prevHidden };

  // 1) SURBRILLANCE ROUGE du/des mot(s) fautif(s) — uniquement si les effets de
  //    grille sont activés (même préférence que la mise en évidence du top).
  const gridEffects = state.settings.highlightTop !== false;
  state.invalidCells = (gridEffects && invalidCells && invalidCells.length) ? invalidCells : [];
  if (gridEffects && !state.invalidCells.length) state.pending.forEach(p => p.invalid = true);
  clearTimeout(state._errorTimeout);
  clearTimeout(state._flashTimer);
  state._invalidFlash = true;

  // 2) Curseur TOUJOURS ACTIF : on le repositionne au départ du mot tout de
  //    suite ; il reste visible et déplaçable PENDANT toute la durée du flash
  //    (et après). Les tuiles rouges restent visibles tant que le joueur n'agit
  //    pas ; la moindre action (clic, frappe, retour, swipe) annule le flash
  //    immédiatement (cf. clearInvalidFlash) et s'exécute sans latence.
  //    Fallback : si le départ n'a pas pu être déterminé, on garde le curseur
  //    courant (jamais de désactivation).
  if (startCell) state.cursor = { row: startCell.row, col: startCell.col, dir };
  else if (!state.cursor && ps.length) state.cursor = { row: ps[0].row, col: ps[0].col, dir };
  renderBoard();
  showFeedback("error", "Coup invalide", detail);

  // 3) Filet : si le joueur ne fait rien, on nettoie après un court délai.
  //    Le curseur n'est PAS effacé par ce nettoyage → il reste actif ensuite.
  state._flashTimer = setTimeout(() => {
    if (!clearInvalidFlash()) return;
    renderRack();
    renderBoard();
    restorePersistentFeedback();   // meilleur essai (avec position) ou repère
  }, 350);
}

// Annule le flash "mot faux" en cours : retire les tuiles rouges et libère les
// cases, SANS rendu (l'appelant rend). Retourne true si un flash était actif.
// Appelé par toute interaction de saisie → le curseur reste actif pendant le flash.
function clearInvalidFlash() {
  if (!state._invalidFlash) return false;
  state._invalidFlash = false;
  clearTimeout(state._flashTimer);
  state.pending.forEach(p => delete p.invalid);
  state.invalidCells = [];
  clearPending();
  return true;
}

function buildMoveFromPending() {
  const ps = [...state.pending];
  // déterminer la direction d'après l'alignement
  const allSameRow = ps.every(p => p.row === ps[0].row);
  const allSameCol = ps.every(p => p.col === ps[0].col);
  if (!allSameRow && !allSameCol) return null;
  // Cas particulier : une seule tuile posée → la direction H/V est ambiguë
  // tant qu'on ne regarde pas les lettres voisines. Si on a un voisin
  // vertical (au-dessus ou en-dessous) mais pas horizontal, on doit jouer
  // verticalement. Idem inverse.
  let dir;
  if (ps.length === 1) {
    const p = ps[0];
    const has = (r, c) => r >= 0 && c >= 0 && r < BOARD_SIZE && c < BOARD_SIZE && !!state.board[r][c];
    const vNeighbor = has(p.row - 1, p.col) || has(p.row + 1, p.col);
    const hNeighbor = has(p.row, p.col - 1) || has(p.row, p.col + 1);
    if (vNeighbor && !hNeighbor) dir = "V";
    else if (hNeighbor && !vNeighbor) dir = "H";
    else dir = state.cursor?.dir || "H";   // ambigu ou seule sur le plateau : on prend la direction du curseur
  } else {
    dir = allSameRow ? "H" : "V";
  }
  // tri par axe progressif
  ps.sort((a,b) => dir === "H" ? a.col - b.col : a.row - b.row);
  // étendre le mot en prenant les lettres committed avant le 1er pending et entre les pending
  const dr = dir === "V" ? 1 : 0;
  const dc = dir === "H" ? 1 : 0;
  let startR = ps[0].row, startC = ps[0].col;
  // remonter tant que case précédente est committed
  while (true) {
    const pr = startR - dr, pc = startC - dc;
    if (pr < 0 || pc < 0) break;
    if (!state.board[pr][pc]) break;
    startR = pr; startC = pc;
  }
  // construire le mot complet en avançant
  let r = startR, c = startC;
  let word = "";
  const blanks = [];
  const pendingMap = new Map(ps.map(p => [`${p.row},${p.col}`, p]));
  let idx = 0;
  while (r < BOARD_SIZE && c < BOARD_SIZE) {
    const committed = state.board[r][c];
    const pending = pendingMap.get(`${r},${c}`);
    if (committed) {
      word += committed.letter;
      if (committed.isBlank) blanks.push(idx);
    } else if (pending) {
      word += pending.letter;
      if (pending.isBlank) blanks.push(idx);
    } else {
      break; // trou → fin du mot principal
    }
    r += dr; c += dc;
    idx++;
  }
  // vérifier qu'il n'y a pas de trou : tous les pending sont dans le mot construit
  for (const p of ps) {
    if (!word.includes("")) { /* dummy */ }
  }
  // s'il y a un trou (pending qui n'est pas dans la chaîne), invalide
  const builtPositions = new Set();
  let rr = startR, cc = startC;
  for (let i = 0; i < word.length; i++) {
    builtPositions.add(`${rr},${cc}`);
    rr += dr; cc += dc;
  }
  for (const p of ps) {
    if (!builtPositions.has(`${p.row},${p.col}`)) return null;
  }
  return { word, row: startR, col: startC, dir, blanks };
}

// Place le TOP sur le plateau, retire ses lettres du chevalet,
// met à jour score/négatif selon le score du joueur (0 si rien tenté).
// Gère le mode joker (remplacement par la lettre du sac si possible).
function placeTopAndAdvance(playerScore, playedWord = null, playedScore = null, playedMove = null) {
  ensureTopReady();
  const tm = state.topMove;
  if (!tm) return;
  const { word, row, col, dir, blanks } = tm.move;
  const dr = dir === "V" ? 1 : 0;
  const dc = dir === "H" ? 1 : 0;
  // Identifier les lettres NOUVELLEMENT posées par le top
  const newLetters = [];
  const lastPlaced = [];
  let jokerUsedAsLetter = null;
  let jokerCellIdx = -1;
  let jokerWordIdx = -1;
  for (let i = 0; i < word.length; i++) {
    const r = row + i * dr, c = col + i * dc;
    if (!state.board[r][c]) {
      const isBlank = blanks.includes(i);
      newLetters.push({ letter: word[i], isBlank });
      lastPlaced.push({ row: r, col: c });
      if (isBlank && jokerUsedAsLetter === null) {
        jokerUsedAsLetter = word[i];
        jokerCellIdx = lastPlaced.length - 1;
        jokerWordIdx = i;
      }
    }
  }
  state.lastPlaced = lastPlaced;
  // Toutes les cases du mot top, pour dessiner le contour bleu nuit.
  state.lastTopCells = Array.from({ length: word.length }, (_, i) => ({
    row: row + i * dr, col: col + i * dc,
  }));
  // Le contour du top PERSISTE jusqu'à ce que le joueur clique sur la grille
  // (cf. clearTopHighlight()). Plus d'effacement automatique au bout de 1,5 s.
  if (topWordTimer) { clearTimeout(topWordTimer); topWordTimer = null; }

  // Snake : mettre à jour les extrémités du serpent avant d'appliquer le top.
  if (currentMode().snake) state.snakeEnds = snakeEndpointsAfter(state.snakeEnds, state.board, tm.move);
  // Appliquer le top au plateau
  state.board = applyMove(state.board, tm.move);

  // Mode joker (règle FFSC 3.8.1) : si le top utilise le joker, tenter le
  // remplacement par la lettre adéquate si elle est encore dans le sac.
  // UNIQUEMENT en entraînement (où state.bag est suivi). En pré-tiré (tournoi/puzzle),
  // state.bag n'est PAS décrémenté → on ferait de faux remplacements ; les `blanks`
  // stockés encodent déjà la décision réelle prise à la génération.
  // Remplacement réussi → joker recyclé, state.spareJokers inchangé.
  // Remplacement impossible → joker posé définitivement, state.spareJokers--.
  if (!state.prepared && !state.isPuzzle &&
      effJoker() && jokerUsedAsLetter !== null && state.spareJokers > 0) {
    if (state.bag[jokerUsedAsLetter] > 0) {
      state.bag[jokerUsedAsLetter]--;
      const cell = lastPlaced[jokerCellIdx];
      state.board[cell.row][cell.col] = { letter: jokerUsedAsLetter, isBlank: false };
      // Amender l'historique : retirer cet index de blanks pour que la review
      // affiche bien une lettre normale (et pas un joker rouge).
      const last = state.history[state.history.length - 1];
      if (last?.top?.blanks) {
        last.top.blanks = last.top.blanks.filter(b => b !== jokerWordIdx);
      }
      // joker recyclé → state.spareJokers inchangé
    } else {
      state.spareJokers--;  // joker posé définitivement, lettre épuisée du sac
    }
  }
  // En mode pré-tiré/puzzle, le chevalet est réinitialisé depuis les données
  // stockées au début de chaque coup (nextMove) — pas besoin de le modifier ici.
  // En entraînement, retirer les lettres posées par le top du chevalet.
  if (!state.prepared && !state.isPuzzle) {
    for (const nl of newLetters) {
      let idx = -1;
      if (nl.isBlank) {
        idx = state.rack.findIndex(t => t.letter === "?");
      } else {
        idx = state.rack.findIndex(t => t.letter === nl.letter);
        if (idx === -1) idx = state.rack.findIndex(t => t.letter === "?");
      }
      if (idx !== -1) state.rack.splice(idx, 1);
    }
  }
  // Mémoriser le top pour l'afficher en zone C au début du coup suivant
  state.lastTop = { word: tm.move.word, row: tm.move.row, col: tm.move.col, dir: tm.move.dir, score: tm.score, playedWord, playedScore, playedMove };

  // Score. En Top/sous-top, la référence (le « maximum ») est top + sous-top.
  const refScore = (currentMode().dualTop && state.subTop) ? (tm.score + state.subTop.score) : tm.score;
  state.totalScore += playerScore;
  state.sumNeg += (playerScore - refScore);
  // Nettoyage. On NE supprime PAS le curseur : il reste visible pour permettre
  // une navigation 100% clavier sans avoir à recliquer après chaque validation.
  // S'il atterrit sur une case maintenant occupée, on l'avance après nextMove.
  state.pending = [];
  state.bestAttempt = null;
  state._dual = null;   // réinitialise le suivi top/sous-top pour le coup suivant
  state.moveInvalidCount = 0;
  state.moveMaxPlaced = 0;
  state.moveNo++;
  if (state.prepared) state.preparedIdx++;
  renderInfo();
  // Redessiner la grille immédiatement : indispensable pour le DERNIER coup, où
  // nextMove() enchaîne directement sur endGame() (modale) sans passer par le
  // renderBoard() habituel — sinon le dernier coup ne s'affiche jamais.
  renderBoard();
}

function revealTop() {
  if (!state.started) {
    flashFeedback("error", "Partie non démarrée", "Appuie sur ✓ ou « Démarrer » pour lancer la partie.");
    return;
  }
  // En duplicate, « Voir le top » termine le coup (sélection du top puis suivant),
  // sans pénalité de temps — utile notamment si le chrono est illimité.
  if (playMode() === "duplicate") { stopMoveTimer(); duplicateChronoEnd(); return; }
  ensureTopReady();
  if (!state.topMove) return;
  state.chronoPenalty += 20;
  // Évaluer le pending courant
  let pendingScore = 0;
  let pendingWord = null;
  if (state.pending.length) {
    const move = buildMoveFromPending();
    if (move) {
      const r = scoreMove(state.board, move, state.dict, { bonuses: currentMode().bonuses, jokerPays: currentMode().jokerPays, layout: state.boardLayout });
      if (!r.errors.length) { pendingScore = r.score; pendingWord = move.word; }
    }
  }
  // On retient le meilleur entre le pending et le bestAttempt accumulé
  let playerScore = pendingScore;
  let playedWord = pendingWord;
  if (state.bestAttempt && state.bestAttempt.score > playerScore) {
    playerScore = state.bestAttempt.score;
    playedWord = state.bestAttempt.word;
  }
  const tm = state.topMove;
  // Construire le playedMove pour avoir les coordonnées dans la barre jaune
  // Priorité : pending courant, sinon move stocké dans bestAttempt
  let playedMoveObj = state.pending.length ? buildMoveFromPending() : null;
  if (!playedMoveObj && state.bestAttempt?.move) playedMoveObj = state.bestAttempt.move;
  recordMove({ status: "giveup", playerScore, playedWord, playedMove: playedMoveObj });
  placeTopAndAdvance(playerScore, playedWord || null, playerScore || null, playedMoveObj);
  renderBoard();   // afficher immédiatement la surbrillance du mot top
  // Pas de showFeedback ici : showLastTopFeedback (appelé par nextMove) affichera
  // les deux barres verte + jaune avec toutes les infos.
  setTimeout(nextMove, 1000);
}

// Enregistre un coup dans l'historique (pour la feuille de route)
function recordMove({ status, playerScore, playedWord = null, playedMove = null, dual = null }) {
  const tm = state.topMove;
  const timeMs = stopMoveTimer();
  // Mode Top/sous-top : référence = top + sous-top ; on stocke le détail (pour la review).
  const st = state.subTop;
  const refScore = (currentMode().dualTop && st) ? (tm?.score || 0) + st.score : (tm?.score || 0);
  state.history.push({
    moveNo: state.moveNo,
    rack: state.rack.map(t => t.letter).join(""),
    freshRack: !!state.currentRackFresh,
    kept: state.currentRackFresh ? "" : (state.currentKept || ""),
    top: tm ? {
      word: tm.move.word,
      score: tm.score,
      pos: posLabel(tm.move),
      row: tm.move.row, col: tm.move.col, dir: tm.move.dir,
      blanks: tm.move.blanks || [],
      words: tm.words || [],
      hadBonus: !!(currentMode().bonuses?.[tm.placedCount]),
    } : null,
    played: playedWord,
    playedPos: playedMove ? posLabel(playedMove) : null,
    // Meilleur nombre de jetons posés dans un mot VALIDE ce coup (même non-top,
    // même si finalement abandonné). Sert à savoir si le joueur a posé un
    // scrabble. v:2 marque ce nouveau format fiable (cf. "scrabbles ratés").
    placedCount: Math.max(state.moveMaxPlaced, playedMove ? state.pending.length : 0),
    gotBonus: playedMove ? !!(currentMode().bonuses?.[state.pending.length]) : false,
    playerScore,
    neg: playerScore - refScore,
    status,        // "top" | "giveup" | "timeout"
    invalidCount: state.moveInvalidCount,
    timeMs,
    // Top/sous-top : sous-top officiel + ce que le joueur a trouvé (pour la review).
    ...(currentMode().dualTop ? {
      subTop: st ? { word: st.move.word, score: st.score, pos: posLabel(st.move),
        row: st.move.row, col: st.move.col, dir: st.move.dir, blanks: st.move.blanks || [], words: st.words || [] } : null,
      dual: dual || null,
    } : {}),
    v: 2,
  });
}

function posLabel(move) {
  // Notation FFSC : horizontal = "H8" (lettre puis nombre), vertical = "8H"
  const letter = ROW_LETTERS[move.row];
  const num = move.col + 1;
  return move.dir === "H" ? `${letter}${num}` : `${num}${letter}`;
}

// Affiche le top du coup qui vient de finir en zone C (fond vert).
// Affiche le top du coup précédent en barre verte (#feedbackTop).
// La barre jaune joueur (#feedback) est effacée (nouveau coup, pas encore d'essai).
function showLastTopFeedback() {
  if (!state.lastTop) { hideFeedback(); hideTopFeedback(); return; }
  const { word, score, playedWord, playedScore, playedMove } = state.lastTop;
  showTopFeedback(word, score, posLabel(state.lastTop));  // barre verte : top de la position
  // Barre jaune : mot joué par le joueur (si disponible)
  if (playedWord) {
    const pos  = playedMove ? ` en ${posLabel(playedMove)}` : "";
    const pts  = playedScore != null ? ` — <strong>${playedScore}</strong> pts` : "";
    showFeedback("miss", `Mot validé : <strong>${wLink(playedWord)}</strong>${pts}${pos}`, "");
  } else {
    const div = $("#feedback");
    div.hidden = true; div.innerHTML = ""; div.className = "feedback";
  }
}

// ============================================================
//  Boucle de jeu : tirage + calcul top
// ============================================================
function nextMove() {
  // Nouveau tirage → on lève l'override manuel d'ordre : si le réglage
  // « Trier le chevalet (A→Z) » est actif, le nouveau chevalet se range à
  // nouveau automatiquement (sinon un seul déplacement manuel désactivait le
  // tri alpha pour tout le reste de la partie).
  state._tempUnsorted = false;
  // ===== Mode partie pré-tirée : lecture de partition =====
  // INVARIANT : en mode pré-tiré, l'état de la partie est 100 % déterminé
  // par les données stockées. À chaque coup :
  //   • state.rack   ← next.rack   (stocké à la génération)
  //   • state.topMove← next.top    (stocké à la génération)
  //   • state.board  ← accumulé uniquement via applyMove(tops) dans placeTopAndAdvance
  // Le coup du joueur n'affecte que son score — jamais le plateau ni le chevalet.
  if (state.prepared) {
    if (state.preparedIdx >= state.prepared.moves.length) {
      endGame();
      return;
    }
    const next = state.prepared.moves[state.preparedIdx];
    // Garde-fou : vérifier que le chevalet stocké est cohérent avec le mode.
    const rackStr = next.rack || "";
    const mode = currentMode();
    const expectedSize = mode.rackSize || 7;
    const hasJoker = rackStr.includes("?");
    if (!rackStr) {
      console.error("[nextMove] rack manquant au coup", state.preparedIdx, next);
    } else if (rackStr.length < expectedSize - 1) {
      // Tolérance -1 pour fin de partie (sac presque vide)
      console.warn("[nextMove] rack trop court:", rackStr, "attendu ≥", expectedSize - 1, "mode", state.prepared.mode);
    } else if (state.prepared.with_joker && !hasJoker) {
      console.warn("[nextMove] joker absent du chevalet en mode joker:", rackStr, "coup", state.preparedIdx + 1);
    }
    state.rack = rackStr.split("").map(L => ({ letter: L, used: false, id: nextTileId() }));
    state.currentRackFresh = !!next.freshRack;
    state.currentKept = next.freshRack ? "" : (next.kept || "");
    // DIAGNOSTIC : tracer le tirage RÉELLEMENT affiché vs la donnée stockée.
    // En tournoi, ces deux valeurs DOIVENT être identiques en permanence.
    diagLog("prepared_move", {
      idx: state.preparedIdx,
      moveNo: next.moveNo ?? null,
      storedRack: rackStr,
      topWord: next.top?.word ?? null,
      blanks: next.top?.blanks || [],
      freshRack: !!next.freshRack,
    });
    renderRack();
    // Garde-fou post-rendu : ce qui s'affiche (state.rack) doit correspondre
    // exactement au tirage stocké (next.rack). Une divergence ici est anormale
    // (elle ne devrait jamais arriver) → on loggue ET on réaligne sur le stocké.
    const displayed = state.rack.map(t => t.letter).join("");
    if (displayed !== rackStr) {
      diagLog("RACK_DIVERGENCE", { idx: state.preparedIdx, displayed, stored: rackStr });
      console.error(`[nextMove] divergence rack affiché "${displayed}" ≠ stocké "${rackStr}" — correction.`);
      state.rack = rackStr.split("").map(L => ({ letter: L, used: false, id: nextTileId() }));
      renderRack();
    }
    renderBoard();
    renderBag();           // sac affiché aussi en partie pré-tirée/tournoi
    // Si le dictionnaire n'est pas encore chargé, computeTop() échoue et topMove
    // resterait null → le mot joué ne serait pas reconnu comme top. On garde le
    // drapeau « à recalculer » ; ensureTopReady (validation / fin de chargement du
    // dico) réessaiera dès que possible.
    if (!computeTop()) {
      state._topPending = true;
      setTimeout(() => { if (state._topPending && computeTop()) { state._topPending = false; showLastTopFeedback(); } }, 0);
    }
    startMoveTimer();
    showLastTopFeedback();
    ensureCursorOnFreeCell();
    return;
  }

  // ===== GARDE-FOU CRITIQUE =====
  // À ce point, state.prepared est forcément null (le bloc tournoi ci-dessus
  // se termine par `return`). Si jamais on arrive ici avec state.prepared
  // défini, c'est un bug GRAVE (code périmé, branche fusionnée) : le tirage
  // aléatoire ne doit JAMAIS s'exécuter en mode tournoi. On loggue et on stoppe
  // au lieu de polluer la partie avec un tirage inventé.
  if (state.prepared) {
    diagLog("ILLEGAL_DRAW_IN_PREPARED", {
      preparedIdx: state.preparedIdx,
      moveNo: state.moveNo,
      build: BUILD_VERSION,
    });
    console.error("[CRITIQUE] tirage aléatoire tenté en mode tournoi — partie stoppée");
    endGame();
    return;
  }

  // ===== Mode entraînement (aléatoire) =====
  // Double joker infini : 5 lettres réelles (reliquat conservé, pioche libre) + 2
  // jokers à chaque tirage ; fin quand plus aucune lettre réelle (sac + chevalet).
  if (currentMode().infJoker) {
    state.rack = state.rack.filter(t => t.letter !== "?");
    // Fin quand on a posé la dernière voyelle OU consonne réelle (jokers infinis exclus).
    let djV = bagTotalVowels(state.bag), djC = bagTotalConsonants(state.bag);
    for (const t of state.rack) { if (VOWELS.has(t.letter)) djV++; else djC++; }
    if (djV === 0 || djC === 0) { endGame(); return; }
    const rackReal = state.rack.length;
    const needReal = Math.max(0, 5 - rackReal);
    const pool = [];
    for (const [l, n] of Object.entries(state.bag)) { if (l === "?") continue; for (let k = 0; k < n; k++) pool.push(l); }
    state.currentRackFresh = false;
    state.currentKept = state.rack.map(t => t.letter).join("");
    for (let k = 0; k < needReal && pool.length; k++) {
      const i = Math.floor(Math.random() * pool.length);
      const L = pool.splice(i, 1)[0];
      state.bag[L] = (state.bag[L] || 0) - 1;
      state.rack.push({ letter: L, used: false, id: nextTileId() });
    }
    state.rack.push({ letter: "?", used: false, id: nextTileId() }, { letter: "?", used: false, id: nextTileId() });
    for (const t of state.rack) t.used = false;
    renderRack(); renderBoard(); renderBag();
    startMoveTimer(); showLastTopFeedback(); ensureCursorOnFreeCell();
    state._topPending = true;
    setTimeout(() => { if (state._topPending && computeTop()) { state._topPending = false; endIfNoMove(); } }, 0);
    return;
  }

  // La partie ne s'arrête que quand IL N'Y A PLUS DE voyelles OU PLUS DE
  // consonnes dans l'UNION du sac ET du chevalet conservé du joueur.
  // → la partie continue même si le tirage est < 7 lettres, tant qu'on
  //   peut faire AU MOINS un mot.
  const remainingRackLetters = state.rack.filter(t => !t.used).map(t => t.letter);
  let vAvail = bagTotalVowels(state.bag);
  let cAvail = bagTotalConsonants(state.bag);
  for (const L of remainingRackLetters) {
    if (L === "?") continue;
    if (VOWELS.has(L)) vAvail++; else cAvail++;
  }
  if (vAvail === 0 || cAvail === 0) {
    // Fin : dernière voyelle OU dernière consonne posée → fin, SAUF s'il reste un
    // joker (comble n'importe quel type) ou un Y (peut servir de consonne quand
    // c'est la dernière consonne qui manque). On continue tant qu'il n'est pas posé.
    const jokersInPool = (state.bag["?"] || 0)
      + remainingRackLetters.filter(l => l === "?").length;
    const ysInPool = (state.bag["Y"] || 0)
      + remainingRackLetters.filter(l => l === "Y").length;
    if (jokersInPool === 0 && ysInPool === 0) { endGame(); return; }
  }

  // ===== Tirage MANUEL (duplicate sans tirage auto) =====
  // Le joueur compose lui-même le chevalet en cliquant dans le sac ; on n'enchaîne
  // (chrono + calcul du top) qu'à la validation du tirage.
  if (manualDrawActive()) { beginManualDraw(); return; }

  // Compléter le chevalet selon le mode de partie
  const mode = currentMode();
  const targetSize = mode.rackSize;
  // Mode joker : si jokers actifs disponibles, on impose 1 joker dans le tirage
  const jokerInRack = state.rack.some(t => t.letter === "?");
  const forceJoker = effJoker() && state.spareJokers > 0 && !jokerInRack;
  const regularTarget = forceJoker ? targetSize - 1 : targetSize;
  const kept = state.rack.map(t => t.letter);
  const result = drawForDuplicate(state.bag, kept, state.moveNo, regularTarget, { minVowels: mode.minVowels });
  if (result.failed) {
    endGame();
    return;
  }
  state.bag = result.bag;
  // Rejet : le reliquat (hors jokers) est remis dans le sac → on ne garde que
  // les jokers conservés, le reste est un tirage complet neuf.
  if (result.fresh) state.rack = state.rack.filter(t => t.letter === "?");
  state.currentRackFresh = !!result.fresh;
  state.currentKept = result.fresh ? "" : kept.join("");
  for (const L of (result.drawn || [])) {
    state.rack.push({ letter: L, used: false, id: nextTileId() });
  }
  if (forceJoker) {
    state.rack.push({ letter: "?", used: false, id: nextTileId() });
  }
  for (const t of state.rack) t.used = false;
  // Log de la règle appliquée si elle a été relâchée
  if (result.minApplied !== undefined && result.minApplied < (state.moveNo >= 15 ? 1 : 2)) {
  }
  state._dupLast = null;   // duplicate : remise à zéro du « dernier mot validé » du coup
  renderRack();
  renderBoard();
  renderBag();           // afficher le sac dès le nouveau tirage (entraînement)
  startMoveTimer();
  showLastTopFeedback();
  ensureCursorOnFreeCell();
  // Calcul du top DIFFÉRÉ : en entraînement findTopRanked est coûteux et bloquait
  // le rendu → on laisse le navigateur peindre le nouveau coup AVANT de chercher
  // (supprime la latence ressentie quand on enchaîne après avoir trouvé le top).
  // validate() force le calcul si le joueur valide avant que ce minuteur ne tourne.
  state._topPending = true;
  setTimeout(() => { if (state._topPending && computeTop()) state._topPending = false; }, 0);
}

// Garde le curseur sur le plateau et sur une case libre après l'avancement
// d'un coup, pour permettre une navigation 100 % clavier.
function ensureCursorOnFreeCell() {
  if (!state.cursor) {
    state.cursor = { row: CENTER, col: CENTER, dir: "H" };
    renderBoard();
    return;
  }
  if (!isOccupied(state.cursor.row, state.cursor.col)) return;
  // Tenter d'avancer dans la direction du curseur
  let guard = 0;
  while (isOccupied(state.cursor.row, state.cursor.col) && guard++ < BOARD_SIZE * 2) {
    const before = { row: state.cursor.row, col: state.cursor.col };
    advanceCursor();
    if (state.cursor.row === before.row && state.cursor.col === before.col) {
      // bord atteint : on remet le curseur au centre par défaut
      state.cursor = { row: CENTER, col: CENTER, dir: state.cursor.dir };
      break;
    }
  }
  renderBoard();
}

let nextTileIdCounter = 1;
function nextTileId() { return nextTileIdCounter++; }

// Renvoie true si le top a pu être calculé (dictionnaire prêt), false sinon.
function computeTop() {
  if (!state.dict) return false;   // dico pas encore chargé → réessai ultérieur
  // Mode pré-tiré : utiliser le top stocké, pas de calcul
  if (state.prepared) {
    const m = state.prepared.moves[state.preparedIdx];
    if (!m) { state.topMove = null; state.subTop = null; return true; }
    state.topMove = {
      score: m.top.score,
      move: { word: m.top.word, row: m.top.row, col: m.top.col, dir: m.top.dir, blanks: m.top.blanks || [] },
      words: m.top.words || [],
    };
    // Mode Snake : extrémités du serpent AVANT ce coup (stockées à la génération).
    if (currentMode().snake) state.snakeEnds = m._ends || null;
    // Mode Top/sous-top : on expose aussi le sous-top stocké.
    state.subTop = m.subTop
      ? { score: m.subTop.score, words: m.subTop.words || [],
          move: { word: m.subTop.word, row: m.subTop.row, col: m.subTop.col, dir: m.subTop.dir, blanks: m.subTop.blanks || [] } }
      : null;
    return true;
  }
  const mode = currentMode();
  const rackLetters = state.rack.map(t => t.letter);
  // Formules spéciales en entraînement live : direction imposée (H/V) et joker payant.
  const forceDir = mode.alternateDir ? (state.moveNo % 2 === 1 ? "H" : "V") : undefined;
  const jokerPays = !!mode.jokerPays;
  const layout = state.boardLayout;
  if (mode.snake) {
    // Snake : le top est le meilleur coup qui prolonge le serpent (depuis ses extrémités).
    state.topMove = snakeBestTop(state.board, rackLetters, state.dict, state.snakeEnds, {
      maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses, layout,
    });
    return true;
  }
  state.topMove = findTopRanked(state.board, rackLetters, state.dict, state.bag, {
    maxTilesUsed: mode.maxPlayed,
    bonuses: mode.bonuses,
    preserveJoker: effJoker() && state.spareJokers > 0,
    jokerPays, forceDir, layout,
  });
  // H/V : si aucun coup dans la direction imposée (rare), on retombe sans contrainte
  // pour ne pas figer l'entraînement.
  if (!state.topMove && forceDir) {
    state.topMove = findTopRanked(state.board, rackLetters, state.dict, state.bag, {
      maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses,
      preserveJoker: effJoker() && state.spareJokers > 0, jokerPays, layout,
    });
  }
  // Top/sous-top live : calculer le sous-top.
  if (mode.dualTop && state.topMove) {
    const all = findTop(state.board, rackLetters, state.dict, {
      all: true, maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses, jokerPays, forceDir, layout,
    }) || [];
    const lower = all.filter(c => c.score < state.topMove.score);
    state.subTop = lower.length
      ? { score: lower[0].score, words: [...new Set(lower.filter(c => c.score === lower[0].score).map(c => c.move.word))],
          move: { ...lower[0].move } }
      : null;
  } else if (!state.prepared) {
    state.subTop = null;
  }
  return true;
}
// Joker effectif : mode joker classique OU joker payant (qui est aussi une partie joker).
function effJoker() { return state.settings.withJoker || !!currentMode().jokerPays; }

// Axe « mode de jeu ». N'a de sens qu'en ENTRAÎNEMENT : en tournoi/puzzle/review,
// on reste en logique topping historique.
function playMode() {
  if (state.prepared || state.isPuzzle || review.active) return "topping";
  const pm = state.settings.playMode || "topping";
  // Éditeur en sourdine pour le moment (à retravailler) → on le ramène à topping,
  // même si un ancien réglage « editor » traîne en mémoire.
  if (pm === "editor") return "topping";
  return pm;
}

// Libellé du bouton « Voir le top » : en duplicate, pas de pénalité de temps
// (le dernier mot validé est retenu, puis on passe au coup suivant) → on retire
// la mention « (−20s) ».
function updateGiveUpLabel() {
  const btn = document.getElementById("btnGiveUp");
  if (!btn) return;
  const dup = playMode() === "duplicate";
  const lbl = btn.querySelector(".lbl");
  if (lbl) lbl.textContent = dup ? "Voir le top" : "Voir le top (−20s)";
  btn.setAttribute("data-tip", dup ? "Voir le top" : "Voir le top (−20 s)");
}

// Tirage manuel actif : duplicate avec « tirage automatique » décoché, OU éditeur.
function manualDrawActive() {
  const pm = playMode();
  return (pm === "duplicate" && state.settings.autoDraw === false) || pm === "editor";
}

// ===== Tirage manuel : le joueur compose le chevalet via une MODALE =====
// (Le sac inline est masqué sur mobile : on utilise une modale dédiée, qui
//  fonctionne aussi bien sur téléphone que sur ordinateur.)
function beginManualDraw() {
  state._drawPhase = true;
  state.currentRackFresh = false;
  state.currentKept = state.rack.map(t => t.letter).join("");
  for (const t of state.rack) t.used = false;
  renderRack(); renderBoard(); renderBag();
  openDrawModal();
}

function ensureDrawModal() {
  let m = document.getElementById("drawModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "drawModal";
    m.className = "modal";
    m.innerHTML = `<div class="backdrop"></div><div class="content draw-modal">
      <button class="close" id="drawClose" title="Fermer">×</button>
      <h2>Compose ton tirage</h2>
      <p class="muted" style="margin:0 0 8px;font-size:.85rem">Clique les lettres du sac (ou tape-les au clavier). « – » remet tout au sac · Backspace retire la dernière. <kbd>Entrée</kbd> ou « Valider » lance le chrono.</p>
      <div class="draw-sel" id="drawSel"></div>
      <div class="draw-bag" id="drawBag"></div>
      <div class="draw-actions">
        <button class="btn ghost" id="drawAuto">🎲 Automatique</button>
        <button class="btn ghost" id="drawReset">– Tout remettre</button>
        <button class="btn primary" id="drawValidate">Valider ▶</button>
      </div></div>`;
    document.body.appendChild(m);
    m.querySelector("#drawAuto").onclick = () => drawAuto();
    m.querySelector("#drawReset").onclick = () => rejectManualDraw();
    m.querySelector("#drawValidate").onclick = () => confirmManualDraw();
    m.querySelector("#drawClose").onclick = () => closeDrawModal();
  }
  return m;
}

function openDrawModal() {
  const m = ensureDrawModal();
  m.hidden = false;
  const re = document.getElementById("drawReopen"); if (re) re.hidden = true;
  renderDrawModal();
}

// Ferme la modale sans valider. Le tirage reste en cours : un bouton flottant
// « 🎲 Composer le tirage » permet de la rouvrir (utile pour regarder le plateau).
function closeDrawModal() {
  const m = document.getElementById("drawModal"); if (m) m.hidden = true;
  if (!state._drawPhase) return;
  let re = document.getElementById("drawReopen");
  if (!re) {
    re = document.createElement("button");
    re.id = "drawReopen";
    re.className = "btn primary draw-reopen";
    re.textContent = "🎲 Composer le tirage";
    re.onclick = () => openDrawModal();
    // Placé juste sous le sac de lettres (dans la colonne de droite).
    const bag = document.getElementById("bagDisplay");
    if (bag && bag.parentNode) bag.insertAdjacentElement("afterend", re);
    else document.body.appendChild(re);
  }
  re.hidden = false;
}

function renderDrawModal() {
  const m = document.getElementById("drawModal");
  if (!m || m.hidden) return;
  const max = currentMode().rackSize || 7;
  const sel = m.querySelector("#drawSel");
  sel.innerHTML = `<div class="draw-sel-tiles">${
    state.rack.length
      ? state.rack.map(t => `<span class="tile draw-tile">${t.letter === "?" ? "" : t.letter}</span>`).join("")
      : `<span class="muted">Aucune lettre choisie</span>`
  }</div><div class="muted" style="font-size:.78rem;margin-top:4px">${state.rack.length}/${max} lettre(s)</div>`;
  const counts = { ...state.bag };
  if (effJoker() && state.spareJokers > 0) counts["?"] = (counts["?"] || 0) + state.spareJokers;
  const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const consonnes = allLetters.filter(l => !VOYELLES_SET.includes(l));
  const ordered = [...VOYELLES_SET, ...consonnes, "?"];
  const bag = m.querySelector("#drawBag");
  bag.innerHTML = ordered.map(l => {
    const n = counts[l] || 0; if (n <= 0) return "";
    const cls = ["bag-chip", "pickable"]; if (l === "?") cls.push("joker");
    return `<span class="${cls.join(" ")}" data-pick="${l}">${l}<span class="ct">${n}</span></span>`;
  }).join("");
  bag.querySelectorAll("[data-pick]").forEach(ch => ch.onclick = () => drawPickLetter(ch.dataset.pick));
}

// Pioche une lettre du sac vers le chevalet pendant le tirage manuel.
function drawPickLetter(L) {
  if (!state._drawPhase) return;
  const max = currentMode().rackSize || 7;
  if (state.rack.length >= max) { flashFeedback("error", "Chevalet plein", `Maximum ${max} lettres.`); return; }
  if (L === "?") {
    if ((state.spareJokers || 0) <= 0) { flashFeedback("error", "Plus de joker disponible", ""); return; }
    state.spareJokers--;
    state.rack.push({ letter: "?", used: false, id: nextTileId() });
  } else {
    if ((state.bag[L] || 0) <= 0) { flashFeedback("error", `Plus de « ${L} » dans le sac`, ""); return; }
    state.bag[L]--;
    state.rack.push({ letter: L, used: false, id: nextTileId() });
  }
  renderRack(); renderBag(); renderDrawModal();
}

// Retire le DERNIER jeton pioché (Backspace) → le remet au sac.
function drawPopLast() {
  if (!state._drawPhase || !state.rack.length) return;
  const t = state.rack.pop();
  if (t.letter === "?") state.spareJokers = (state.spareJokers || 0) + 1;
  else state.bag[t.letter] = (state.bag[t.letter] || 0) + 1;
  renderRack(); renderBag(); renderDrawModal();
}

// Génère un tirage ALÉATOIRE équilibré (remplit le chevalet depuis le sac).
function drawAuto() {
  if (!state._drawPhase) return;
  rejectManualDraw();   // remet d'abord le chevalet courant au sac
  const mode = currentMode();
  const target = mode.rackSize || 7;
  const forceJoker = effJoker() && (state.spareJokers || 0) > 0;
  const regularTarget = forceJoker ? target - 1 : target;
  const result = drawForDuplicate(state.bag, [], state.moveNo, regularTarget, { minVowels: mode.minVowels });
  if (result.failed) { flashFeedback("error", "Tirage impossible", "Le sac ne permet plus un tirage complet."); return; }
  state.bag = result.bag;
  for (const L of (result.drawn || [])) state.rack.push({ letter: L, used: false, id: nextTileId() });
  if (forceJoker) { state.spareJokers--; state.rack.push({ letter: "?", used: false, id: nextTileId() }); }
  renderRack(); renderBag(); renderDrawModal();
}

// Rejette le tirage (touche « – ») : tout le chevalet retourne au sac.
function rejectManualDraw() {
  if (!state._drawPhase) return;
  for (const t of state.rack) {
    if (t.letter === "?") state.spareJokers = (state.spareJokers || 0) + 1;
    else state.bag[t.letter] = (state.bag[t.letter] || 0) + 1;
  }
  state.rack = [];
  renderRack(); renderBag(); renderDrawModal();
}

// Valide le tirage manuel → ferme la modale, démarre le coup (chrono + top).
function confirmManualDraw() {
  if (!state._drawPhase) return;
  if (!state.rack.length) { flashFeedback("error", "Tirage vide", "Choisis au moins une lettre."); return; }
  state._drawPhase = false;
  { const m = document.getElementById("drawModal"); if (m) m.hidden = true; }
  { const re = document.getElementById("drawReopen"); if (re) re.hidden = true; }
  state.currentKept = "";   // tirage entièrement composé à la main
  for (const t of state.rack) t.used = false;
  renderRack(); renderBoard(); renderBag();
  state._dupLast = null;
  // ===== Mode ÉDITEUR : pas de chrono ni de boucle de jeu — on entre en mode
  // construction (pose libre + solutions live + supertop). =====
  if (playMode() === "editor") { enterEditorMode(); return; }
  startMoveTimer();
  ensureCursorOnFreeCell();
  state._topPending = true;
  setTimeout(() => { if (state._topPending && computeTop()) state._topPending = false; }, 0);
  hideFeedback();
}

// ============================================================
//  Mode ÉDITEUR : construction libre d'une partie
// ============================================================
function editorActive() { return state._editor === true; }

function enterEditorMode() {
  const fresh = !state._editor;
  state._editor = true;
  if (fresh) { state._coups = []; state.totalScore = 0; }
  hideFeedback();
  ensureCursorOnFreeCell();
  showEditorToolbar();
  editorRefreshSolutions();
  renderInfo();
}

// Retire du chevalet les lettres NOUVELLEMENT posées par `move` (cases vides sur
// `base`). Les jokers (blanks) retirent un « ? ».
function removeMoveLettersFromRack(move, base) {
  const dr = move.dir === "V" ? 1 : 0, dc = move.dir === "H" ? 1 : 0;
  for (let i = 0; i < move.word.length; i++) {
    const r = move.row + i * dr, c = move.col + i * dc;
    if (base[r] && base[r][c]) continue;                 // déjà sur le plateau
    const isBlank = (move.blanks || []).includes(i);
    let idx = isBlank ? state.rack.findIndex(t => t.letter === "?")
                      : state.rack.findIndex(t => t.letter === move.word[i]);
    if (idx === -1 && !isBlank) idx = state.rack.findIndex(t => t.letter === "?");
    if (idx !== -1) state.rack.splice(idx, 1);
  }
}

// Pose le coup choisi : enregistre l'état AVANT (pour le retour arrière), applique
// le mot, retire les lettres du chevalet, met à jour CUMUL/COUP, puis enchaîne sur
// la composition du tirage suivant (sauf si silent, pour « Générer »).
function editorCommitCoup(move, score, silent) {
  if (!editorActive() || !move) return;
  editorRestoreBoard();
  const base = state.board.map(r => r.slice());
  state._coups.push({
    board: base, bag: { ...state.bag }, rack: state.rack.map(t => t.letter),
    spareJokers: state.spareJokers || 0, move, score: score || 0,
  });
  state.totalScore = (state.totalScore || 0) + (score || 0);
  state.board = applyMove(state.board, move);
  removeMoveLettersFromRack(move, base);
  state.cursor = null;
  state._editorSel = null;
  renderBoard(); renderRack(); renderBag(); renderInfo();
  if (!silent) startNextEditorDraw();
}

// Pose le coup actuellement prévisualisé (sélection dans la liste).
function editorCommitSelected() {
  if (!state._editorSols || state._editorSel == null) {
    flashFeedback("info", "Aucun coup sélectionné", "Clique d'abord un mot dans la liste.");
    return;
  }
  const s = state._editorSols[state._editorSel];
  if (s) editorCommitCoup(s.move, s.score, false);
}

// Compose le tirage du coup suivant (reliquat conservé).
function startNextEditorDraw() {
  state._drawPhase = true;
  for (const t of state.rack) t.used = false;
  openDrawModal();
}

// Retour au coup précédent : restaure l'état complet d'avant le dernier coup.
function editorUndoCoup() {
  if (!editorActive()) return;
  if (state._drawPhase) { state._drawPhase = false; const m = document.getElementById("drawModal"); if (m) m.hidden = true; const re = document.getElementById("drawReopen"); if (re) re.hidden = true; }
  if (!state._coups.length) { flashFeedback("info", "Début de partie", "Aucun coup à annuler."); return; }
  const c = state._coups.pop();
  state.board = c.board.map(r => r.slice());
  state.bag = { ...c.bag };
  state.spareJokers = c.spareJokers;
  state.rack = c.rack.map(L => ({ letter: L, used: false, id: nextTileId() }));
  state.totalScore = state._coups.reduce((a, x) => a + (x.score || 0), 0);
  state.cursor = null; state._editorSel = null;
  renderBoard(); renderRack(); renderBag(); renderInfo();
  editorRefreshSolutions();
}

// Complète le chevalet par un tirage automatique équilibré. false si fin de partie.
function editorAutoFill() {
  const mode = currentMode();
  const remain = state.rack.filter(t => !t.used).map(t => t.letter);
  let v = bagTotalVowels(state.bag), c = bagTotalConsonants(state.bag);
  for (const L of remain) { if (L === "?") continue; if (VOWELS.has(L)) v++; else c++; }
  if (v === 0 || c === 0) {
    const jok = (state.bag["?"] || 0) + remain.filter(l => l === "?").length;
    const ys = (state.bag["Y"] || 0) + remain.filter(l => l === "Y").length;
    if (jok === 0 && ys === 0) return false;
  }
  const target = mode.rackSize;
  const jokerInRack = state.rack.some(t => t.letter === "?");
  const forceJoker = effJoker() && state.spareJokers > 0 && !jokerInRack;
  const regularTarget = forceJoker ? target - 1 : target;
  const kept = state.rack.map(t => t.letter);
  const result = drawForDuplicate(state.bag, kept, state._coups.length + 1, regularTarget, { minVowels: mode.minVowels });
  if (result.failed) return false;
  state.bag = result.bag;
  if (result.fresh) state.rack = state.rack.filter(t => t.letter === "?");
  for (const L of (result.drawn || [])) state.rack.push({ letter: L, used: false, id: nextTileId() });
  if (forceJoker) { state.spareJokers--; state.rack.push({ letter: "?", used: false, id: nextTileId() }); }
  for (const t of state.rack) t.used = false;
  return true;
}

// Génère automatiquement la suite de la partie jusqu'à la fin (tops du moteur).
function editorGenerateRest() {
  if (!editorActive()) return;
  if (state._drawPhase) { state._drawPhase = false; const m = document.getElementById("drawModal"); if (m) m.hidden = true; const re = document.getElementById("drawReopen"); if (re) re.hidden = true; }
  editorRestoreBoard();
  const mode = currentMode();
  let guard = 0;
  while (guard++ < 300) {
    if (!editorAutoFill()) break;
    const rackLetters = state.rack.map(t => t.letter);
    const top = findTopRanked(state.board, rackLetters, state.dict, state.bag, {
      maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses,
      preserveJoker: effJoker() && state.spareJokers > 0, layout: state.boardLayout,
    });
    if (!top || !top.move) break;
    editorCommitCoup(top.move, top.score, true);   // silencieux
  }
  renderBoard(); renderRack(); renderBag(); renderInfo();
  editorRefreshSolutions();
  flashFeedback("info", "Partie générée", `${state._coups.length} coup(s) — cumul ${state.totalScore}.`);
}

// Pose libre d'un jeton sur la grille (commit direct, pas un coup).
//   fromBag = true  → jeton tiré du sac (décrémente le sac) ;
//   fromBag = false → jeton SUPPLÉMENTAIRE (hors sac) ;
//   isBlank = true  → joker (la lettre n'est qu'un affichage).
function editorPlace(letter, fromBag, isBlank) {
  if (!editorActive() || !state.cursor) return;
  let { row, col } = state.cursor;
  // Avancer jusqu'à une case libre dans le sens du curseur.
  while (row < BOARD_SIZE && col < BOARD_SIZE && state.board[row][col]) {
    row += state.cursor.dir === "V" ? 1 : 0;
    col += state.cursor.dir === "H" ? 1 : 0;
  }
  if (row >= BOARD_SIZE || col >= BOARD_SIZE) { flashFeedback("error", "Bord du plateau atteint", ""); return; }
  if (fromBag) {
    if (isBlank) {
      if ((state.spareJokers || 0) <= 0 && (state.bag["?"] || 0) <= 0) { flashFeedback("error", "Plus de joker dans le sac", ""); return; }
      if (state.spareJokers > 0) state.spareJokers--; else state.bag["?"]--;
    } else {
      if ((state.bag[letter] || 0) <= 0) { flashFeedback("error", `Plus de « ${letter} » dans le sac`, ""); return; }
      state.bag[letter]--;
    }
  }
  state.board[row][col] = { letter, isBlank: !!isBlank };
  state.cursor = { row, col, dir: state.cursor.dir };
  advanceCursor();
  renderBoard(); renderBag();
  editorRefreshSolutions();
}

// Retire le jeton sous le curseur (ou la case précédente) et le rend au sac si
// c'était un jeton du sac (heuristique : on rend toujours au sac, sauf joker → spareJokers).
function editorEraseAtCursor() {
  if (!editorActive() || !state.cursor) return;
  let { row, col } = state.cursor;
  if (!state.board[row][col]) {
    // reculer d'une case
    row -= state.cursor.dir === "V" ? 1 : 0;
    col -= state.cursor.dir === "H" ? 1 : 0;
    if (row < 0 || col < 0 || !state.board[row][col]) return;
  }
  const cell = state.board[row][col];
  if (cell.isBlank) state.spareJokers = (state.spareJokers || 0) + 1;
  else state.bag[cell.letter] = (state.bag[cell.letter] || 0) + 1;
  state.board[row][col] = null;
  state.cursor = { row, col, dir: state.cursor.dir };
  renderBoard(); renderBag();
  editorRefreshSolutions();
}

// Recalcule et affiche les solutions (top en vert, isotops + sous-tops en orange).
function editorRefreshSolutions() {
  if (!editorActive()) return;
  const mode = currentMode();
  const rackLetters = state.rack.map(t => t.letter);
  const opts = { maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses, jokerPays: mode.jokerPays, layout: state.boardLayout };
  const all = (findTop(state.board, rackLetters, state.dict, { all: true, ...opts }) || []);
  const topScore = all.length ? all[0].score : 0;
  // Groupe au TOP (isotops) classé par pertinence Topissimo : vert (1er) puis orange.
  const ranked = rankIsotops(state.board, rackLetters, state.dict, state.bag, {
    ...opts, preserveJoker: effJoker() && state.spareJokers > 0,
  });
  const dedup = (arr, out, seen) => {
    for (const c of arr) {
      const k = `${c.move.word}@${c.move.row},${c.move.col},${c.move.dir}`;
      if (seen.has(k)) continue; seen.add(k); out.push(c);
    }
  };
  const seen = new Set();
  const sols = [];
  dedup(ranked, sols, seen);                                   // top + isotops, classés
  dedup(all.filter(c => c.score < topScore), sols, seen);      // reste (noir), score décroissant
  state._editorSols = sols.slice(0, 200);
  state._editorSel = null;
  state._editorBase = state.board.map(r => r.slice());
  renderEditorSolutions(sols[0]?.move || null);                // le 1er classé = choix Topissimo (vert)
}

function renderEditorSolutions(pick) {
  renderSolutionList(state._editorSols || [], pick,
    `Solutions — top <span style="color:#2c9a45">vert</span>, isotops <span style="color:#c47a16">orange</span>, reste en noir`);
}

// Affiche une liste de solutions dans le panneau sous le sac. Vert = `pick`
// (ou meilleur score si pick null), orange = même score que le meilleur, noir = reste.
function renderSolutionList(sols, pick, headHtml, emptyMsg) {
  const panel = document.getElementById("dupTopPicker");
  if (!panel) return;
  const head = panel.querySelector(".dtp-head");
  if (head) head.innerHTML = headHtml;
  const list = panel.querySelector(".dtp-list");
  const topScore = sols.length ? sols[0].score : 0;
  const pickMove = pick || sols[0]?.move || null;
  list.innerHTML = sols.length
    ? `<table><thead><tr><th>Mot</th><th>Place</th><th>Score</th></tr></thead><tbody>${
      sols.map((s, i) => {
        const isPick = isSameMove(s.move, pickMove);
        const cls = isPick ? "tps-pick" : (s.score === topScore ? "tps-other" : "");
        return `<tr data-i="${i}" class="${cls}"><td>${wLink(s.move.word)}</td><td>${posLabel(s.move)}</td><td>${s.score}</td></tr>`;
      }).join("")
    }</tbody></table>`
    : `<div style="padding:14px;text-align:center;color:#888">${emptyMsg || "Aucun coup possible avec ce tirage / ce plateau."}</div>`;
  list.querySelectorAll("tr[data-i]").forEach(tr => {
    tr.onclick = () => editorPreview(+tr.dataset.i);
    // Double-clic = poser ce coup (ou ce supertop) directement.
    tr.ondblclick = () => {
      const i = +tr.dataset.i; const s = state._editorSols?.[i];
      if (s) editorCommitCoup(s.move, s.score, false);
    };
  });
  panel.hidden = false;
}

// Aperçu d'une solution sur la grille (restaurée au clic suivant / Échap).
function editorPreview(i) {
  const s = state._editorSols?.[i]; if (!s) return;
  state._editorSel = i;
  state.board = applyMove(state._editorBase.map(r => r.slice()), s.move);
  state.lastPlaced = computeLastPlacedCells(state._editorBase, s.move);
  renderBoard();
  const panel = document.getElementById("dupTopPicker");
  if (panel) panel.querySelectorAll("tr[data-i]").forEach(tr => tr.classList.toggle("selected", +tr.dataset.i === i));
}

// Restaure le plateau édité (annule l'aperçu).
function editorRestoreBoard() {
  if (!editorActive() || !state._editorBase) return;
  state.board = state._editorBase.map(r => r.slice());
  state.lastPlaced = [];
  renderBoard();
}

// Déplacement du curseur d'UNE case (sans enjamber les cases occupées : en
// éditeur on veut pouvoir cibler n'importe quelle case, occupée ou non).
function editorMoveCursor(key) {
  if (!state.cursor) { state.cursor = { row: CENTER, col: CENTER, dir: "H" }; renderBoard(); return; }
  const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[key];
  if (!d) return;
  const r = Math.max(0, Math.min(BOARD_SIZE - 1, state.cursor.row + d[0]));
  const c = Math.max(0, Math.min(BOARD_SIZE - 1, state.cursor.col + d[1]));
  state.cursor = { row: r, col: c, dir: state.cursor.dir };
  renderBoard();
}

// Joker en éditeur : demander la lettre représentée puis poser.
function editorPlaceJokerPrompt(fromBag) {
  const raw = (prompt("Joker — lettre représentée :") || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!/^[A-Z]$/.test(raw)) return;
  editorPlace(raw, fromBag, true);
}

function showEditorToolbar() {
  let bar = document.getElementById("editorToolbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "editorToolbar";
    bar.className = "editor-toolbar";
    bar.innerHTML = `
      <div class="et-legend">✏️ Éditeur — <b>lettre</b> = sac · <b>Maj+lettre</b> = hors sac · <b>?</b> = joker · <b>Maj+?</b> = joker sup. · <b>Backspace</b> = effacer</div>
      <div class="et-btns">
        <button class="btn ghost small" id="etPlace">✏️ Placement libre</button>
        <button class="btn ghost small" id="etSupertop">🔎 Supertop</button>
        <button class="btn ghost small" id="etCommit">✅ Poser le coup</button>
        <button class="btn ghost small" id="etGenerate">⚙️ Générer la suite</button>
        <button class="btn ghost small" id="etUndo">◀ Coup précédent</button>
      </div>`;
    const bag = document.getElementById("bagDisplay");
    if (bag && bag.parentNode) bag.insertAdjacentElement("beforebegin", bar);
    else document.body.appendChild(bar);
    bar.querySelector("#etSupertop").onclick = () => startSupertopSelection();
    bar.querySelector("#etCommit").onclick = () => editorCommitSelected();
    bar.querySelector("#etGenerate").onclick = () => editorGenerateRest();
    bar.querySelector("#etUndo").onclick = () => editorUndoCoup();
    // « Placement libre » : annule une sélection/aperçu de supertop et revient à
    // l'édition (curseur + solutions live du tirage courant).
    bar.querySelector("#etPlace").onclick = () => {
      if (state._stCleanup) { state._stCleanup(); state._stCleanup = null; }
      editorRestoreBoard();
      ensureCursorOnFreeCell();
      editorRefreshSolutions();
      hideFeedback();
    };
  }
  bar.hidden = false;
}
function hideEditorToolbar() { const b = document.getElementById("editorToolbar"); if (b) b.hidden = true; }

// ===== Supertop : sélection d'une zone à la souris → 100 meilleurs mots =====
function startSupertopSelection() {
  const board = $("#board");
  if (!board) return;
  // Annuler une sélection de supertop précédente (re-clic = nouvelle zone).
  if (state._stCleanup) { state._stCleanup(); state._stCleanup = null; }
  editorRestoreBoard();
  flashFeedback("info", "Supertop — sélectionne une zone",
    "Glisse la souris sur la grille. Maj = sans le sac · Ctrl = sans le reliquat · Ctrl+Maj = ni l'un ni l'autre.");
  let startCell = null, mods = {};
  const cellOf = (ev) => {
    const t = ev.target.closest && ev.target.closest("td[data-r]");
    return t ? { r: +t.dataset.r, c: +t.dataset.c } : null;
  };
  const clearHL = () => board.querySelectorAll("td.zone-sel").forEach(td => td.classList.remove("zone-sel"));
  const hl = (a, b) => {
    clearHL();
    const r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const td = board.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
      if (td) td.classList.add("zone-sel");
    }
  };
  const onMove = (ev) => { const cell = cellOf(ev); if (cell && startCell) hl(startCell, cell); };
  const onDown = (ev) => {
    const cell = cellOf(ev); if (!cell) return;
    ev.preventDefault();
    startCell = cell;
    mods = { ignoreBag: !!ev.shiftKey, ignoreRack: !!(ev.ctrlKey || ev.metaKey) };
    hl(cell, cell);
    board.addEventListener("pointermove", onMove);
  };
  const onUp = (ev) => {
    board.removeEventListener("pointerdown", onDown);
    board.removeEventListener("pointermove", onMove);
    board.removeEventListener("pointerup", onUp);
    state._stCleanup = null;
    state._supertopSel = false;
    const cell = cellOf(ev) || startCell;
    clearHL();
    if (startCell && cell) {
      const zone = {
        r0: Math.min(startCell.r, cell.r), r1: Math.max(startCell.r, cell.r),
        c0: Math.min(startCell.c, cell.c), c1: Math.max(startCell.c, cell.c),
      };
      computeSupertop(zone, mods);
    }
  };
  state._supertopSel = true;
  board.addEventListener("pointerdown", onDown);
  board.addEventListener("pointerup", onUp);
  // Permet d'annuler proprement cette sélection si on reclique sur Supertop.
  state._stCleanup = () => {
    board.removeEventListener("pointerdown", onDown);
    board.removeEventListener("pointermove", onMove);
    board.removeEventListener("pointerup", onUp);
    clearHL();
    state._supertopSel = false;
  };
}

// Calcule jusqu'à 100 meilleurs mots tenant DANS la zone, puis remplit le panneau.
function computeSupertop(zone, mods) {
  const mode = currentMode();
  const base = state.board.map(r => r.slice());
  state._editorBase = base;
  const zoneLen = Math.max(zone.r1 - zone.r0, zone.c1 - zone.c0) + 1;
  // Longueur de mot bornée par la zone (la recherche est confinée à la zone).
  const maxTiles = Math.min(15, Math.max(2, zoneLen));
  // Pool de lettres. La recherche étant désormais CONFINÉE à la zone (opts.zone),
  // on peut garder le joker. On plafonne juste le nombre d'exemplaires par lettre
  // (inutile d'en avoir plus que la zone ne peut en accueillir) et les jokers à 2.
  const counts = {};
  const add = (L, n) => { if (!n) return; const cap = L === "?" ? 2 : maxTiles; counts[L] = Math.min(cap, (counts[L] || 0) + n); };
  if (!mods.ignoreRack) for (const t of state.rack) add(t.letter, 1);
  const bagSrc = mods.ignoreBag ? LETTER_BAG : state.bag;
  for (const [L, n] of Object.entries(bagSrc)) add(L, n || 0);
  if (!mods.ignoreBag) add("?", state.spareJokers || 0);
  const pool = [];
  for (const [L, n] of Object.entries(counts)) for (let k = 0; k < n; k++) pool.push(L);
  renderSolutionList([], null, "Supertop — ⏳ calcul…", "Calcul en cours…");
  setTimeout(() => {
    const all = findTop(base, pool, state.dict, {
      all: true, maxTilesUsed: maxTiles, bonuses: mode.bonuses,
      jokerPays: mode.jokerPays, layout: state.boardLayout, zone,
    }) || [];
    const within = (r, c) => r >= zone.r0 && r <= zone.r1 && c >= zone.c0 && c <= zone.c1;
    const inZone = all.filter(s => {
      const dr = s.move.dir === "V" ? 1 : 0, dc = s.move.dir === "H" ? 1 : 0;
      let anyNew = false;
      for (let i = 0; i < s.move.word.length; i++) {
        const r = s.move.row + i * dr, c = s.move.col + i * dc;
        if (!within(r, c)) return false;          // tout le mot doit tenir dans la zone
        if (!base[r][c]) anyNew = true;            // au moins une lettre nouvelle
      }
      return anyNew;
    });
    const seen = new Set(); const out = [];
    for (const s of inZone) {
      const k = `${s.move.word}@${s.move.row},${s.move.col},${s.move.dir}`;
      if (seen.has(k)) continue; seen.add(k); out.push(s);
      if (out.length >= 100) break;
    }
    state._editorSols = out;
    const modLabel = `${mods.ignoreBag ? " · sans sac" : ""}${mods.ignoreRack ? " · sans reliquat" : ""}`;
    renderSolutionList(out, out[0]?.move || null,
      `Supertop (${out.length})${modLabel} — clique pour aperçu`,
      "Aucun mot ne tient dans cette zone.");
    hideFeedback();
  }, 30);
}

// ============================================================
//  Settings modal
// ============================================================
// Affiche les sous-options pertinentes selon le mode de jeu choisi dans le menu.
function syncPlayModeRows() {
  const pm = $("#optPlayMode")?.value || "topping";
  const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? "" : "none"; };
  // Duplicate : tirage auto + sélection auto du top + signalement des zéros.
  show("#rowAutoDraw", pm === "duplicate");
  show("#rowAutoTop", pm === "duplicate");
  show("#rowSignalZeros", pm === "duplicate");
}
window.openSettings = () => {
  $("#optPlayMode").value = state.settings.playMode || "topping";
  $("#optAutoDraw").checked = state.settings.autoDraw !== false;
  $("#optAutoTop").checked = state.settings.autoTop !== false;
  $("#optSignalZeros").checked = !!state.settings.signalZeros;
  $("#optPlayMode").onchange = syncPlayModeRows;
  syncPlayModeRows();
  $("#optGameMode").value = state.settings.gameMode;
  $("#optWithJoker").checked = state.settings.withJoker;
  $("#optRackPos").value = state.settings.rackPos;
  $("#optSortRack").checked = state.settings.sortRack;
  $("#optShowCoords").checked = state.settings.showCoords;
  $("#optColorTheme").value = state.settings.colorTheme || "classic";
  $("#optChronoType").value = state.settings.chronoType || "challenge";
  $("#optHighlightTop").checked = state.settings.highlightTop !== false;
  $("#optTimePerMove").value = state.settings.timePerMove;
  // Si la partie est en cours, on verrouille les "Paramètres de jeu"
  // (préférences perso restent modifiables).
  const inGame = state.started && state.chronoFinal == null;
  $("#optGameMode").disabled    = inGame;
  $("#optWithJoker").disabled   = inGame;
  $("#optTimePerMove").disabled = inGame;
  $("#optPlayMode").disabled    = inGame;
  $("#optAutoDraw").disabled    = inGame;
  // Indication visuelle
  const lockMsg = $("#settingsLock");
  if (lockMsg) lockMsg.hidden = !inGame;
  // Bouton « Nouvelle partie » ↔ « Arrêter la partie » selon l'état.
  const nb = $("#btnNewOrStop");
  if (nb) {
    nb.textContent = inGame ? "⏹ Arrêter la partie" : "Nouvelle partie";
    nb.onclick = inGame ? stopGameFromSettings : () => restartGame();
  }
  $("#settings").hidden = false;
};

// « Arrêter la partie » depuis les paramètres : stoppe net la partie en cours
// (sans révéler les coups restants comme « Abandonner ») et RÉACTIVE aussitôt
// les paramètres de jeu, sans quitter la fenêtre.
function stopGameFromSettings() {
  stopChrono();
  stopMoveTimer();
  if (topWordTimer) { clearTimeout(topWordTimer); topWordTimer = null; }
  state.started = false;
  state.chronoFinal = null;
  state._drawPhase = false;
  state._dupLast = null;
  state._dupSols = null;
  state._dupBaseBoard = null;
  state.pending = [];
  { const m = document.getElementById("drawModal"); if (m) m.hidden = true; }
  { const re = document.getElementById("drawReopen"); if (re) re.hidden = true; }
  { const p = document.getElementById("dupTopPicker"); if (p) p.hidden = true; }
  // Revenir à l'écran pré-démarrage en arrière-plan.
  $("#actionRowPreStart").hidden = false;
  $("#actionRowInGame").hidden = true;
  hideFeedback();
  renderBoard(); renderRack(); renderBag();
  // Rouvrir/rafraîchir les paramètres : les contrôles redeviennent modifiables.
  openSettings();
}
window.closeSettings = () => {
  const oldMode = state.settings.gameMode;
  const oldJoker = state.settings.withJoker;
  const oldPlayMode = state.settings.playMode;
  const oldAutoDraw = state.settings.autoDraw;
  state.settings.playMode = $("#optPlayMode").value || "topping";
  state.settings.autoDraw = $("#optAutoDraw").checked;
  state.settings.autoTop = $("#optAutoTop").checked;
  state.settings.signalZeros = $("#optSignalZeros").checked;
  state.settings.gameMode = $("#optGameMode").value;
  state.settings.withJoker = $("#optWithJoker").checked;
  state.settings.rackPos = $("#optRackPos").value;
  state.settings.sortRack = $("#optSortRack").checked;
  state.settings.showCoords = $("#optShowCoords").checked;
  state.settings.colorTheme = $("#optColorTheme").value || "classic";
  state.settings.chronoType = $("#optChronoType").value || "challenge";
  state.settings.highlightTop = $("#optHighlightTop").checked;
  state.settings.timePerMove = +$("#optTimePerMove").value || 0;
  saveSettings();
  saveSettingsToSupabase().catch(() => {});   // sync compte (silencieux si pas connecté ou pas de colonne)
  applyRackPos();
  applyColorTheme();
  renderRack();
  renderBoard();
  renderMoveTimer();
  renderGameTitle();
  $("#settings").hidden = true;
  // Si on a changé le mode (partie OU jeu) ou le joker, proposer de relancer
  if (oldMode !== state.settings.gameMode || oldJoker !== state.settings.withJoker ||
      oldPlayMode !== state.settings.playMode || oldAutoDraw !== state.settings.autoDraw) {
    if (state.started && !state.chronoFinal) {
      if (confirm("Mode de partie changé. Relancer une nouvelle partie ?")) restartGame();
    } else if (!state.started) {
      restartGame();
    }
  }
};
window.restartGame = () => {
  closeSettings();
  initGame();
  // En éditeur (et duplicate), l'écran « pré-démarrage » n'a pas de sens : on
  // relance directement une nouvelle session dans le même mode de jeu.
  if (state.settings.playMode === "editor") {
    // initGame est async (chargement dico) ; on attend qu'il soit prêt.
    const go = () => { if (state.dict) startGame(); else setTimeout(go, 50); };
    go();
  }
};

// ============================================================
//  Init / démarrage / fin de partie
// ============================================================
// Sur mobile, on aplatit la hiérarchie DOM pour pouvoir contrôler l'ordre vertical
// (display:contents ne fonctionne pas fiablement avec `order` sous Safari iOS).
let _origParents = null;   // mémorise l'ordre DOM d'origine pour restaurer le desktop
function applyMobileLayout() {
  if (!window.matchMedia("(max-width: 700px)").matches) return;
  if (document.body.dataset.mobileLayout === "1") return;
  const layout = document.querySelector(".layout");
  const leftCol = document.querySelector(".left-col");
  const rightCol = document.querySelector(".right-col");
  const gameWrap = document.querySelector(".game-wrap");
  if (!layout || !leftCol || !rightCol || !gameWrap) return;
  // Promouvoir les enfants au niveau .layout dans l'ordre souhaité
  const titleRow      = rightCol.querySelector(".title-row");
  const infoBar       = rightCol.querySelector(".info-bar");
  const timerChip     = rightCol.querySelector(".move-timer-chip");
  const preStartRow   = rightCol.querySelector("#actionRowPreStart");
  const inGameRow     = rightCol.querySelector("#actionRowInGame");
  const feedback      = rightCol.querySelector("#feedbackZone");
  const review        = rightCol.querySelector(".review-panel");
  const bag           = rightCol.querySelector(".bag-display");
  const board         = gameWrap.querySelector(".board");
  const rackRow       = gameWrap.querySelector(".rack-row");
  const els = [titleRow, infoBar, timerChip, preStartRow, feedback, board, inGameRow, rackRow, review, bag].filter(Boolean);
  // Mémoriser l'ordre d'origine des parents concernés (pour restauration desktop)
  const parents = [...new Set(els.map(e => e.parentNode))];
  _origParents = parents.map(p => ({ parent: p, children: [...p.children] }));
  // Ordre mobile : title → info → timer → preStart → feedback → board → pictos+⌫+✓ → rack
  els.forEach(el => layout.appendChild(el));
  document.body.dataset.mobileLayout = "1";
}
// Restaure la hiérarchie DOM desktop (réversibilité → test sur PC en rétrécissant).
function restoreDesktopLayout() {
  if (document.body.dataset.mobileLayout !== "1" || !_origParents) return;
  for (const { parent, children } of _origParents) {
    for (const ch of children) parent.appendChild(ch);   // ré-append dans l'ordre d'origine
  }
  _origParents = null;
  document.body.dataset.mobileLayout = "";
}
applyMobileLayout();
// Bascule mobile ⇄ desktop au redimensionnement (permet de simuler le mobile sur
// PC en rétrécissant la fenêtre, et c'est aussi du responsive correct).
let _layoutResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_layoutResizeTimer);
  _layoutResizeTimer = setTimeout(() => {
    if (window.matchMedia("(max-width: 700px)").matches) applyMobileLayout();
    else restoreDesktopLayout();
  }, 150);
});

// Détection plateforme : Mac (Cmd) vs Windows/Linux (Ctrl)
const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
// Remplace dynamiquement les libellés "Ctrl/Cmd+X" en "Cmd+X" ou "Ctrl+X"
// dans tous les attributs data-tip pour qu'ils collent à la plateforme du visiteur.
document.querySelectorAll("[data-tip]").forEach(el => {
  const tip = el.getAttribute("data-tip");
  if (!tip) return;
  // Pattern "Ctrl/Cmd+K" → "Ctrl+K" ou "Cmd+K" selon plateforme
  const adapted = tip
    .replace(/Ctrl\/Cmd\+/g, IS_MAC ? "Cmd+" : "Ctrl+")
    .replace(/Cmd\/Ctrl\+/g, IS_MAC ? "Cmd+" : "Ctrl+");
  if (adapted !== tip) el.setAttribute("data-tip", adapted);
});

// Info-bulles non-persistantes : sur clic d'un élément [data-tip], ajoute
// .show-tip pendant 1 s puis l'enlève. Compatible avec l'action native du
// bouton (les deux se produisent au même clic).
document.addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (!el) return;
  if (el._tipTimer) clearTimeout(el._tipTimer);
  el.classList.add("show-tip");
  el._tipTimer = setTimeout(() => el.classList.remove("show-tip"), 1000);
});

// Empêcher le double-tap zoom sur iOS Safari (qui ignore parfois user-scalable=no).
// On NE bloque le double-tap QUE sur le fond — les boutons et tuiles restent
// totalement réactifs aux tap rapides successifs.
if (window.matchMedia("(max-width: 700px)").matches) {
  let _lastTap = 0;
  document.addEventListener("touchend", (e) => {
    const target = e.target;
    // Tap sur élément interactif → pas de blocage (sinon les ⌫/✓/tuiles deviennent lents)
    if (target.closest && target.closest("button, .tile, td, a, input, select")) {
      _lastTap = Date.now();
      return;
    }
    const now = Date.now();
    if (now - _lastTap < 350) e.preventDefault();
    _lastTap = now;
  }, { passive: false });
  // Désactiver le gesture pinch-to-zoom de Safari iOS
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("gesturechange", (e) => e.preventDefault());
  document.addEventListener("gestureend", (e) => e.preventDefault());
}


// Ajoute les formules « superoriginales » au sélecteur d'entraînement, mais
// UNIQUEMENT pour le pseudo stof (les autres joueurs ne les voient pas).
function populateAdminModes() {
  // Formules superoriginales MISES EN VEILLE : on ne les ajoute plus au
  // sélecteur d'entraînement (ni stof ni admin). Pour les réactiver, retirer ce
  // return et restaurer le filtre par pseudo « stof » ci-dessous.
  return;
  // eslint-disable-next-line no-unreachable
  if ((localStorage.getItem("currentPseudo") || "").toLowerCase() !== "stof") return;
  const sel = $("#optGameMode");
  if (!sel || sel.dataset.adminDone) return;
  const grp = document.createElement("optgroup");
  grp.label = "Formules superoriginales";
  for (const [key, m] of Object.entries(GAME_MODES)) {
    if (!m.adminOnly || m.hidden) continue;
    const o = document.createElement("option");
    o.value = key; o.textContent = m.label;
    grp.appendChild(o);
  }
  sel.appendChild(grp);
  sel.dataset.adminDone = "1";
}

async function initGame() {
  captureSwVersion();   // détecter un éventuel service worker périmé
  populateAdminModes();
  state.bag = { ...LETTER_BAG };
  state.prepared = null;
  state.isPuzzle = false;
  state.preparedIdx = 0;
  // Mode joker (ou joker payant) : extraire les 2 jokers du sac et les stocker à part
  if (effJoker()) {
    state.spareJokers = state.bag["?"] || 0;
    state.bag["?"] = 0;
  } else {
    state.spareJokers = 0;
  }
  // Grille random (entraînement) : disposition des bonus tirée pour cette partie.
  state.boardLayout = currentMode().randomBoard ? randomBoardLayout() : null;
  state.snakeEnds = null;   // mode Snake : extrémités du serpent

  state.board = emptyBoard();
  state.rack = [];
  state.pending = [];
  state.cursor = null;
  state._drawPhase = false;
  state._dupLast = null;
  state._dupSols = null;
  state._dupBaseBoard = null;
  { const p = document.getElementById("dupTopPicker"); if (p) p.hidden = true; }
  { const d = document.getElementById("drawModal"); if (d) d.hidden = true; }
  { const re = document.getElementById("drawReopen"); if (re) re.hidden = true; }
  state._editor = false;
  state._editorSols = null;
  state._editorBase = null;
  state._editorSel = null;
  state._coups = [];
  if (state._stCleanup) { state._stCleanup(); state._stCleanup = null; }
  hideEditorToolbar();
  state.moveNo = 1;
  state.totalScore = 0;
  state.sumNeg = 0;
  state.topMove = null;
  state.lastTop = null;
  state.started = false;
  state.chronoStart = null;
  state.chronoPenalty = 0;
  state.chronoFinal = null;
  state.lastPlaced = [];
  state.lastTopCells = [];
  state.invalidCells = [];
  state.history = [];
  state.moveStart = null;
  state.moveTimeLeft = 0;
  if (chronoTimer) { clearInterval(chronoTimer); chronoTimer = null; }
  if (moveTimer) { clearInterval(moveTimer); moveTimer = null; }
  if (topWordTimer) { clearTimeout(topWordTimer); topWordTimer = null; }
  // Reset UI review s'il était activé
  review.active = false;
  review.replayMode = false;
  document.body.classList.remove("in-review");
  document.body.classList.remove("review-replay");
  review.game = null;
  review.result = null;
  review.historyByMove = {};
  $("#reviewPanel").hidden = true;
  if (typeof closeReviewDict === "function") closeReviewDict();
  // Masquer le bouton Revoir (n'a de sens qu'en fin de partie)
  if (_btnReview) { _btnReview.hidden = true; _btnReview.disabled = true; _btnReview.classList.remove("active"); }
  // (rien à reset côté layout)
  document.querySelector(".info-bar")?.style.removeProperty("display");
  $("#endModal").hidden = true;
  $("#actionRowPreStart").hidden = false;
  $("#actionRowInGame").hidden = true;
  renderInfo();
  renderBoard();
  renderRack();
  applyRackPos();
  applyColorTheme();
  updateTournamentNavButtons();
  renderGameTitle();
  // ⚠️ ORDRE CRITIQUE : on charge la partie pré-tirée AVANT le dictionnaire.
  // Le bouton « Démarrer » est cliquable dès maintenant (actionRowPreStart est
  // visible) ; or le chargement du dictionnaire ci-dessous est long (~1 s au
  // 1er chargement). Si on chargeait la partie APRÈS le dico, un clic pendant
  // cette attente verrait state.prepared encore null → nextMove() tomberait
  // dans le tirage ALÉATOIRE de l'entraînement → « 1er tirage erroné ».
  // En chargeant ici, state.prepared est garanti prêt avant tout démarrage.
  let _freshlyLoaded = false;
  if (PREPARED_ID && String(state.prepared?.id) !== String(PREPARED_ID)) {
    showFeedback("", "Chargement de la partie…", "");
    try {
      await loadPreparedGame(PREPARED_ID);
      _freshlyLoaded = true;
    } catch (e) {
      showFeedback("error", "Impossible de charger la partie", e.message);
      return;
    }
    // Vérification préalable silencieuse : s'assurer que le premier coup est cohérent
    // avant d'afficher quoi que ce soit au joueur.
    const verifyErr = verifyPreparedGame(state.prepared);
    if (verifyErr) {
      showFeedback("error", "Données de partie invalides", verifyErr);
      console.error("[verifyPreparedGame]", verifyErr, state.prepared);
      return;
    }
  }
  // Auto-réparation « 1er tirage erroné » EN BACKSTAGE : si l'état pré-tiré
  // provient de la mémoire (loadPreparedGame n'a PAS été rejoué car l'id était
  // déjà en place — cas de réentrée/cache où les données peuvent être périmées),
  // on compare le tirage du 1er coup en mémoire à celui réellement stocké en
  // base. En cas de divergence, on recharge silencieusement la page : la
  // nouvelle lecture repart de la base, le bon tirage s'affiche, et on revérifie.
  // Le joueur ne voit qu'un bref écran de chargement, jamais le mauvais tirage.
  if (PREPARED_ID && !_freshlyLoaded) {
    const ok = await healFirstTirage(PREPARED_ID);
    if (!ok) return;   // un rechargement est en cours
  } else if (PREPARED_ID) {
    // Chargement neuf et cohérent : on purge le compteur de tentatives.
    try { sessionStorage.removeItem(`pgHeal_${PREPARED_ID}`); } catch {}
  }
  if (!state.dict) {
    // (Pas de feedback "Chargement du dictionnaire" — UX silencieuse)
    state.dict = await new Dictionary().load("ods9.txt");
    // Le bouton ✓ (démarrer) est cliquable avant la fin de ce chargement : si la
    // partie a démarré entre-temps, le top du coup courant n'a pas pu être calculé.
    // On le (re)calcule maintenant que le dico est prêt.
    if (state._topPending) { ensureTopReady(); renderInfo?.(); }
  }
  // Charger les préférences perso depuis Supabase (asynchrone, silencieux)
  loadSettingsFromSupabase().catch(() => {});
  // Mode REVIEW d'une partie pré-tirée jouée
  if (REVIEW_ID) {
    try {
      await enterReviewMode(REVIEW_ID);
    } catch (e) {
      showFeedback("error", "Impossible d'afficher la partie", e.message);
    }
    return;
  }
  // Mode REVIEW d'une partie FFSC importée (handoff via sessionStorage)
  if (FFSC_REVIEW) {
    try {
      enterFfscReviewMode();
    } catch (e) {
      showFeedback("error", "Impossible d'afficher la partie", e.message);
    }
    return;
  }
  // Mode REVIEW d'un entraînement
  if (TRAINING_ID) {
    try {
      await enterTrainingReviewMode(TRAINING_ID);
    } catch (e) {
      showFeedback("error", "Impossible d'afficher l'entraînement", e.message);
    }
    return;
  }
  // Mode PUZZLE : tenter un seul coup d'une partie pré-tirée
  if (PUZZLE_GAME_ID) {
    try {
      await enterPuzzleMode(PUZZLE_GAME_ID, PUZZLE_MOVE_NO);
    } catch (e) {
      showFeedback("error", "Impossible de charger le puzzle", e.message);
    }
    return;
  }
  // (Le chargement de la partie pré-tirée a déjà été fait plus haut, AVANT le
  // dictionnaire — voir « ORDRE CRITIQUE ».)
  // Partie de TOURNOI mise en pause puis rechargée (retour d'une autre appli, même
  // des heures après) → on la restaure au coup exact, en pause.
  if (PREPARED_ID && restorePausedPrepared(PREPARED_ID)) return;
  // Si aucune URL spéciale, et qu'on a un entraînement en pause sauvegardé → restaurer
  if (!PREPARED_ID && !TRAINING_ID && !PUZZLE_GAME_ID && !REVIEW_ID) {
    if (restorePausedTraining()) return;
  }
  hideFeedback();
}

// Mode "puzzle" : on charge une partie pré-tirée et on plante le plateau au coup
// spécifié pour que le joueur essaie de retrouver le top. Pas de sauvegarde.
async function enterPuzzleMode(gameId, moveNo) {
  showFeedback("", "Chargement du puzzle…", "");
  if (!window._sb) await loadSupabaseClient();
  // S'assurer que la session d'auth est restaurée AVANT la requête : sinon RLS
  // peut renvoyer 0 ligne (rôle anonyme) et single() échoue avec un message vide.
  try { await window._sb.auth.getSession(); } catch { /* non bloquant */ }

  // On NE filtre PAS avec .single() (qui transforme "0 ligne" en erreur opaque
  // sans message). On récupère la liste et on diagnostique nous-mêmes.
  const { data: rows, error } = await window._sb
    .from("prepared_games").select("*").eq("id", gameId);
  if (error) {
    console.error("[enterPuzzleMode] erreur Supabase:", error);
    throw new Error(`Erreur base : ${error.message || error.code || "inconnue"}`);
  }
  if (!rows || rows.length === 0) {
    console.error("[enterPuzzleMode] aucune partie pré-tirée id=", gameId,
      "— probablement supprimée/régénérée alors que les résultats y réfèrent encore.");
    throw new Error(`Cette partie (id ${gameId}) n'existe plus en base — elle a sans doute été régénérée. Le rejeu de ce solo n'est plus disponible.`);
  }
  const g = rows[0];
  // Tournoi d'origine du solo (depuis la base), pour router le bouton retour même
  // si l'URL ne portait pas de tid (solo lancé depuis les stats/records).
  state._soloTid = g.tournament_id || TOURNAMENT_ID || null;

  if (!Array.isArray(g.moves) || g.moves.length === 0) {
    console.error("[enterPuzzleMode] g.moves invalide:", g.moves);
    throw new Error("Données de partie corrompues (aucun coup).");
  }
  const idx = moveNo - 1;
  if (idx < 0 || idx >= g.moves.length || !g.moves[idx]) {
    throw new Error(`Coup ${moveNo} introuvable (la partie ne compte que ${g.moves.length} coups).`);
  }
  // Appliquer les coups 0..idx-1 au plateau
  let board = emptyBoard();
  for (let i = 0; i < idx; i++) {
    const prevTop = g.moves[i]?.top;
    if (!prevTop || !prevTop.word) {
      console.error("[enterPuzzleMode] coup précédent sans top, i=", i, g.moves[i]);
      throw new Error(`Données corrompues au coup ${i + 1} (top manquant).`);
    }
    try {
      board = applyMove(board, prevTop);
    } catch (e) {
      console.error("[enterPuzzleMode] applyMove a échoué au coup", i + 1, prevTop, e);
      throw new Error(`Impossible de reconstituer le plateau au coup ${i + 1}.`);
    }
  }
  state.board = board;
  // Préparer un faux "prepared" mono-coup pour réutiliser tout le moteur
  state.prepared = {
    id: g.id,
    name: `${g.name} — coup ${moveNo}`,
    mode: g.mode,
    withJoker: g.with_joker,
    timePerMove: g.time_per_move,
    moves: [g.moves[idx]],   // une seule "partie"
  };
  state.boardLayout = g.moves?.[0]?._layout || null;   // grille random (solo rejouer)
  state.preparedIdx = 0;
  // Synchroniser state.moveNo sur la position réelle dans la partie, pour que
  // les règles dépendantes du numéro de coup (ex. : exception 1er coup) ne
  // s'appliquent qu'au vrai premier coup (moveNo=1), pas à tous les puzzles.
  state.moveNo = moveNo;
  state.settings.gameMode = g.mode;
  state.settings.withJoker = g.with_joker;
  state.settings.timePerMove = g.time_per_move;
  // Marquer ce mode comme "puzzle" pour ne pas sauvegarder à la fin
  state.isPuzzle = true;
  renderGameTitle();
  renderBoard();
  hideFeedback();
  // Le bouton « retour » doit ramener au TOURNOI d'où vient le solo, et s'appeler
  // « ← Tournoi ». On masque « ← Accueil » et on affiche le bouton dédié (dès qu'on
  // connaît le tournoi, via l'URL ou via la base).
  if (state._soloTid) {
    const btnHome = $("#btnHome");
    if (btnHome) btnHome.hidden = true;
    if (_btnBackToTournament) _btnBackToTournament.hidden = false;
  }
  // On lance directement le coup (pas d'écran « Appuie sur Entrée »).
  startGame();
}

async function enterTrainingReviewMode(id) {
  showFeedback("", "Chargement de l'entraînement…", "");
  if (!window._sb) await loadSupabaseClient();
  const { data: t, error } = await window._sb.from("training_games").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  // Reconstituer un objet "game" + result équivalent pour reuser le moteur de review
  const fakeGame = {
    id: t.id,
    name: `Entraînement du ${(t.created_at || "").slice(0,10)}`,
    mode: t.mode,
    with_joker: t.with_joker,
    time_per_move: t.time_per_move,
    moves: (t.history || []).filter(h => h.top).map(h => ({
      moveNo: h.moveNo,
      rack: h.rack,
      top: {
        word: h.top.word, row: h.top.row, col: h.top.col, dir: h.top.dir,
        blanks: h.top.blanks || [], score: h.top.score, words: h.top.words || [],
      },
    })),
  };
  const fakeResult = {
    total_score: t.total_score, sum_neg: t.sum_neg,
    total_time_seconds: t.total_time_seconds, details: t.history,
  };
  review.active = true;
  document.body.classList.add("in-review");
  $("#bagDisplay") && ($("#bagDisplay").hidden = true);   // pas de sac en review
  review.game = fakeGame;
  review.result = fakeResult;
  review.historyByMove = {};
  for (const h of (t.history || [])) review.historyByMove[h.moveNo] = h;
  state.history = t.history || [];
  review.step = 1;
  review.replayMode = false;
  state.started = false;
  state.settings.gameMode = t.mode;
  state.settings.withJoker = t.with_joker;
  state.settings.timePerMove = t.time_per_move;
  renderGameTitle();
  document.querySelector(".info-bar")?.style.setProperty("display", "none");
  $("#reviewPanel").hidden = false;
  showFeedback("success", `📺 ${fakeGame.name}`,
    `Score : <strong>${t.total_score}</strong> · Négatif : <strong>${t.sum_neg}</strong> · Temps : <strong>${fmtChrono(t.total_time_seconds || 0)}</strong>`);
  renderReviewStep();
}

// Revoir une partie FFSC importée (données passées via sessionStorage par app.js).
// Aucun appel réseau : on reconstitue fakeGame/historyByMove à partir des
// tirages + tops (export TXT) et de la feuille de route (coups joués / négatifs).
function enterFfscReviewMode() {
  const raw = sessionStorage.getItem("ffscReview");
  if (!raw) throw new Error("Aucune partie à afficher (relance l'import).");
  const { player, serie, tournoi, tournoiId, partie } = JSON.parse(raw);
  if (!partie || !partie.moves) throw new Error("Données de partie incomplètes.");
  // Clé stable de persistance des saisies (id tournoi + n° partie).
  review._ffscKey = `${tournoiId || tournoi || "x"}:${partie.numero}`;

  const fakeGame = {
    id: null,
    name: `${tournoi || "Tournoi"} — Partie ${partie.numero}${partie.table != null ? " (table " + partie.table + ")" : ""}`,
    mode: partie.meta?.mode || "duplicate",
    with_joker: false,
    time_per_move: 0,
    moves: (partie.moves || []).filter(h => h.top).map(h => ({
      moveNo: h.moveNo,
      rack: h.rack,
      top: {
        word: h.top.word, row: h.top.row, col: h.top.col, dir: h.top.dir,
        blanks: h.top.blanks || [], score: h.top.score, words: h.top.words || [],
      },
    })),
  };
  // Feuille de route → "ce que tu as joué" par coup.
  review.historyByMove = {};
  review.game = fakeGame;           // requis pour la clé de sauvegarde des picks
  loadReviewPicks();                // restaure les sélections de la session (rapide)
  loadPicksRemote();                // puis écrase avec la sauvegarde permanente (profil)
  const hist = [];
  for (const c of (partie.coups || [])) {
    const h = {
      moveNo: c.moveNo,
      played: c.word || null,
      playerScore: c.playerScore,
      neg: c.neg,
      status: c.status === "top" ? "top" : "submit",
    };
    review.historyByMove[c.moveNo] = h;
    hist.push(h);
  }

  review.active = true;
  document.body.classList.add("in-review");
  $("#bagDisplay") && ($("#bagDisplay").hidden = true);
  review.game = fakeGame;
  review.result = { total_score: partie.total, sum_neg: partie.total != null && partie.topTotal != null ? partie.total - partie.topTotal : null, total_time_seconds: 0, details: hist };
  state.history = hist;
  review.step = 1;
  review.replayMode = false;
  state.started = false;
  state.settings.gameMode = fakeGame.mode;
  state.settings.withJoker = false;
  renderGameTitle();
  document.querySelector(".info-bar")?.style.setProperty("display", "none");
  $("#btnStart") && ($("#btnStart").hidden = true);
  $("#btnSheetReview") && ($("#btnSheetReview").hidden = true);
  // Le bouton « ← Accueil » revient à la LISTE DES PARTIES du tournoi (onglet
  // perso ré-ouvert + ré-import), au lieu de l'accueil Tournois.
  const _home = $("#btnHome");
  if (_home && tournoiId) { _home.href = `../index.html?ffscTournoi=${encodeURIComponent(tournoiId)}`; _home.textContent = "← Parties"; }
  $("#reviewPanel").hidden = false;
  const negTot = (partie.total != null && partie.topTotal != null) ? partie.total - partie.topTotal : null;
  showFeedback("success", `📺 ${player || ""} — Partie ${partie.numero}`,
    `Score : <strong>${partie.total ?? "—"}</strong> · Top : <strong>${partie.topTotal ?? "—"}</strong>${negTot != null ? ` · Négatif : <strong>${negTot}</strong>` : ""}${serie ? ` · Série ${serie}` : ""}`);
  renderReviewStep();
}

async function enterReviewMode(id) {
  showFeedback("", "Chargement de la partie…", "");
  if (!window._sb) await loadSupabaseClient();
  const { data: game, error: e1 } = await window._sb.from("prepared_games").select("*").eq("id", id).single();
  if (e1) throw new Error(e1.message);
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  let result = null;
  if (pid) {
    const { data: r } = await window._sb.from("prepared_game_results")
      .select("*").eq("prepared_game_id", id).eq("player_id", pid).maybeSingle();
    result = r;
  }
  // Init du mode review
  review.active = true;
  document.body.classList.add("in-review");
  $("#bagDisplay") && ($("#bagDisplay").hidden = true);   // pas de sac en review
  review.game = game;
  review.result = result;
  review.historyByMove = {};
  state.boardLayout = game.moves?.[0]?._layout || null;   // grille random : disposition stockée
  // Adopter les paramètres de la partie pour le titre
  state.settings.gameMode = game.mode;
  state.settings.withJoker = game.with_joker;
  state.settings.timePerMove = game.time_per_move;
  renderGameTitle();
  // Masquer la barre d'info (non pertinente en review)
  document.querySelector(".info-bar")?.style.setProperty("display", "none");
  if (result?.details) {
    for (const h of result.details) review.historyByMove[h.moveNo] = h;
    state.history = result.details; // pour la feuille de route accessible
  }
  review.step = 1;
  review.replayMode = false;
  state.started = false;
  // Afficher le panel review
  $("#reviewPanel").hidden = false;
  // (layout déjà en 2 colonnes — rien à faire)
  // Header de feedback (résumé général)
  // Swap "Démarrer" → "Feuille de route" + "← Accueil" → "← Tournoi"
  $("#btnStart").hidden = true;
  $("#btnSheetReview").hidden = !result;   // visible seulement si on a joué la partie
  const btnHome = $("#btnHome");
  if (btnHome) btnHome.hidden = true;
  if (_btnBackToTournament) _btnBackToTournament.hidden = false;

  const summary = result
    ? `Ton score : <strong>${result.total_score}</strong> · Négatif : <strong>${result.sum_neg}</strong> · Temps : <strong>${fmtChrono(result.total_time_seconds || 0)}</strong>`
    : `<em>Tu n'as pas encore joué cette partie.</em>`;
  showFeedback("success", `📺 Parcours de « ${game.name} »`, summary);
  renderReviewStep();
}

function renderReviewStep() {
  const moves = review.game.moves;
  const total = moves.length;
  if (review.step < 1) review.step = 1;
  if (review.step > total) review.step = total;
  const idx = review.step - 1;
  const m = moves[idx];

  // La saisie « mon coup / zéro » n'a de sens qu'en review FFSC (coups inconnus).
  // Pour une partie Topissimo, le coup joué est connu → affichage seul (top vert,
  // coup joué en rouge), sans contrôles de saisie.
  document.body.classList.toggle("ffsc-review", !!review._ffscKey);

  const replay = !!review.replayMode;
  // Sync visuel du bouton replay
  const _rvReplayBtn = $("#rvReplay");
  if (_rvReplayBtn) _rvReplayBtn.classList.toggle("active", replay);
  // En mode replay (« secret »), on ré-affiche le tirage sur mobile (masqué
  // sinon en review faute de place) pour que le joueur cherche le top.
  document.body.classList.toggle("review-replay", replay);

  if (replay) {
    // Mode replay : plateau AVANT le coup courant (sans le top)
    let board = emptyBoard();
    for (let i = 0; i < idx; i++) board = applyMove(board, moves[i].top);
    state.board = board;
    state.lastPlaced = [];
    state.lastTopCells = [];
  } else {
    // Mode normal : plateau APRÈS application des coups 1..step (incluant le coup courant)
    let board = emptyBoard();
    for (let i = 0; i < review.step; i++) board = applyMove(board, moves[i].top);
    state.board = board;
    // Mettre en surbrillance le coup courant (lastPlaced + toutes les cases du mot)
    const boardBefore = moves.slice(0, idx).reduce((b, mv) => applyMove(b, mv.top), emptyBoard());
    state.lastPlaced = computeLastPlacedCells(boardBefore, m.top);
    const dr = m.top.dir === "V" ? 1 : 0, dc = m.top.dir === "H" ? 1 : 0;
    state.lastTopCells = Array.from({ length: m.top.word.length }, (_, i) => ({
      row: m.top.row + i * dr, col: m.top.col + i * dc,
    }));
  }

  // Chevalet du coup courant
  state.rack = m.rack.split("").map((L, i) => ({ letter: L, used: false, id: i + 1 }));
  state.cursor = null;
  state.pending = [];
  renderBoard();
  renderRack();

  // Nav
  $("#rvStep").textContent = `Coup ${review.step} / ${total}`;
  $("#rvPrev").disabled = review.step <= 1;
  $("#rvFirst").disabled = review.step <= 1;
  $("#rvNext").disabled = review.step >= total;
  $("#rvLast").disabled = review.step >= total;

  // Masquer/afficher le panneau de résultats selon le mode replay
  const rvInfoLines = $$("#reviewPanel .review-line");
  const rvSolutions = $("#rvSolutions");
  rvInfoLines.forEach(el => el.hidden = replay);
  if (rvSolutions) rvSolutions.hidden = replay;

  if (!replay) {
    // Top joué
    $("#rvTop").innerHTML = `${wLink(m.top.word)} — ${m.top.score} pts en ${posLabelMove(m.top)}`
      + (m.subTop ? ` <span class="muted">· sous-top ${wLink(m.subTop.word)} — ${m.subTop.score} pts en ${posLabelMove(m.subTop)}</span>` : "");
    renderReviewPlayed(m);
    // Autres solutions valides (calcul à la volée)
    renderReviewSolutions(idx);
  }
}

// ---- Saisie « mon coup » + négatif (sélection dans les solutions / zéro) ----
// Négatif effectif d'un coup (≤ 0). Priorité à la saisie du joueur, sinon au
// négatif connu (endirect). null si on ne sait rien.
function reviewMoveNeg(m) {
  const pick = review.userPicks?.[m.moveNo];
  if (pick) {
    const ps = pick.zero ? 0 : (pick.score || 0);
    return -Math.max(0, (m.top.score || 0) - ps);
  }
  const k = review.historyByMove?.[m.moveNo];
  if (k && k.neg != null) return k.neg <= 0 ? k.neg : -k.neg;
  return null;
}

function renderReviewPlayed(m) {
  const known = review.historyByMove?.[m.moveNo];
  const pick = review.userPicks?.[m.moveNo];
  const playedEl = $("#rvPlayed"), negEl = $("#rvNeg");
  const zf = $("#rvZeroForm"); if (zf) zf.hidden = true;   // referme le champ « zéro » en changeant de coup

  // Ligne « Toi »
  if (pick) {
    if (pick.zero) playedEl.innerHTML = `🚫 Zéro${pick.word ? " : " + wLink(pick.word) + (pick.pos ? " en " + pick.pos : "") : " (mot refusé)"} — 0 pt`;
    else playedEl.innerHTML = `${wLink(pick.word)} — ${pick.score} pts en ${pick.pos} ${pick.score >= (m.top.score || 0) ? "🏆" : ""} <span class="muted">(ma saisie)</span>`;
  } else if (known && known.played) {
    const refPos = known.playedPos ? ` en ${known.playedPos}` : "";
    playedEl.innerHTML = `${wLink(known.played)} — ${known.playerScore} pts${refPos} ${known.status === "top" ? "🏆" : known.status === "timeout" ? "⏱" : ""}`;
  } else if (known && known.status) {
    playedEl.textContent = `— (rien joué, ${known.status})`;
  } else if (review._ffscKey) {
    playedEl.innerHTML = `<span class="muted">à compléter (choisis ton coup ci-dessous)</span>`;
  } else {
    playedEl.innerHTML = `<span class="muted">—</span>`;
  }

  // Négatif effectif + écart éventuel avec le négatif connu
  const eff = reviewMoveNeg(m);
  negEl.textContent = eff != null ? String(eff) : "—";
  const knownNeg = (known && known.neg != null) ? (known.neg <= 0 ? known.neg : -known.neg) : null;
  if (pick && knownNeg != null && eff !== knownNeg) {
    negEl.innerHTML = `${eff} <span style="color:#a02525;font-weight:600">⚠️ écart (connu : ${knownNeg})</span>`;
  }

  // Cumul (somme des négatifs effectifs connus/saisis)
  const moves = review.game.moves;
  let cum = 0, n = 0;
  for (const mv of moves) { const e = reviewMoveNeg(mv); if (e != null) { cum += e; n++; } }
  const cumEl = $("#rvCumul");
  if (cumEl) cumEl.textContent = n ? `Négatif cumulé : ${cum} (${n}/${moves.length} coups)` : "";
}

function reviewPickKey() {
  return "ffscReviewPicks:" + (review._ffscKey || review.game?.id || review.game?.name || "x");
}
function persistReviewPicks() {
  try { sessionStorage.setItem(reviewPickKey(), JSON.stringify(review.userPicks || {})); } catch (e) {}
  if (review._ffscKey) scheduleSavePicksRemote();   // sauvegarde permanente (profil)
}
function loadReviewPicks() {
  try { review.userPicks = JSON.parse(sessionStorage.getItem(reviewPickKey()) || "{}") || {}; }
  catch (e) { review.userPicks = {}; }
}

// Persistance permanente des saisies dans players.settings.ffscPicks[clé].
let _savePicksTimer = null;
function scheduleSavePicksRemote() {
  clearTimeout(_savePicksTimer);
  _savePicksTimer = setTimeout(() => { savePicksRemote().catch(() => {}); }, 800);
}
async function savePicksRemote() {
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  if (!pid || !review._ffscKey) return;
  if (!window._sb) await loadSupabaseClient();
  const { data } = await window._sb.from("players").select("settings").eq("id", pid).maybeSingle();
  const settings = (data && data.settings) || {};
  settings.ffscPicks = settings.ffscPicks || {};
  settings.ffscPicks[review._ffscKey] = review.userPicks || {};
  await window._sb.from("players").update({ settings }).eq("id", pid);
}
async function loadPicksRemote() {
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  if (!pid || !review._ffscKey) return;
  try {
    if (!window._sb) await loadSupabaseClient();
    const { data } = await window._sb.from("players").select("settings").eq("id", pid).maybeSingle();
    const stored = data && data.settings && data.settings.ffscPicks && data.settings.ffscPicks[review._ffscKey];
    if (stored && Object.keys(stored).length) {
      review.userPicks = stored;
      sessionStorage.setItem(reviewPickKey(), JSON.stringify(stored));
      if (review.active) renderReviewStep();
    }
  } catch (e) { /* silencieux */ }
}

window.setReviewMyMove = function(i) {
  const sol = review._solutions?.[i];
  const m = review.game.moves[review.step - 1];
  if (!sol || !m) return;
  review.userPicks = review.userPicks || {};
  review.userPicks[m.moveNo] = { word: sol.move.word, pos: posLabelMove(sol.move), score: sol.score, zero: false };
  persistReviewPicks();
  previewSolution(i);
  renderReviewPlayed(m);
  renderReviewSolutions(review.step - 1);
};
window.setReviewZero = function() {
  // Ouvre le champ de saisie du mot faux (optionnel) ; l'enregistrement se fait
  // à la validation (confirmReviewZero).
  const form = $("#rvZeroForm");
  if (!form) return;
  const m = review.game.moves[review.step - 1];
  const cur = review.userPicks?.[m?.moveNo];
  $("#rvZeroWord").value = (cur && cur.zero && cur.word) ? cur.word : "";
  $("#rvZeroPos").value = (cur && cur.zero && cur.pos) ? cur.pos : "";
  form.hidden = !form.hidden;
  if (!form.hidden) $("#rvZeroWord").focus();
};
window.confirmReviewZero = function() {
  const m = review.game.moves[review.step - 1];
  if (!m) return;
  const word = ($("#rvZeroWord").value || "").trim().toUpperCase().replace(/[^A-ZÀ-Ÿ]/g, "");
  const pos = ($("#rvZeroPos").value || "").trim().toUpperCase().replace(/\s+/g, "");
  review.userPicks = review.userPicks || {};
  review.userPicks[m.moveNo] = { zero: true, score: 0, word: word || null, pos: pos || null };
  persistReviewPicks();
  $("#rvZeroForm").hidden = true;
  renderReviewPlayed(m);
  renderReviewSolutions(review.step - 1);
};
window.clearReviewPick = function() {
  const m = review.game.moves[review.step - 1];
  if (!m || !review.userPicks) return;
  delete review.userPicks[m.moveNo];
  persistReviewPicks();
  renderReviewPlayed(m);
  renderReviewSolutions(review.step - 1);
};

function posLabelMove(mv) {
  const letter = "ABCDEFGHIJKLMNO"[mv.row];
  const num = mv.col + 1;
  return mv.dir === "H" ? `${letter}${num}` : `${num}${letter}`;
}

function computeLastPlacedCells(boardBefore, mv) {
  const dr = mv.dir === "V" ? 1 : 0;
  const dc = mv.dir === "H" ? 1 : 0;
  const cells = [];
  for (let i = 0; i < mv.word.length; i++) {
    const r = mv.row + i * dr, c = mv.col + i * dc;
    if (!boardBefore[r][c]) cells.push({ row: r, col: c });
  }
  return cells;
}

// Génère une capture (canvas) de la position au coup courant — SANS le top
// visible sur la grille — avec le tirage en-dessous. Tente d'utiliser
// navigator.share (mobile / desktop compatible), sinon télécharge l'image.
async function shareReviewSnapshot() {
  if (!review.active || !review.game) return;
  const moves = review.game.moves;
  const idx = review.step - 1;
  const m = moves[idx];
  if (!m) return;
  // État du plateau AVANT le coup courant (donc sans la solution du coup en review)
  let board = emptyBoard();
  for (let i = 0; i < idx; i++) board = applyMove(board, moves[i].top);
  const rack = m.rack || "";
  const moveNo = m.moveNo || review.step;
  const gameName = review.game.name || "Partie";

  const blob = await renderSnapshotToBlob(board, rack, { moveNo, gameName });
  if (!blob) return;
  await shareBlobOrFallback(blob, `${gameName} — Coup ${moveNo}`, `topissimo-coup-${moveNo}.png`);
}

function renderSnapshotToBlob(board, rack, opts = {}) {
  return new Promise((resolve) => {
    const CELL = 56;          // px par case dans la capture
    const PAD = 16;
    const TITLE_H = 40;
    const RACK_H = 80;
    const W = PAD * 2 + CELL * BOARD_SIZE;
    const H = PAD + TITLE_H + CELL * BOARD_SIZE + 16 + RACK_H + PAD;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    // Thème actif (Garenna ou DupliJeu)
    const duplijeu = state.settings.colorTheme === "duplijeu";
    // Fond
    ctx.fillStyle = duplijeu ? "#cfe2f0" : "#f7f8fa";
    ctx.fillRect(0, 0, W, H);
    // Titre
    ctx.fillStyle = "#002E44";
    ctx.font = "600 18px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${opts.gameName || "Partie"} — Coup ${opts.moveNo || ""}`, PAD, PAD + TITLE_H / 2);
    // Couleurs du plateau adaptées au thème
    const COLORS = duplijeu ? {
      normal: "#ffffff",
      dl:     "#a4d8e1",
      tl:     "#3a8db5",
      dw:     "#f0a8a8",
      tw:     "#cc4040",
      center: "#f0a8a8",   // rose comme DupliJeu (étoile sur fond rose)
    } : {
      normal: "#ede4ce",
      dl:     "#a4d8e1",
      tl:     "#3a8db5",
      dw:     "#f0a8a8",
      tw:     "#cc4040",
      center: "#FFDD00",
    };
    const boardX = PAD;
    const boardY = PAD + TITLE_H;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const bonus = (state.boardLayout || BOARD_BONUSES)[r][c];
        const isCenter = r === CENTER && c === CENTER;
        // En grille random, le centre garde la couleur de sa case tirée (l'étoile
        // est dessinée par-dessus). Sinon, centre classique = mot ×2.
        let cls = "normal";
        if (bonus === "*" || (isCenter && !state.boardLayout)) cls = "center";
        else if (bonus === "d") cls = "dl";
        else if (bonus === "t") cls = "tl";
        else if (bonus === "D") cls = "dw";
        else if (bonus === "T") cls = "tw";
        const x = boardX + c * CELL, y = boardY + r * CELL;
        ctx.fillStyle = COLORS[cls];
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = duplijeu ? "#b3c1ce" : "#cbd2d8";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, CELL - 1, CELL - 1);
        // Étoile sur le centre
        if (isCenter) {
          ctx.fillStyle = "#111";
          ctx.font = `${Math.round(CELL * 0.5)}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("★", x + CELL / 2, y + CELL / 2);
        }
        // Lettre posée
        const cell = board[r][c];
        if (cell) {
          // Fond jeton (selon thème)
          const tileBg     = duplijeu ? "#d8b975" : "#f5d97a";
          const tileBorder = duplijeu ? "#000"    : "#8a6a1f";
          const tileText   = duplijeu ? "#111"    : "#1f2a2e";
          const tileValue  = duplijeu ? "#5a4a1f" : "#5a4a1f";
          const tileFontFamily = duplijeu ? "'Inter', system-ui, sans-serif" : "Georgia, serif";
          ctx.fillStyle = tileBg;
          const m = duplijeu ? 1 : 3;
          ctx.fillRect(x + m, y + m, CELL - 2 * m, CELL - 2 * m);
          ctx.strokeStyle = tileBorder;
          ctx.lineWidth = duplijeu ? 0.5 : 1.5;
          ctx.strokeRect(x + m + .5, y + m + .5, CELL - 2 * m - 1, CELL - 2 * m - 1);
          // Lettre
          ctx.fillStyle = cell.isBlank ? "#c8202a" : tileText;
          ctx.font = `700 28px ${tileFontFamily}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(cell.letter, x + CELL / 2, y + CELL / 2 + 2);
          // Valeur en exposant
          if (!cell.isBlank) {
            ctx.fillStyle = tileValue;
            ctx.font = `600 10px ${tileFontFamily}`;
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            ctx.fillText(String(LETTER_VALUE[cell.letter] ?? ""), x + CELL - 6, y + CELL - 4);
          }
        }
      }
    }
    // Tirage (rack) en dessous
    const rackY = boardY + CELL * BOARD_SIZE + 16;
    const letters = rack.split("");
    const TW = 60, TH = 70, TGAP = 6;
    const tilesTotalW = letters.length * TW + (letters.length - 1) * TGAP;
    const tilesX = (W - tilesTotalW) / 2;
    // Label "Tirage :"
    ctx.fillStyle = "#5a6a73";
    ctx.font = "500 14px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Tirage", PAD, rackY + TH / 2);
    // Jetons du tirage (selon thème)
    const tileBg     = duplijeu ? "#d8b975" : "#f5d97a";
    const tileBorder = duplijeu ? "#000"    : "#8a6a1f";
    const tileText   = duplijeu ? "#111"    : "#1f2a2e";
    const tileFontFamily = duplijeu ? "'Inter', system-ui, sans-serif" : "Georgia, serif";
    letters.forEach((L, i) => {
      const x = tilesX + i * (TW + TGAP);
      const y = rackY;
      ctx.fillStyle = tileBg;
      ctx.fillRect(x, y, TW, TH);
      ctx.strokeStyle = tileBorder;
      ctx.lineWidth = duplijeu ? 0.5 : 1.5;
      ctx.strokeRect(x + .5, y + .5, TW - 1, TH - 1);
      ctx.fillStyle = L === "?" ? "#c8202a" : tileText;
      ctx.font = `700 34px ${tileFontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(L === "?" ? "?" : L, x + TW / 2, y + TH / 2);
      if (L !== "?") {
        ctx.fillStyle = "#5a4a1f";
        ctx.font = `600 11px ${tileFontFamily}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(LETTER_VALUE[L] ?? ""), x + TW - 6, y + TH - 5);
      }
    });
    // Filigrane
    ctx.fillStyle = "#97a4ab";
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("gamestof.fr · Topissimo", W - PAD, H - PAD / 2);
    cv.toBlob((blob) => resolve(blob), "image/png", 0.95);
  });
}

function renderReviewSolutions(idx) {
  const div = $("#rvSolutions");
  const moves = review.game.moves;
  let boardBefore = emptyBoard();
  for (let i = 0; i < idx; i++) boardBefore = applyMove(boardBefore, moves[i].top);
  const rackLetters = moves[idx].rack.split("");
  const topMv = moves[idx].top;
  const _ph = review.historyByMove[moves[idx].moveNo];
  const playedMv = _ph?.played;
  const playedPos = _ph?.playedPos;
  review._boardBefore = boardBefore;

  div.innerHTML = `<div style="padding:20px;text-align:center;color:#888">⏳ Calcul des solutions…</div>`;
  setTimeout(() => {
    let all = findTop(boardBefore, rackLetters, state.dict, {
      all: true,
      bonuses: GAME_MODES[review.game.mode]?.bonuses || { 7: 50 },
      maxTilesUsed: GAME_MODES[review.game.mode]?.maxPlayed || 7,
      jokerPays: !!GAME_MODES[review.game.mode]?.jokerPays,
      layout: state.boardLayout,
    }) || [];
    // Au 1er coup, on ne joue jamais verticalement en duplicate
    if (idx === 0) all = all.filter(s => s.move.dir === "H");
    review._solutions = all.slice(0, 200);
    const isFfsc = !!review._ffscKey;   // saisie « mon coup » réservée aux reviews FFSC
    const pick = review.userPicks?.[moves[idx].moveNo];
    // Mode Top/sous-top : sous-top officiel + coups trouvés par le joueur.
    const subMv = moves[idx].subTop;
    const subWords = subMv ? (subMv.words && subMv.words.length ? subMv.words : [subMv.word]) : [];
    const dual = _ph?.dual;
    const myTopWord = dual?.topWord, mySubWord = dual?.subWord;
    const rows = review._solutions.map((s, i) => {
      const isTop = s.move.word === topMv.word && s.move.row === topMv.row && s.move.col === topMv.col && s.move.dir === topMv.dir;
      const isSub = subMv && subWords.includes(s.move.word) && s.score === subMv.score;
      const isPlayed = dual
        ? (myTopWord && myTopWord !== topMv.word && s.move.word === myTopWord)
        : (playedMv && s.move.word === playedMv && (!playedPos || posLabelMove(s.move) === playedPos));
      const isPlayedSub = dual && mySubWord && (!subMv || mySubWord !== subMv.word) && s.move.word === mySubWord;
      const isMine = pick && !pick.zero && s.move.word === pick.word && posLabelMove(s.move) === pick.pos;
      const cls = [isTop ? "is-top" : "", isSub ? "is-subtop" : "", isPlayed ? "is-played" : "", isPlayedSub ? "is-played-sub" : "", isMine ? "is-mine" : ""].join(" ").trim();
      return `<tr class="${cls}" data-i="${i}"><td>${wLink(s.move.word)}</td><td>${posLabelMove(s.move)}</td><td>${s.score}</td>` +
        (isFfsc ? `<td><button class="btn small rv-pick-btn" title="C'est le mot que j'ai joué" onclick="event.stopPropagation();setReviewMyMove(${i})">${isMine ? "✅" : "C'est mon coup"}</button></td>` : "") + `</tr>`;
    }).join("");
    div.innerHTML = `<table>
      <thead><tr><th>Mot</th><th>Place</th><th>Score</th>${isFfsc ? "<th></th>" : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    div.querySelectorAll("tr[data-i]").forEach(tr => {
      tr.onclick = () => previewSolution(+tr.dataset.i);
    });
  }, 30);
}

// Affiche la solution cliquée sur la grille (à la place du top initial)
function previewSolution(i) {
  const sol = review._solutions?.[i];
  if (!sol) return;
  // Replacer le plateau dans l'état AVANT le coup courant, puis appliquer la solution choisie
  const board = applyMove(review._boardBefore.map(r => r.slice()), sol.move);
  state.board = board;
  state.lastPlaced = computeLastPlacedCells(review._boardBefore, sol.move);
  renderBoard();
  // Marquer visuellement la ligne sélectionnée
  $$("#rvSolutions tr").forEach(tr => tr.classList.remove("selected"));
  $$(`#rvSolutions tr[data-i="${i}"]`).forEach(tr => tr.classList.add("selected"));
}

$("#rvFirst").onclick  = () => { review.step = 1; renderReviewStep(); };
$("#rvPrev").onclick   = () => { review.step--;    renderReviewStep(); };
$("#rvNext").onclick   = () => { review.step++;    renderReviewStep(); };
$("#rvLast").onclick   = () => { review.step = review.game?.moves.length || 1; renderReviewStep(); };
const _rvZero = $("#rvZero");
if (_rvZero) _rvZero.onclick = () => setReviewZero();
const _rvZeroOk = $("#rvZeroOk");
if (_rvZeroOk) _rvZeroOk.onclick = () => confirmReviewZero();
const _rvZeroWordInp = $("#rvZeroWord");
if (_rvZeroWordInp) _rvZeroWordInp.onkeydown = (e) => { if (e.key === "Enter") confirmReviewZero(); };
const _rvClearPick = $("#rvClearPick");
if (_rvClearPick) _rvClearPick.onclick = () => clearReviewPick();
const _btnReplay = $("#rvReplay");
if (_btnReplay) _btnReplay.onclick = () => {
  review.replayMode = !review.replayMode;
  _btnReplay.classList.toggle("active", review.replayMode);
  renderReviewStep();
};
const _btnShare = $("#btnShare");
if (_btnShare) _btnShare.onclick = () => {
  if (review.active) shareReviewSnapshot();
  else shareLiveSnapshot();
};
const _btnReview = $("#btnReview");
if (_btnReview) {
  _btnReview.hidden = true;      // masqué tant que la partie n'est pas terminée
  _btnReview.disabled = true;    // grisé : sur mobile le picto reste affiché (CSS !important)
  _btnReview.onclick = () => {
    if (review.active) {
      exitLocalReview();
      return;
    }
    if (!state.history?.length) return;
    // Tant que la partie est en cours (chrono non figé), Revoir est inactif :
    // cliquer ne doit JAMAIS interrompre la partie. (Sur mobile le bouton reste
    // visible dans la barre de pictos malgré `hidden`, d'où ce garde-fou.)
    if (state.chronoFinal == null) return;
    closeEndModal?.();
    enterLocalReview();
  };
}

const _btnSheet = $("#btnSheet");
if (_btnSheet) _btnSheet.onclick = () => {
  if (!state.history?.length && !review.active) {
    alert("Pas encore d'historique pour cette partie.");
    return;
  }
  openSheet();
};
// Bouton "Annoter" (mobile principalement) : toggle l'affichage de la palette
// et l'état actif visuel du bouton.
const _btnAnnotate = $("#btnAnnotate");
if (_btnAnnotate) _btnAnnotate.onclick = () => {
  const active = document.body.classList.toggle("show-annot");
  _btnAnnotate.classList.toggle("active", active);
  if (!active) {
    // Sortie du mode annotation : on désélectionne l'outil
    if (typeof setAnnotTool === "function") setAnnotTool("");
  }
};

// Partage en jeu : état actuel du plateau + chevalet du joueur
async function shareLiveSnapshot() {
  if (!state.dict) return;
  const rack = state.rack.map(t => t.letter).join("");
  const moveNo = state.moveNo;
  const gameName = state.prepared?.name || "Entraînement";
  const blob = await renderSnapshotToBlob(state.board, rack, { moveNo, gameName });
  if (!blob) return;
  await shareBlobOrFallback(blob, `${gameName} — Coup ${moveNo}`, `topissimo-coup-${moveNo}.png`);
}

// Tente le partage natif (Web Share API). Sur HTTPS, ouvre la modale système.
// Sur HTTP (test local), tombe sur un download — pas un comportement souhaité,
// donc on alerte plutôt avec un message clair.
async function shareBlobOrFallback(blob, title, filename) {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `Quel est le top sur ce coup ?` });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;   // l'utilisateur a fermé la modale
    }
  }
  // Pas de Web Share API (HTTP, navigateur ancien, etc.) → on télécharge en dépannage
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}
document.addEventListener("keydown", (e) => {
  if (!review.active) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "ArrowRight") { e.preventDefault(); $("#rvNext").click(); }
  if (e.key === "ArrowLeft")  { e.preventDefault(); $("#rvPrev").click(); }
});

// Vérifie et corrige silencieusement les données d'une partie pré-tirée.
// Principe : chaque coup a un tirage stocké (m.rack). En mode joker, ce tirage
// doit contenir un "?". S'il en est dépourvu, c'est un bug de stockage : on
// remplace le tirage corrompu par sa version correcte (avec le joker restitué).
// Retourne null si tout est bon, sinon un message d'erreur bloquante
// (uniquement si la donnée est irrécupérable).
// Vérification BACKSTAGE du 1er tirage : compare le tirage du 1er coup gardé en
// mémoire (state.prepared) à celui réellement stocké en base. S'ils divergent,
// l'état mémoire est périmé → on recharge silencieusement la page (cap de 3
// tentatives pour éviter toute boucle). Renvoie true si on peut continuer,
// false si un rechargement vient d'être déclenché.
async function healFirstTirage(id) {
  const key = `pgHeal_${id}`;
  try {
    if (!window._sb) await loadSupabaseClient();
    const { data, error } = await window._sb
      .from("prepared_games").select("moves").eq("id", id).single();
    if (error || !data || !Array.isArray(data.moves) || !data.moves.length) return true;
    const dbRack  = data.moves[0]?.rack || "";
    const memRack = state.prepared?.moves?.[0]?.rack || "";
    if (dbRack && memRack && dbRack !== memRack) {
      const attempts = +(sessionStorage.getItem(key) || 0);
      diagLog("FIRST_TIRAGE_HEAL", { id, dbRack, memRack, attempts });
      console.warn(`[healFirstTirage] tirage périmé en mémoire "${memRack}" ≠ base "${dbRack}" — rechargement (tentative ${attempts + 1}).`);
      if (attempts < 3) {
        showFeedback("", "Chargement de la partie…", "");
        try { sessionStorage.setItem(key, String(attempts + 1)); } catch {}
        location.reload();
        return false;
      }
      // Divergence persistante après 3 essais : on réaligne en mémoire sur la
      // base et on continue (mieux vaut le bon tirage qu'une boucle de reload).
      console.error("[healFirstTirage] divergence persistante — réalignement forcé sur la base.");
      if (state.prepared) state.prepared.moves = data.moves;
    }
    try { sessionStorage.removeItem(key); } catch {}
    return true;
  } catch (e) {
    console.error("[healFirstTirage]", e);
    return true;   // ne jamais bloquer le joueur si la vérification échoue
  }
}

function verifyPreparedGame(prepared) {
  if (!prepared) return "Partie non chargée.";
  const moves = prepared.moves;
  if (!Array.isArray(moves) || moves.length === 0) return "Aucun coup trouvé dans la partie.";

  // En mode joker : simuler l'état des jetons (règle FFSC 3.8.1) pour savoir
  // à quel coup un joker est attendu dans le tirage.
  //  • spareJokers décrémente UNIQUEMENT quand le top a un blank non remplacé
  //    (top.blanks non vide) = joker posé définitivement sur la grille.
  //  • Quand le joker est utilisé ET remplacé (top.blanks vide), il est recyclé
  //    → spareJokers inchangé, joker disponible au coup suivant.
  //  • Quand le top ne l'utilise pas, il reste dans le chevalet (carry-over).
  // Cela évite d'ajouter un "?" à des tirages légitimement sans joker
  // (les 2 jetons épuisés, lettre manquante dans le sac).
  let spareJokers = prepared.withJoker ? 2 : 0;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const rack = m?.rack || "";
    if (!rack) return `Coup ${i + 1} : chevalet absent.`;
    if (!m.top || !m.top.word) return `Coup ${i + 1} : top manquant.`;

    if (prepared.withJoker) {
      const jokerShouldBeInRack = spareJokers > 0;
      if (jokerShouldBeInRack && !rack.includes("?")) {
        // PRINCIPE : une partie tournoi s'affiche À L'IDENTIQUE du stocké.
        // On NE MUTE PLUS le tirage (l'ancienne ligne `m.rack = rack + "?"`
        // inventait un jeton et corrompait l'affichage — cause du bug
        // « tirage du 1er coup pas le bon »). On signale seulement dans le
        // diagnostic : si la donnée stockée est réellement fautive, on veut
        // le SAVOIR, pas le masquer.
        diagLog("STORED_JOKER_MISSING", { move: i + 1, rack, spareJokers });
        console.warn(`[verifyPreparedGame] coup ${i + 1} : joker attendu absent du tirage stocké "${rack}" (NON corrigé, voir diagnostic)`);
      }
      // top.blanks non vide = joker posé définitivement (remplacement impossible)
      // → spareJokers--. top.blanks vide = joker recyclé ou non utilisé → inchangé.
      if ((m.top.blanks || []).length > 0 && spareJokers > 0) {
        spareJokers--;
      }
    }
  }
  return null;
}

async function loadPreparedGame(id) {
  // Charger Supabase si nécessaire
  if (!window.supabase || !window.SUPABASE_URL) {
    await loadSupabaseClient();
  }
  const { data, error } = await window._sb.from("prepared_games").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  // Réinitialisation COMPLÈTE de l'état de jeu : évite qu'un reliquat d'une partie
  // précédente (plateau, tirage, index) ne déborde si l'état n'a pas été remis à zéro
  // (cache navigateur / réentrée). C'est la cause du « 1er tirage erroné » corrigé au refresh.
  state.board = emptyBoard();
  state.rack = [];
  state.pending = [];
  state.cursor = null;
  state.history = [];
  state.preparedIdx = 0;
  state.moveNo = 1;
  state.totalScore = 0;
  state.sumNeg = 0;
  state.topMove = null;
  state.subTop = null;
  state.snakeEnds = null;
  state.bestAttempt = null;
  state._dual = null;
  state._topPending = false;
  state.chronoFinal = null;
  state.prepared = {
    id: data.id,
    name: data.name,
    mode: data.mode,
    withJoker: data.with_joker,
    timePerMove: data.time_per_move,
    moves: data.moves,
  };
  // Grille random : disposition des bonus stockée sur le 1er coup.
  state.boardLayout = data.moves?.[0]?._layout || null;
  // Diagnostic : tracer la partie chargée et le nombre de coups stockés.
  diag.preparedId = data.id;
  diag.mode = data.mode;
  diag.withJoker = !!data.with_joker;
  diagLog("prepared_loaded", {
    id: data.id,
    name: data.name,
    mode: data.mode,
    withJoker: !!data.with_joker,
    nbMoves: Array.isArray(data.moves) ? data.moves.length : 0,
    firstRack: data.moves?.[0]?.rack ?? null,
  });
  // Appliquer le mode/paramètres de la partie pré-tirée (override des settings)
  state.settings.gameMode = data.mode;
  state.settings.withJoker = data.with_joker;
  state.settings.timePerMove = data.time_per_move;
  // Re-init du sac/jokers (initGame n'avait pas encore connaissance du mode pré-tiré)
  state.bag = { ...LETTER_BAG };
  if (state.settings.withJoker) {
    state.spareJokers = state.bag["?"] || 0;
    state.bag["?"] = 0;
  } else {
    state.spareJokers = 0;
  }
  renderGameTitle();
  updateTournamentNavButtons();
  loadTournamentSiblings();   // détermine l'id de la partie suivante (async, non bloquant)
}

async function loadSupabaseClient() {
  // Charger la config (deux dossiers plus haut)
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "../config.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("config.js introuvable"));
    document.head.appendChild(s);
  });
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Impossible de charger Supabase JS"));
    document.head.appendChild(s);
  });
  window._sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

function startGame() {
  if (state.started) return;   // déjà lancée (anti double-clic pendant l'attente)
  // GARDE-FOU AVANT LANCEMENT : on ne démarre pas tant que
  //   • la partie pré-tirée n'est pas chargée (sinon tirage aléatoire par erreur) ;
  //   • OU le dictionnaire n'est pas chargé (sinon le top n'est pas calculé et un
  //     mot correct — voire le top — serait compté comme raté).
  // Dans ces deux cas on affiche « Chargement de la partie… » et on relance
  // AUTOMATIQUEMENT dès que tout est prêt.
  if ((PREPARED_ID && !state.prepared) || !state.dict) {
    showFeedback("", "Chargement de la partie…", "Un instant, la partie se prépare.");
    const waitReady = () => {
      if (state.started) return;
      if ((!PREPARED_ID || state.prepared) && state.dict) { startGame(); }
      else setTimeout(waitReady, 80);
    };
    setTimeout(waitReady, 80);
    return;
  }
  state.started = true;
  state.bestAttempt = null;
  diagLog("game_started", {
    prepared: !!state.prepared,
    isPuzzle: !!state.isPuzzle,
    mode: state.settings.gameMode,
    withJoker: !!state.settings.withJoker,
  });
  hideFeedback();
  $("#feedback").innerHTML = "";    // vide aussi le contenu (même si caché)
  $("#actionRowPreStart").hidden = true;
  $("#actionRowInGame").hidden = false;
  const isTraining = !state.prepared && !state.isPuzzle;
  // Pause disponible en entraînement ET en tournoi (pas en puzzle, partie unique).
  $("#btnPause").hidden = state.isPuzzle;
  // Annot toolbar : masquée par défaut, visible uniquement via le bouton ✏️ Annoter
  if (isTraining) clearSavedTraining();
  // Bouton Revoir : masqué pendant la partie (tout mode), visible seulement en fin
  if (_btnReview) { _btnReview.hidden = true; _btnReview.disabled = true; _btnReview.classList.remove("active"); }
  updateGiveUpLabel();
  updateTournamentNavButtons();
  startChrono();
  nextMove();
}

// ===== Pause + persistance (uniquement entraînement) =====
const TRAINING_STORAGE_KEY = "trainingPaused";
state.paused = false;
state._pauseInfo = null;

function saveTrainingState() {
  if (state.isPuzzle) return;   // puzzles non persistés ; entraînement ET tournoi le sont
  try {
    const snapshot = {
      playerId: +(localStorage.getItem("currentPlayerId") || 0),
      bag: state.bag,
      board: state.board,
      rack: state.rack.map(t => ({ letter: t.letter, isBlank: !!t.isBlank })),
      moveNo: state.moveNo,
      totalScore: state.totalScore,
      sumNeg: state.sumNeg,
      spareJokers: state.spareJokers,
      history: state.history,
      lastPlaced: state.lastPlaced || [],
      bestAttempt: state.bestAttempt,
      settings: state.settings,
      chronoElapsed: state._pauseInfo?.elapsed ?? elapsedSeconds(),
      chronoPenalty: state.chronoPenalty,
      moveTimeLeft: state._pauseInfo?.moveTimeLeft ?? state.moveTimeLeft,
      // Contexte tournoi (partie pré-tirée) : pour restaurer au bon coup à la reprise.
      isPrepared: !!state.prepared,
      preparedId: state.prepared ? state.prepared.id : null,
      preparedIdx: state.preparedIdx,
      tid: TOURNAMENT_ID || null,
      savedAt: Date.now(),
    };
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) { console.error("Save training state failed:", e); }
}

function clearSavedTraining() {
  localStorage.removeItem(TRAINING_STORAGE_KEY);
}

function restorePausedTraining() {
  const raw = localStorage.getItem(TRAINING_STORAGE_KEY);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    // Snapshot d'une partie de TOURNOI → pas ici (restauré par restorePausedPrepared
    // sur la page de la partie pré-tirée). On ne le supprime pas.
    if (s.isPrepared) return false;
    // Ne pas restaurer une partie appartenant à un autre joueur
    const currentPid = +(localStorage.getItem("currentPlayerId") || 0);
    if (s.playerId && currentPid && s.playerId !== currentPid) {
      localStorage.removeItem(TRAINING_STORAGE_KEY);
      return false;
    }
    state.bag = s.bag;
    state.board = s.board;
    state.rack = (s.rack || []).map(t => ({ letter: t.letter, used: false, id: nextTileId() }));
    state.moveNo = s.moveNo;
    state.totalScore = s.totalScore;
    state.sumNeg = s.sumNeg;
    state.spareJokers = s.spareJokers || 0;
    state.history = s.history || [];
    state.lastPlaced = s.lastPlaced || [];
    state.lastTopCells = s.lastTopCells || [];
    state.bestAttempt = s.bestAttempt || null;
    Object.assign(state.settings, s.settings || {});
    state.chronoPenalty = s.chronoPenalty || 0;
    state.started = true;
    state.paused = true;
    state._pauseInfo = { elapsed: s.chronoElapsed || 0, moveTimeLeft: s.moveTimeLeft || 0 };
    state.chronoFinal = null;
    // UI
    $("#actionRowPreStart").hidden = true;
    $("#actionRowInGame").hidden = false;
    $("#btnPause").hidden = false;
    renderInfo();
    renderRack();
    renderBoard();
    renderGameTitle();
    computeTop();
    // Modale de pause active dès l'arrivée
    $("#pauseModal").hidden = false;
    return true;
  } catch (e) {
    console.error("Restore failed:", e);
    clearSavedTraining();
    return false;
  }
}

// Restaure une partie de TOURNOI mise en pause (après rechargement / retour d'une
// autre appli). Ne restaure que si le snapshot correspond à CETTE partie pré-tirée.
function restorePausedPrepared(preparedId) {
  const raw = localStorage.getItem(TRAINING_STORAGE_KEY);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    if (!s.isPrepared || String(s.preparedId) !== String(preparedId)) return false;
    const currentPid = +(localStorage.getItem("currentPlayerId") || 0);
    if (s.playerId && currentPid && s.playerId !== currentPid) return false;
    state.bag = s.bag;
    state.board = s.board;
    state.rack = (s.rack || []).map(t => ({ letter: t.letter, isBlank: !!t.isBlank, used: false, id: nextTileId() }));
    state.moveNo = s.moveNo;
    state.preparedIdx = s.preparedIdx || 0;
    state.totalScore = s.totalScore;
    state.sumNeg = s.sumNeg;
    state.spareJokers = s.spareJokers || 0;
    state.history = s.history || [];
    state.lastPlaced = s.lastPlaced || [];
    state.bestAttempt = s.bestAttempt || null;
    state.chronoPenalty = s.chronoPenalty || 0;
    state.started = true;
    state.paused = true;
    state._pauseInfo = { elapsed: s.chronoElapsed || 0, moveTimeLeft: s.moveTimeLeft || 0 };
    state.chronoFinal = null;
    $("#actionRowPreStart").hidden = true;
    $("#actionRowInGame").hidden = false;
    $("#btnPause").hidden = false;
    renderInfo(); renderRack(); renderBoard(); renderGameTitle();
    if (!computeTop()) state._topPending = true;   // dico pas encore prêt → recalcul différé
    $("#pauseModal").hidden = false;
    return true;
  } catch (e) {
    console.error("Restore prepared failed:", e);
    return false;
  }
}

function pauseGame({ showModal = true } = {}) {
  // Pause autorisée en entraînement ET en tournoi (pas en puzzle). L'état est
  // persisté (saveTrainingState) → au rechargement / retour d'une autre appli,
  // on se retrouve au coup exact (restorePausedTraining / restorePausedPrepared).
  if (!state.started || state.chronoFinal != null || state.isPuzzle) return;
  if (state.paused) {
    if (showModal) $("#pauseModal").hidden = false;
    return;
  }
  state.paused = true;
  state._pauseInfo = {
    elapsed: elapsedSeconds(),
    moveTimeLeft: state.moveTimeLeft,
  };
  if (chronoTimer) { clearInterval(chronoTimer); chronoTimer = null; }
  if (moveTimer)   { clearInterval(moveTimer);   moveTimer = null; }
  saveTrainingState();
  if (showModal) $("#pauseModal").hidden = false;
}
function resumeGame() {
  if (!state.paused) { $("#pauseModal").hidden = true; return; }
  state.paused = false;
  // Repartir le chrono à partir de l'élapsed acquis
  state.chronoStart = Date.now() - (state._pauseInfo.elapsed - state.chronoPenalty) * 1000;
  if (chronoTimer) clearInterval(chronoTimer);
  chronoTimer = setInterval(renderChrono, 1000);
  // Reprendre le minuteur de coup si actif
  if (state.settings.timePerMove > 0 && state._pauseInfo.moveTimeLeft > 0) {
    state.moveTimeLeft = state._pauseInfo.moveTimeLeft;
    if (moveTimer) clearInterval(moveTimer);
    moveTimer = setInterval(() => {
      state.moveTimeLeft--;
      renderMoveTimer();
      if (state.moveTimeLeft <= 0) {
        clearInterval(moveTimer);
        timeoutAdvance();
      }
    }, 1000);
  }
  state._pauseInfo = null;
  $("#pauseModal").hidden = true;
  clearSavedTraining();
}

// Anti-rechargement en TOURNOI : une partie pré-tirée en cours n'est pas
// sauvegardée (contrairement à l'entraînement) → un rafraîchissement la perdrait.
// On avertit donc avant de quitter/recharger tant qu'elle n'est pas terminée.
// (Pour faire une pause, utiliser le bouton Pause plutôt que recharger.)
window.addEventListener("beforeunload", (e) => {
  if (state.prepared && state.started && state.chronoFinal == null) {
    e.preventDefault();
    e.returnValue = "";   // déclenche la confirmation native du navigateur
    return "";
  }
});

// Bloque les raccourcis de RAFRAÎCHISSEMENT (F5, Ctrl+R, Cmd+R) tant qu'une
// partie de TOURNOI est en cours : non sauvegardée, un refresh la relancerait
// au 1er coup. (Le beforeunload reste le filet pour le bouton recharger natif ;
// certains navigateurs réservent Cmd+R et l'ignoreront — best effort.)
window.addEventListener("keydown", (e) => {
  const inTournamentGame = state.prepared && state.started && state.chronoFinal == null && !review.active;
  if (!inTournamentGame) return;
  const isReload = e.key === "F5" || ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"));
  if (isReload) {
    e.preventDefault();
    flashFeedback("info", "Rafraîchissement bloqué", "Impossible de recharger pendant une partie de tournoi (utilise Pause).");
  }
}, { capture: true });

// Restauration depuis le cache navigateur (bfcache, retour arrière) : le JS garde
// son ancien état (mauvaise partie / tirage périmé). On force un rechargement propre.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) window.location.reload();
});

// Garde-fou contre le swipe de bord d'écran (geste « retour » sur mobile) qui
// ferait quitter la partie prématurément. On empile un état sentinelle : tant
// qu'une partie est en cours, tout « retour » (swipe inclus) est intercepté, on
// ré-empile et on demande confirmation avant de réellement quitter.
let _allowBack = false;
const _gameInProgress = () => state.started && state.chronoFinal == null && !review.active;
history.pushState({ topissimo: true }, "");
window.addEventListener("popstate", () => {
  if (_allowBack || !_gameInProgress()) return;   // on laisse passer
  history.pushState({ topissimo: true }, "");      // annule le retour
  if (confirm("Quitter la partie en cours ? Elle ne sera pas enregistrée.")) {
    _allowBack = true;
    history.go(-2);
  }
});

function endGame() {
  console.log(`[endGame] ${BUILD_VERSION} — reconstruction plateau depuis ${state.history?.length || 0} coups d'historique`);
  stopChrono();
  stopMoveTimer();
  clearSavedTraining();
  hideFeedback();
  // GARANTIE D'AFFICHAGE DU DERNIER COUP : quel que soit le chemin qui a mené
  // ici (validation, timeout, abandon, fin de partition), on reconstruit l'état
  // final à partir des TOPS de l'historique — source de vérité (la feuille de
  // route les contient toujours) :
  //   • plateau   = tous les tops appliqués ;
  //   • surbrillance = cases du DERNIER top (préférence highlightTop) ;
  //   • rack      = reliquat du dernier coup (rack moins lettres consommées).
  // On annule le minuteur de surbrillance pour qu'elle persiste sur l'écran final.
  if (topWordTimer) { clearTimeout(topWordTimer); topWordTimer = null; }
  // EXCEPTION mode puzzle : l'historique ne contient QUE le coup du puzzle, alors
  // que le plateau (state.board) contient déjà tout le contexte des coups
  // précédents + le top posé. Reconstruire depuis l'historique effacerait ce
  // contexte → on saute la reconstruction (le plateau est déjà correct).
  if (!state.isPuzzle && Array.isArray(state.history) && state.history.length) {
    const playedTops = state.history.filter(h => h?.top?.word);
    let board = emptyBoard();
    let lastNewCells = [], lastAllCells = [], lastReliquat = null;
    for (let k = 0; k < playedTops.length; k++) {
      const top = playedTops[k].top;
      if (k === playedTops.length - 1) {
        // Dernier coup : repérer les cases nouvellement posées + le reliquat.
        const { word, row, col, dir, blanks = [] } = top;
        const dr = dir === "V" ? 1 : 0, dc = dir === "H" ? 1 : 0;
        const used = [];
        for (let i = 0; i < word.length; i++) {
          const r = row + i * dr, c = col + i * dc;
          lastAllCells.push({ row: r, col: c });
          if (!board[r][c]) {
            lastNewCells.push({ row: r, col: c });
            used.push(blanks.includes(i) ? "?" : word[i]);
          }
        }
        const rackArr = (playedTops[k].rack || "").split("");
        for (const u of used) {
          let idx = rackArr.indexOf(u);
          if (idx === -1) idx = rackArr.indexOf("?"); // joker ayant servi de lettre
          if (idx !== -1) rackArr.splice(idx, 1);
        }
        lastReliquat = rackArr;
      }
      board = applyMove(board, top);
    }
    state.board = board;
    state.lastPlaced = lastNewCells;
    state.lastTopCells = lastAllCells;
    if (lastReliquat) {
      state.rack = lastReliquat.map(L => ({ letter: L, used: false, id: nextTileId() }));
    }
    renderBoard();
    renderRack();
    renderBag();   // recalcul du sac avec le chevalet réduit au reliquat (évite le -1)
  }
  const time = fmtChrono(state.chronoFinal);
  $("#endSummary").innerHTML = `
    <div>Score total : <strong>${state.totalScore}</strong> pts</div>
    <div>Négatif : <strong>${state.sumNeg}</strong></div>
    <div>Temps : <strong>${time}</strong>${state.chronoPenalty ? ` (dont ${state.chronoPenalty}s de pénalités)` : ""}</div>`;
  $("#endModal").hidden = false;
  // Rendre le bouton Revoir accessible (partie terminée)
  if (_btnReview) { _btnReview.hidden = false; _btnReview.disabled = false; _btnReview.classList.remove("active"); }
  updateTournamentNavButtons();
  // Pas de sauvegarde en mode puzzle (rejouer d'un solo)
  if (state.isPuzzle) return;
  // Si c'est une partie pré-tirée → sauvegarder le résultat
  if (state.prepared) saveResultIfPrepared().catch(e => console.error("Sauvegarde KO:", e));
  // Si c'est un entraînement → sauvegarder l'historique perso
  else saveTrainingGame().catch(e => console.error("Sauvegarde entraînement KO:", e));
}

async function saveTrainingGame() {
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  if (!pid) return;
  if (!window._sb) await loadSupabaseClient();
  const totalTime = state.chronoFinal != null ? state.chronoFinal : elapsedSeconds();
  // Si la partie a été abandonnée, on marque le 1er coup avec abandonedGame:true
  // → permettra de filtrer la partie des "meilleurs temps" côté stats.
  let historyToSave = state.history;
  if (state.abandoned && historyToSave?.length) {
    historyToSave = [{ ...historyToSave[0], abandonedGame: true }, ...historyToSave.slice(1)];
  }
  const { error } = await window._sb.from("training_games").insert({
    player_id: pid,
    mode: state.settings.gameMode,
    with_joker: state.settings.withJoker,
    time_per_move: state.settings.timePerMove,
    total_score: state.totalScore,
    sum_neg: state.sumNeg,
    total_time_seconds: totalTime,
    history: historyToSave,
  });
  if (error) { console.error("Sauvegarde training_games:", error.message); return; }
  // Rétention 30 max par joueur
  const { data: ids } = await window._sb.from("training_games")
    .select("id").eq("player_id", pid)
    .order("created_at", { ascending: false }).range(30, 999);
  if (ids?.length) {
    await window._sb.from("training_games").delete().in("id", ids.map(x => x.id));
  }
}
window.closeEndModal = () => $("#endModal").hidden = true;

function exitLocalReview() {
  review.active = false;
  review.replayMode = false;
  document.body.classList.remove("in-review");
  review.game = null;
  review.result = null;
  review.historyByMove = {};
  $("#reviewPanel").hidden = true;
  document.querySelector(".info-bar")?.style.removeProperty("display");
  // Remettre le plateau dans l'état de fin de partie
  const moves = state.history || [];
  let board = emptyBoard();
  for (const h of moves) board = applyMove(board, h.top);
  state.board = board;
  state.lastPlaced = [];
  state.lastTopCells = [];
  state.rack = [];
  renderBoard();
  renderRack();
  renderGameTitle();
  // Remettre le feedback de fin de partie
  showFeedback("success", "Partie terminée",
    `Score : <strong>${state.totalScore}</strong> · Négatif : <strong>${state.sumNeg}</strong>`);
  // Sync bouton
  if (_btnReview) { _btnReview.classList.remove("active"); }
}

// Mode review à partir de l'historique en mémoire (fin de partie entraînement OU pré-tirée)
window.enterLocalReview = function() {
  if (!state.history.length) { alert("Pas d'historique."); return; }
  // Construire un objet "game" équivalent à ce que renvoie Supabase
  const fakeGame = {
    id: 0,
    name: state.prepared ? state.prepared.name : "Entraînement",
    mode: state.settings.gameMode,
    with_joker: state.settings.withJoker,
    time_per_move: state.settings.timePerMove,
    moves: state.history
      .filter(h => h.top)
      .map(h => ({
        moveNo: h.moveNo,
        rack: h.rack,
        top: {
          word: h.top.word,
          row: h.top.row, col: h.top.col, dir: h.top.dir,
          blanks: h.top.blanks || [],
          score: h.top.score,
          words: h.top.words || [],
        },
      })),
  };
  const fakeResult = {
    total_score: state.totalScore,
    sum_neg: state.sumNeg,
    total_time_seconds: state.chronoFinal || elapsedSeconds(),
    details: state.history,
  };
  review.active = true;
  document.body.classList.add("in-review");
  $("#bagDisplay") && ($("#bagDisplay").hidden = true);   // pas de sac en review
  review.game = fakeGame;
  review.result = fakeResult;
  review.historyByMove = {};
  for (const h of state.history) review.historyByMove[h.moveNo] = h;
  review.step = 1;
  review.replayMode = false;
  state.started = false;
  document.querySelector(".info-bar")?.style.setProperty("display", "none");
  $("#reviewPanel").hidden = false;
  // Activer le bouton Revoir
  if (_btnReview) { _btnReview.hidden = false; _btnReview.disabled = false; _btnReview.classList.add("active"); }
  // (layout déjà en 2 colonnes — rien à faire)
  renderGameTitle();
  showFeedback("success", `📺 Parcours de « ${fakeGame.name} »`,
    `Ton score : <strong>${fakeResult.total_score}</strong> · Négatif : <strong>${fakeResult.sum_neg}</strong> · Temps : <strong>${fmtChrono(fakeResult.total_time_seconds)}</strong>`);
  renderReviewStep();
};

// Détecte si la partie est jouée sur un appareil mobile/tactile (pour marquer
// le résultat d'un picto 📱 dans le classement). Critère : pointeur grossier
// (tactile) ou user-agent mobile.
function wasPlayedOnMobile() {
  try {
    return (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 1) ||
           /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  } catch { return false; }
}

async function saveResultIfPrepared() {
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  if (!pid) { console.log("Pas de joueur sélectionné — résultat non sauvegardé"); return; }
  if (!window._sb) await loadSupabaseClient();
  const totalTime = state.chronoFinal != null ? state.chronoFinal : elapsedSeconds();

  // 1) Sauvegarder dans prepared_game_results (pour la fonction "Revoir")
  // On marque la partie comme abandonnée si applicable (filtré des stats meilleurs temps).
  let detailsToSave = state.history;
  if (state.abandoned && detailsToSave?.length) {
    detailsToSave = [{ ...detailsToSave[0], abandonedGame: true }, ...detailsToSave.slice(1)];
  }
  // Diagnostic : snapshot final du journal (résumé + événements anormaux).
  diagLog("game_saved", { totalScore: state.totalScore, sumNeg: state.sumNeg, totalTime });
  const anomalies = diag.events.filter(e =>
    ["SW_VERSION_MISMATCH", "RACK_DIVERGENCE", "ILLEGAL_DRAW_IN_PREPARED", "STORED_JOKER_MISSING"].includes(e.event));
  const diagnostics = {
    build: diag.build,
    swCache: diag.swCache,
    swScriptURL: diag.swScriptURL,
    ua: diag.ua,
    mode: diag.mode,
    withJoker: diag.withJoker,
    preparedId: diag.preparedId,
    hasAnomalies: anomalies.length > 0,
    anomalies,
    events: diag.events,
  };

  const { error: e1 } = await window._sb.from("prepared_game_results").upsert({
    prepared_game_id: state.prepared.id,
    player_id: pid,
    total_score: state.totalScore,
    sum_neg: state.sumNeg,
    total_time_seconds: totalTime,
    details: detailsToSave,
    played_on_mobile: wasPlayedOnMobile(),
    diagnostics,
  }, { onConflict: "prepared_game_id,player_id" });
  if (e1) { console.error("Erreur sauvegarde prepared_game_results:", e1.message); return; }

  // 2) Mirroir dans games + results pour que ça remonte dans le classement championnat
  await syncPreparedToChampionship(pid, totalTime);
}

// Crée (si besoin) un games row pour la partie pré-tirée + insère/upsert le résultat du joueur
async function syncPreparedToChampionship(pid, totalTime) {
  const preparedId = state.prepared.id;
  // session_no = 1000+id pour ne pas entrer en collision avec les saisies manuelles
  const sessionNo = 1000 + preparedId;

  // Récupérer ou créer le games row
  let gameId;
  const { data: existing } = await window._sb.from("games").select("id")
    .eq("session_no", sessionNo).eq("game_no", 1).maybeSingle();
  if (existing) {
    gameId = existing.id;
  } else {
    // Charger les métadonnées de la partie pré-tirée (top, date)
    const { data: prep, error: pe } = await window._sb.from("prepared_games")
      .select("total_top_score, name, created_at").eq("id", preparedId).single();
    if (pe) { console.error("Lecture prepared_games:", pe.message); return; }
    const playedOn = (prep.created_at || new Date().toISOString()).slice(0, 10);
    const { data: created, error: ge } = await window._sb.from("games").insert({
      played_on: playedOn,
      session_no: sessionNo,
      game_no: 1,
      top_score: prep.total_top_score,
      notes: `Partie pré-tirée: ${prep.name}`,
    }).select("id").single();
    if (ge) { console.error("Création games:", ge.message); return; }
    gameId = created.id;
  }

  // Coups "ratés" = coups où on a abandonné ou laissé filer le temps
  const missed = state.history.filter(h => h.status === "giveup" || h.status === "timeout").length;

  const { error: re } = await window._sb.from("results").upsert({
    game_id: gameId,
    player_id: pid,
    score: state.totalScore,
    time_seconds: totalTime,
    missed_moves: missed,
  }, { onConflict: "game_id,player_id" });
  if (re) console.error("Sauvegarde results:", re.message);
}

// Affichage du tirage sur la feuille de route :
//   - reliquat présent      → "AGI+RTYU" (reliquat + lettres piochées)
//   - tirage complet neuf    → "–AEGRTUY"
//   - ancien format (sans flag) → tirage brut
function rackDisplay(h) {
  const rack = h.rack || "";
  if (h.kept) {
    const rest = rack.split("");
    for (const ch of h.kept) { const i = rest.indexOf(ch); if (i >= 0) rest.splice(i, 1); }
    // Aucune lettre piochée (fin de partie, sac vide) → on affiche le rack tel quel.
    return rest.length ? `${h.kept}+${rest.join("")}` : rack;
  }
  if (h.freshRack) return "–" + rack;
  return rack;
}

window.openSheet = () => {
  const clickable = review.active;   // permettre le saut à un coup en mode review
  // En mode duplicate, le statut (top/abandon/temps) et le temps par coup n'ont
  // pas de sens (on attend toujours la fin du chrono) → colonnes masquées.
  const dup = playMode() === "duplicate";
  const rows = state.history.map((h, i) => {
    const time = h.timeMs ? (h.timeMs / 1000).toFixed(2) + "s" : "—";
    // Surbrillance des coups ratés : top non trouvé (négatif < 0) OU abandon / temps écoulé.
    const isMiss = (h.neg || 0) < 0 || h.status === "giveup" || h.status === "timeout";
    const rowClass = isMiss ? "sheet-miss" : "";
    // Icônes distinctes : timeout = ⏱ chrono · giveup (voir le coup / abandon) = 🏳️ drapeau blanc
    const statusIcon = { top: "🏆", giveup: "🏳️", timeout: "⏱" }[h.status] || "";
    const statusLabel = { top: "top", giveup: "abandon", timeout: "temps écoulé" }[h.status] || h.status;
    const coord = pos => `<span style="font-size:.75em;color:#888;vertical-align:.1em">${pos}</span>`;
    let topCell, playedCell;
    if (h.subTop || h.dual) {
      // Top/sous-top : on affiche le top ET le sous-top (officiels), et en face le
      // top et le sous-top trouvés par le joueur.
      const d = h.dual || {};
      topCell = h.top ? `<strong>${wLink(h.top.word)}</strong> ${coord(h.top.pos)} ${h.top.score}` : "—";
      if (h.subTop) topCell += `<br><span class="muted">ss-top ${wLink(h.subTop.word)} ${coord(h.subTop.pos)} ${h.subTop.score}</span>`;
      const tw = d.topWord ? `<strong>${wLink(d.topWord)}</strong> ${d.topPts || 0}` : "<em>—</em>";
      playedCell = tw;
      if (h.subTop) playedCell += `<br><span class="muted">${d.subWord ? `${wLink(d.subWord)} ${d.subPts || 0}` : "—"}</span>`;
    } else {
      topCell = h.top
        ? `<strong>${wLink(h.top.word)}</strong> ${coord(h.top.pos)} ${h.top.score} pts`
        : "—";
      playedCell = h.played
        ? `<strong>${wLink(h.played)}</strong>${h.playedPos ? " " + coord(h.playedPos) : ""} ${h.playerScore} pts`
        : `<em>—</em>`;
    }
    const onclick = clickable ? `onclick="jumpToReviewMove(${h.moveNo})" style="cursor:pointer"` : "";
    return `<tr class="${rowClass}" ${onclick}>
      <td>${h.moveNo}</td>
      <td style="padding-right:26px"><code>${rackDisplay(h)}</code></td>
      <td style="padding-right:26px">${topCell}</td>
      <td>${playedCell}</td>
      <td style="text-align:center;padding:6px 4px" class="${h.neg < 0 ? 'neg' : ''}">${h.neg < 0 ? h.neg : ''}</td>
      ${dup ? "" : `<td>${statusIcon} <span style="color:#888;font-size:.85em">${statusLabel}</span></td>
      <td style="text-align:right">${time}</td>`}
    </tr>`;
  }).join("");

  $("#sheetBody").innerHTML = `
    <div style="margin-bottom:10px;font-size:.9rem;color:#5a6a73">
      Score : <strong>${state.totalScore}</strong> · Négatif : <strong>${state.sumNeg}</strong>
      · Temps total : <strong>${fmtChrono(state.chronoFinal ?? elapsedSeconds())}</strong>
    </div>
    <div class="sheet-scroll" style="overflow:auto">
    <table style="width:100%;border-collapse:collapse;font-size:.9rem;white-space:nowrap">
      <thead><tr style="background:var(--petrol);color:#fff;position:sticky;top:0">
        <th style="padding:6px 8px;text-align:left">#</th>
        <th style="padding:6px 26px 6px 8px;text-align:left">Tirage</th>
        <th style="padding:6px 26px 6px 8px;text-align:left">Top</th>
        <th style="padding:6px 8px;text-align:left">Joué</th>
        <th style="padding:6px 4px;text-align:center">Nég.</th>
        ${dup ? "" : `<th style="padding:6px 8px;text-align:left">Statut</th>
        <th style="padding:6px 8px;text-align:right">Temps</th>`}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
  $("#sheet").hidden = false;
};
window.closeSheet = () => {
  closeSheetDict();
  $("#sheet").hidden = true;
};

window.jumpToReviewMove = (moveNo) => {
  if (!review.active || !review.game) return;
  // Trouver l'index du coup dans review.game.moves (moveNo peut ne pas correspondre à idx+1
  // si certains coups manquent — sécurité par recherche)
  let idx = review.game.moves.findIndex(m => m.moveNo === moveNo);
  if (idx < 0) idx = moveNo - 1;
  review.step = Math.max(1, Math.min(review.game.moves.length, idx + 1));
  closeSheet();
  renderReviewStep();
};

document.addEventListener("keydown", handleKey);

// --- Raccourcis supplémentaires ---

// Touche F8 : Pause / Reprendre. (Auparavant Shift seul, mais ça créait un conflit
// avec les touches 1 et 2 quand on maintenait Maj → abandonné.)
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "F8") {
    e.preventDefault();
    // Partie démarrée non terminée (entraînement ou tournoi, pas puzzle)
    if (state.started && !state.isPuzzle && state.chronoFinal == null) {
      if (state.paused) resumeGame(); else pauseGame();
    }
  }
});

// Ctrl+N (ou Cmd+N) : nouvelle partie (avec confirmation)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "n" || e.key === "N")) {
    e.preventDefault();
    if (confirm("Démarrer une nouvelle partie ? La partie en cours sera perdue.")) {
      restartGame();
    }
  }
});

// Ctrl+F (ou Cmd+F) : ouvrir la feuille de route
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    const btn = document.getElementById("btnSheet");
    if (btn) btn.click();
  }
});

// Ctrl+P (ou Cmd+P) : partager la capture
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P")) {
    e.preventDefault();
    const btn = document.getElementById("btnShare");
    if (btn) btn.click();
  }
});
$$(".annot-btn[data-tool]").forEach(b => {
  b.onclick = () => setAnnotTool(b.dataset.tool || "");
});
$("#btnStart").onclick = startGame;
$("#btnGiveUp").onclick = revealTop;
$("#btnPause").onclick = pauseGame;
$("#btnResume").onclick = resumeGame;
// Intercepter le clic sur Accueil : en entraînement actif, on met en pause au lieu
// de quitter directement. Le joueur peut alors choisir Reprendre ou Quitter.
// Intercepte le lien Accueil du header : pause silencieuse + nav
const headerAccueilLink = document.querySelector('.title-row a[href="../index.html"], header a[href="../index.html"]');
if (headerAccueilLink) {
  headerAccueilLink.addEventListener("click", (e) => {
    const isTraining = state.started && state.chronoFinal == null && !state.prepared && !state.isPuzzle;
    if (isTraining && !state.paused) {
      e.preventDefault();
      pauseGame({ showModal: false });   // pause + sauvegarde, sans modale
      setTimeout(() => { window.location.href = headerAccueilLink.href; }, 50);
    }
  }, { capture: true });
}

// ── Navigation tournoi ──────────────────────────────────────────────────────
window.goBackToTournament = function(withWarning = false) {
  if (withWarning) {
    if (!confirm("Retourner au tournoi ? La partie en cours sera abandonnée et ton score sera 0.")) return;
  }
  const tid = state._soloTid || TOURNAMENT_ID;
  window.location.href = tid
    ? `../index.html#tid=${tid}`
    : "../index.html#tab=prepared";
};

// Bouton « ☰ Raccourcis » (mobile) : afficher/cacher les pictos d'action.
const _btnShortcuts = $("#btnShortcuts");
if (_btnShortcuts) {
  _btnShortcuts.onclick = () => {
    const open = document.body.classList.toggle("pictos-open");
    _btnShortcuts.classList.toggle("active", open);
  };
}

const _btnBackToTournament = $("#btnBackToTournament");
if (_btnBackToTournament) {
  _btnBackToTournament.onclick = () => {
    // Confirmation d'abandon seulement pour une vraie partie de tournoi en cours
    // (pas pour un solo / puzzle, non compté).
    const gameInProgress = state.prepared && state.started && state.chronoFinal == null && !state.isPuzzle;
    goBackToTournament(gameInProgress);
  };
}

// « Partie suivante » : entre DIRECTEMENT dans la partie suivante du tournoi
// (à son départ), sans repasser par le menu de sélection. Grisé s'il n'y en a plus.
window.goToNextGame = function() {
  if (!state._nextGameId) return;
  const tid = TOURNAMENT_ID ? `&tid=${encodeURIComponent(TOURNAMENT_ID)}` : "";
  window.location.href = `game.html?prepared=${encodeURIComponent(state._nextGameId)}${tid}`;
};

// Détermine l'id de la partie suivante du tournoi (ordre naturel du nom, comme la
// liste de l'accueil : « Partie 2 » < « Partie 10 »). On saute les parties DÉJÀ
// JOUÉES par le joueur courant : « Partie suivante » mène toujours à une partie
// non encore jouée. null s'il n'en reste plus.
async function loadTournamentSiblings() {
  state._nextGameId = null;
  if (!TOURNAMENT_ID || !state.prepared) { updateTournamentNavButtons(); return; }
  try {
    if (!window._sb) await loadSupabaseClient();
    const { data } = await window._sb.from("prepared_games")
      .select("id,name,created_at").eq("tournament_id", TOURNAMENT_ID);
    const games = (data || []).slice().sort((a, b) => {
      const cmp = (a.name || "").localeCompare(b.name || "", "fr", { numeric: true, sensitivity: "base" });
      return cmp !== 0 ? cmp : (a.created_at || "").localeCompare(b.created_at || "");
    });
    // Parties déjà jouées par le joueur courant (résultat présent ET détail
    // coup par coup non vide → vraiment jouée, pas un import sans partie réelle).
    const played = new Set();
    const pid = +(localStorage.getItem("currentPlayerId") || 0);
    if (pid && games.length) {
      const { data: results } = await window._sb.from("prepared_game_results")
        .select("prepared_game_id,details")
        .eq("player_id", pid)
        .in("prepared_game_id", games.map(g => g.id));
      (results || []).forEach(r => {
        if (Array.isArray(r.details) && r.details.length > 0) played.add(String(r.prepared_game_id));
      });
    }
    const i = games.findIndex(g => String(g.id) === String(state.prepared.id));
    // Première partie NON JOUÉE strictement après la partie courante.
    for (let k = i + 1; k < games.length; k++) {
      if (!played.has(String(games[k].id))) { state._nextGameId = games[k].id; break; }
    }
  } catch (e) { /* non bloquant : bouton restera grisé */ }
  updateTournamentNavButtons();
}

const _btnNextGame = $("#btnNextGame");
if (_btnNextGame) {
  _btnNextGame.onclick = () => goToNextGame();
}

// Met à jour la visibilité des boutons Accueil / Tournoi / Nouvelle partie / Partie suivante
// La classe CSS body.mode-tournament pilote #btnNextGame et #btnRestart via game.css.
function updateTournamentNavButtons() {
  const isTournament = !!state.prepared && !state.isPuzzle;
  const gameOver = state.chronoFinal != null;
  // Classe CSS — source de vérité unique pour les deux boutons principaux
  document.body.classList.toggle("mode-tournament", isTournament);
  // Accueil / ← Tournoi : on affiche « ← Tournoi » pour une partie de tournoi
  // ET pour un solo rattaché à un tournoi (state._soloTid).
  const backToTournament = isTournament || (state.isPuzzle && !!state._soloTid);
  const btnHome = $("#btnHome");
  if (btnHome) btnHome.hidden = backToTournament;
  if (_btnBackToTournament) _btnBackToTournament.hidden = !backToTournament;
  // Partie suivante : active seulement quand la partie est terminée ET qu'une
  // partie suivante existe dans le tournoi (sinon grisée).
  const hasNext = !!state._nextGameId;
  if (_btnNextGame) _btnNextGame.disabled = !gameOver || !hasNext;
  // Modale de fin
  const endModalRestart = $("#endModalRestart");
  const endModalNextGame = $("#endModalNextGame");
  if (endModalRestart) endModalRestart.hidden = isTournament;
  if (endModalNextGame) { endModalNextGame.hidden = !isTournament; endModalNextGame.disabled = !hasNext; }
  const endModalResults = $("#endModalResults");
  if (endModalResults) endModalResults.hidden = !isTournament;   // classement : tournoi uniquement
}

// Modale « Résultats » de la partie de tournoi en cours (classement des joueurs
// ayant déjà joué cette partie). Autonome (le classement de l'accueil est sur une
// autre page).
window.showTournamentResults = async function() {
  if (!PREPARED_ID) return;
  if (!window._sb) await loadSupabaseClient();
  let modal = document.getElementById("resultsModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "resultsModal";
    modal.className = "modal";
    modal.innerHTML = `<div class="backdrop" onclick="document.getElementById('resultsModal').hidden=true"></div>
      <div class="content" style="max-width:460px">
        <button class="close" onclick="document.getElementById('resultsModal').hidden=true">×</button>
        <h2 style="margin-top:0;font-size:1.15rem">🥇 Classement de la partie</h2>
        <div id="resultsModalBody"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const body = modal.querySelector("#resultsModalBody");
  body.innerHTML = `<p class="muted">Chargement…</p>`;
  modal.hidden = false;
  const { data: rowsRaw } = await window._sb.from("prepared_game_results")
    .select("player_id, sum_neg, total_time_seconds, played_on_mobile, players(name)")
    .eq("prepared_game_id", PREPARED_ID);
  const rows = (rowsRaw || []).filter(r => (r.players?.name || "").toLowerCase() !== "admin");
  if (!rows.length) { body.innerHTML = `<p class="muted">Personne d'autre n'a encore joué cette partie.</p>`; return; }
  rows.sort((a, b) => (b.sum_neg || 0) - (a.sum_neg || 0) || (a.total_time_seconds || 0) - (b.total_time_seconds || 0));
  const fmtT = (s) => !s ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const medal = (i) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
  const me = +(localStorage.getItem("currentPlayerId") || 0);
  body.innerHTML = `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.9rem">
    <thead><tr style="background:var(--petrol);color:#fff">
      <th style="padding:5px 8px;text-align:left">#</th><th style="padding:5px 8px;text-align:left">Joueur</th>
      <th style="padding:5px 8px;text-align:right">Négatif</th><th style="padding:5px 8px;text-align:right">Temps</th>
    </tr></thead><tbody>${rows.map((r, i) => {
      const mob = r.played_on_mobile ? `<span title="Jouée sur mobile" style="font-size:.85em">📱</span> ` : "";
      return `<tr${r.player_id === me ? ' style="background:#fff3cd"' : ''}>
        <td style="padding:5px 8px">${medal(i)}</td>
        <td style="padding:5px 8px">${escapeHtmlS(r.players?.name || "#" + r.player_id)}</td>
        <td style="padding:5px 8px;text-align:right">${r.sum_neg ?? 0}</td>
        <td style="padding:5px 8px;text-align:right;white-space:nowrap">${mob}${fmtT(r.total_time_seconds)}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
};
$("#btnRestart").onclick = () => {
  if (confirm("Démarrer une nouvelle partie ? La partie en cours sera perdue.")) restartGame();
};
// Backspace tactile (équivalent de la touche clavier Backspace)
const _btnBack = $("#btnBackspace");
if (_btnBack) _btnBack.onclick = () => { if (state.started) backspace(); };
// Validation tactile (équivalent de Entrée). Sert aussi de "Démarrer" avant
// le début de la partie : si la partie n'a pas commencé, lance startGame().
const _btnVal = $("#btnValidate");
if (_btnVal) _btnVal.onclick = () => {
  if (!state.started) startGame();
  else validate();
};
// Annulation tactile (bouton ✕ rouge, mobile) :
//  • 1 appui  → renvoie les tuiles en cours au chevalet ;
//  • 2 appuis (double-tap ≤ 350 ms) → range le chevalet dans l'ordre alpha.
// Sur mobile, le clic sur la grille ne renvoie plus les lettres (évite les
// annulations accidentelles) → ce bouton est le moyen d'annuler / ranger.
let _cancelLastTap = 0;
const _btnCancel = $("#btnCancel");
if (_btnCancel) _btnCancel.onclick = () => {
  if (!state.started) return;
  // Toujours : renvoyer les tuiles en cours (s'il y en a).
  if (state.pending.length) {
    clearPending();
    renderRack();
    renderBoard();
  }
  // Double-tap → tri alpha du chevalet.
  const now = performance.now();
  if (now - _cancelLastTap < 350) {
    _cancelLastTap = 0;
    restoreRackSort();
  } else {
    _cancelLastTap = now;
  }
};
$("#btnAbandon").onclick = () => {
  if (!state.started || state.chronoFinal != null) return;
  if (!confirm("Abandonner la partie ? Les coups restants seront révélés automatiquement.")) return;
  abandonRest();
};

// Défile les coups restants en révélant le top à chaque fois (sans pénalité de temps)
function abandonRest() {
  if (state.chronoFinal != null) return;
  if (!state.topMove) return;
  // Marquer la partie comme abandonnée (filtrée des stats "meilleur temps")
  state.abandoned = true;
  let playerScore = 0, playedWord = null;
  if (state.pending.length) {
    const m = buildMoveFromPending();
    if (m) {
      const r = scoreMove(state.board, m, state.dict, { bonuses: currentMode().bonuses, jokerPays: currentMode().jokerPays, layout: state.boardLayout });
      if (!r.errors.length) { playerScore = r.score; playedWord = m.word; }
    }
  }
  if (state.bestAttempt && state.bestAttempt.score > playerScore) {
    playerScore = state.bestAttempt.score;
    playedWord = state.bestAttempt.word;
  }
  recordMove({ status: "giveup", playerScore, playedWord });
  placeTopAndAdvance(playerScore);
  nextMove();   // peut déclencher endGame()
  if (state.chronoFinal == null) setTimeout(abandonRest, 80);
}

initGame();

// ============================================================
//  Mise à jour du service worker (anti « code panaché »)
//  Si un nouveau SW prend le contrôle pendant qu'on est sur la page de jeu,
//  l'app tourne avec l'ancien code en mémoire alors que le SW sert les
//  nouveaux fichiers → état incohérent (plateau faux, etc.). On recharge :
//   - immédiatement si AUCUNE partie n'est en cours (sûr) ;
//   - sinon on affiche un bandeau cliquable (pour ne pas faire perdre de coups).
// ============================================================
if ("serviceWorker" in navigator) {
  let swRefreshing = false;
  const doReload = () => { if (!swRefreshing) { swRefreshing = true; location.reload(); } };
  function showUpdateBanner() {
    if (document.getElementById("swUpdateBanner")) return;
    const b = document.createElement("button");
    b.id = "swUpdateBanner";
    b.textContent = "⟳ Nouvelle version disponible — recharger";
    b.setAttribute("style",
      "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;" +
      "padding:10px 16px;border:none;border-radius:8px;background:var(--yellow,#ffdd00);" +
      "color:var(--petrol-dark,#002e44);font-weight:700;font-size:.9rem;cursor:pointer;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.25)");
    b.onclick = doReload;
    document.body.appendChild(b);
  }
  const inGame = () => state.started && state.chronoFinal == null && !review.active;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (inGame()) showUpdateBanner(); else doReload();
  });
  navigator.serviceWorker.getRegistration?.().then(reg => {
    if (!reg) return;
    reg.update();
    setInterval(() => reg.update(), 5 * 60 * 1000);
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (sw) sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          if (inGame()) showUpdateBanner(); else sw.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  }).catch(() => {});
}

// ============================================================
//  Présence temps réel : signaler « en jeu » à l'admin (même canal "online"
//  que la page d'accueil) pour qu'il sache qui joue avant de déployer.
// ============================================================
(function joinGamePresence() {
  const pid = +(localStorage.getItem("currentPlayerId") || 0);
  if (!pid) return;
  (async () => {
    try {
      if (!window._sb) await loadSupabaseClient();
      const ch = window._sb.channel("online", { config: { presence: { key: String(pid) } } });
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") await ch.track({ id: pid, context: "jeu", at: Date.now() });
      });
    } catch (e) { /* silencieux */ }
  })();
})();

// Note : l'ancien garde-fou « ensureLatestVersion » (basé sur la constante figée
// GAME_VERSION) a été retiré — il provoquait un rechargement parasite à chaque
// nouvelle version. La détection de version et l'auto-réparation sont désormais
// gérées proprement par captureSwVersion()/registerSwUpdates() (BUILD_VERSION).
