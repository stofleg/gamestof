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
  bagTotalVowels, bagTotalConsonants, GAME_MODES, modeDisplayName,
} from "./engine.js";
import { Dictionary } from "./dictionary.js";
import { findTop, findTopRanked } from "./topfinder.js";

// État du mode review (parcours coup par coup)
const review = {
  active: false,
  game: null,           // prepared_games row
  result: null,         // prepared_game_results row (peut être null)
  historyByMove: {},    // moveNo → entrée du joueur
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

// Version de ce build JS. Doit correspondre au CACHE du service worker (sw.js)
// et à EXPECTED_SW_CACHE (app.js). Sert à détecter un code périmé servi par un
// service worker non mis à jour (cause probable des "tirages d'ailleurs").
const BUILD_VERSION = "garenna-v198";

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
  let badgeCell = null, badgeScore = null;
  if (state.pending.length > 0) {
    const mv = buildMoveFromPending();
    if (mv) {
      const r0 = scoreMove(state.board, mv, null, { bonuses: currentMode().bonuses, raw: true });
      badgeScore = r0.score;
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
      const bonus = BOARD_BONUSES[r][c];
      const cls = [bonusClass(bonus)];
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
        badge = `<span class="score-badge">${badgeScore}</span>`;
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

function onRackTileTap(e) {
  if (review.active) return;
  const el = e.currentTarget;
  const id = +el.dataset.rackId;
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
    if (Math.hypot(t.clientX - _touchDrag.startX, t.clientY - _touchDrag.startY) < 8) return;
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
  if (!drag.moved) return;   // simple tap → le clic natif pose la lettre au curseur
  const t = e.changedTouches && e.changedTouches[0];
  if (!t) return;
  const under = document.elementFromPoint(t.clientX, t.clientY);
  if (!under || !under.closest) return;
  const td = under.closest("td[data-r]");
  if (td) { placeRackTileOnCell(drag.id, +td.dataset.r, +td.dataset.c); return; }
  const rt = under.closest(".tile[data-rack-id]");
  if (rt) { reorderRack(drag.id, +rt.dataset.rackId); return; }
  // lâché ailleurs → rien (la lettre reste au chevalet)
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
  $("#totalScore").textContent = state.totalScore;
  $("#sumNeg").textContent = state.sumNeg;
  // Section "coup précédent"
  const last = state.history?.[state.history.length - 1];
  const prevNoEl = document.getElementById("prevMoveNo");
  const prevNegEl = document.getElementById("prevNeg");
  const prevTimeEl = document.getElementById("prevTime");
  if (prevNoEl)   prevNoEl.textContent   = last ? last.moveNo : "—";
  if (prevNegEl)  prevNegEl.textContent  = last ? last.neg : "—";
  if (prevTimeEl) prevTimeEl.textContent = last ? fmtChrono(Math.round((last.timeMs || 0) / 1000)) : "—";
  renderChrono();
  renderMoveTimer();
  renderBag();
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
    if (state.settings.withJoker && state.spareJokers > 0) {
      counts["?"] = (counts["?"] || 0) + state.spareJokers;
    }
  }
  const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const consonnes = allLetters.filter(l => !VOYELLES_SET.includes(l));
  const ordered = [...VOYELLES_SET, ...consonnes, "?"];
  const total = Object.values(counts).reduce((a, n) => a + (n > 0 ? n : 0), 0);
  $("#bagCount").textContent = total;
  $("#bagTiles").innerHTML = ordered.map(l => {
    const n = counts[l] || 0;
    if (n <= 0) return "";   // jamais de compteur négatif (double-décompte transitoire)
    const cls = ["bag-chip"];
    if (l === "?") cls.push("joker");
    return `<span class="${cls.join(" ")}">${l}<span class="ct">${n}</span></span>`;
  }).join("");
}

// Case où placer le badge de score (rightmost en H, bottommost en V, sinon dernière posée).
// On essaie d'éviter une case déjà occupée par un jeton (mieux lisible) : on avance
// d'une case dans la direction du mot vers une case libre ; à défaut on prend la case
// avant le mot ; si rien de libre n'est trouvé, on retombe sur la dernière case pending.

function computePendingScore() {
  if (state.pending.length === 0) return null;
  const m = buildMoveFromPending();
  if (!m) return null;
  const r = scoreMove(state.board, m, null, { bonuses: currentMode().bonuses });
  if (r.errors.length) return null;
  return r.score;
}

function renderMoveTimer() {
  const chip = $("#moveTimerChip");
  const el = $("#moveTimer");
  const label = $("#moveTimerLabel");
  if (!el || !chip) return;
  if (label) label.textContent = `Coup ${state.moveNo}`;
  if (state.settings.timePerMove > 0 && state.started && !state.chronoFinal) {
    el.textContent = `${state.moveTimeLeft}s`;
    // Chrono Challenge : la chip passe en rouge dans les 10 dernières secondes.
    // Chrono Zen : pas de changement de couleur, même apparence du début à la fin.
    const zen = state.settings.chronoType === "zen";
    chip.classList.toggle("danger", !zen && state.moveTimeLeft <= 10);
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
  }
}
function stopMoveTimer() {
  if (moveTimer) { clearInterval(moveTimer); moveTimer = null; }
  return state.moveStart ? performance.now() - state.moveStart : 0;
}

// Coup non trouvé dans le temps : on révèle le top sans pénalité supplémentaire
function timeoutAdvance() {
  ensureTopReady();
  if (!state.started || !state.topMove) return;
  let playerScore = 0, playedWord = null;
  if (state.pending.length) {
    const m = buildMoveFromPending();
    if (m) {
      const r = scoreMove(state.board, m, state.dict, { bonuses: currentMode().bonuses });
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
  // Flash "mot faux" en cours → on l'annule pour que le clic agisse tout de
  // suite (les cases redeviennent libres, les lettres reviennent au chevalet).
  if (clearInvalidFlash()) renderRack();
  clearTopHighlight();   // tout clic sur la grille efface le contour du top
  if (state.board[r][c]) return;
  // Si on a des tuiles en cours de pose et qu'on clique en dehors, on les renvoie
  // sur le chevalet (annule la saisie) puis on repositionne le curseur.
  const clickedOnPending = state.pending.some(p => p.row === r && p.col === c);
  if (state.pending.length > 0 && !clickedOnPending) {
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
  if (state.board[r][c]) return;
  if (state.pending.length > 0) {
    const clickedOnPending = state.pending.some(p => p.row === r && p.col === c);
    if (!clickedOnPending) {
      clearPending();
      renderRack();
    }
  }
  state.cursor = { row: r, col: c, dir: "V" };
  renderBoard();
}

function clearPending() {
  for (const t of state.rack) t.used = false;
  state.pending = [];
  state.jokerPending = false;
}

function moveCursorKey(key) {
  const delta = {
    ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
  }[key];
  if (!delta) return;
  let row = state.cursor.row, col = state.cursor.col;
  // On avance dans la direction en ENJAMBANT les cases déjà occupées : le
  // curseur se pose sur la 1ʳᵉ case LIBRE rencontrée (ex. mot en H4-H8 → de H3,
  // flèche droite, le curseur saute directement en H9).
  let guard = 0;
  do {
    row = (row + delta[0] + BOARD_SIZE) % BOARD_SIZE;
    col = (col + delta[1] + BOARD_SIZE) % BOARD_SIZE;
    guard++;
  } while (isOccupied(row, col) && guard < BOARD_SIZE);
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
  // Barre espace : toggle sens du curseur (H ↔ V)
  if (state.cursor && e.key === " ") {
    if (state._invalidFlash) { clearInvalidFlash(); renderRack(); }
    if (state.pending.length === 0) {
      e.preventDefault();
      state.cursor.dir = state.cursor.dir === "H" ? "V" : "H";
      renderBoard();
      return;
    }
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

let flashTimer = null;
let topWordTimer = null;   // efface la surbrillance bleue du mot top après 3s
function flashFeedback(kind, title, detail) {
  showFeedback(kind, title, detail);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    // Ne pas écraser le feedback : on laisse le message d'erreur visible.
  }, 1500);
}

// ============================================================
//  Validation
// ============================================================
// Si le calcul du top a été différé (cf. nextMove), on le force maintenant :
// garantit que state.topMove est prêt avant toute comparaison.
function ensureTopReady() {
  if (state._topPending) { computeTop(); state._topPending = false; }
}

function validate() {
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
  const topMv = state.topMove?.move;
  // Exception 1er coup : on accepte tout mot du top OU isotop (même score que le top),
  // peu importe la position de placement.
  if (state.moveNo === 1 && topMv && state.topMove) {
    const topScore = state.topMove.score;
    // Liste des mots isotopes pré-calculée par findTopRanked.
    // En mode pré-tiré (tournoi), la liste n'est pas stockée → on la calcule à la volée.
    let isotopWords = state.topMove.isotopWords;
    if (!isotopWords) {
      const rackLetters = state.rack.map(t => t.letter);
      const allMoves = findTop(state.board, rackLetters, state.dict, {
        all: true, maxTilesUsed: mode.maxPlayed, bonuses: mode.bonuses,
      }) || [];
      isotopWords = [...new Set(allMoves.filter(c => c.score === topScore).map(c => c.move.word))];
      state.topMove.isotopWords = isotopWords;
    }
    if (isotopWords.includes(move.word)) {
      state.moveMaxPlaced = Math.max(state.moveMaxPlaced, state.pending.length);
      recordMove({ status: "top", playerScore: topScore, playedWord: move.word, playedMove: move });
      hideTopFeedback();  // efface le top du coup précédent dès validation
      placeTopAndAdvance(topScore, move.word, topScore, move);
      nextMove();
      return;
    }
    // DEBUG : trace si le mot ressemble au top mais isotop n'a pas matché
    console.log("[isotop check] move.word =", JSON.stringify(move.word),
                "| isotopWords =", JSON.stringify(isotopWords),
                "| topScore =", topScore);
  }
  // Règle FFSC : si le joker a un homonyme (même lettre) dans le mot, on permute
  // automatiquement vers la combinaison la plus avantageuse en points.
  const result = bestJokerVariant(state.board, move, state.dict, { bonuses: mode.bonuses });
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

  // 1) SURBRILLANCE ROUGE du/des mot(s) fautif(s).
  state.invalidCells = (invalidCells && invalidCells.length) ? invalidCells : [];
  if (!state.invalidCells.length) state.pending.forEach(p => p.invalid = true);
  clearTimeout(state._errorTimeout);
  clearTimeout(state._flashTimer);
  state._invalidFlash = true;

  // 2) Curseur repositionné AU DÉPART TOUT DE SUITE : il est actif et déplaçable
  //    PENDANT le flash. Les tuiles rouges restent visibles tant que le joueur
  //    n'agit pas ; la moindre action (clic, frappe, retour, swipe) annule le
  //    flash immédiatement (cf. clearInvalidFlash) et s'exécute sans latence.
  if (startCell) state.cursor = { row: startCell.row, col: startCell.col, dir };
  renderBoard();
  showFeedback("error", "Coup invalide", detail);

  // 3) Filet : si le joueur ne fait rien, on nettoie après un court délai.
  state._flashTimer = setTimeout(() => {
    if (!clearInvalidFlash()) return;
    renderRack();
    renderBoard();
    restorePersistentFeedback();   // meilleur essai (avec position) ou repère
  }, 1400);
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
      state.settings.withJoker && jokerUsedAsLetter !== null && state.spareJokers > 0) {
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

  // Score
  state.totalScore += playerScore;
  state.sumNeg += (playerScore - tm.score);
  // Nettoyage. On NE supprime PAS le curseur : il reste visible pour permettre
  // une navigation 100% clavier sans avoir à recliquer après chaque validation.
  // S'il atterrit sur une case maintenant occupée, on l'avance après nextMove.
  state.pending = [];
  state.bestAttempt = null;
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
  ensureTopReady();
  if (!state.topMove) return;
  state.chronoPenalty += 20;
  // Évaluer le pending courant
  let pendingScore = 0;
  let pendingWord = null;
  if (state.pending.length) {
    const move = buildMoveFromPending();
    if (move) {
      const r = scoreMove(state.board, move, state.dict, { bonuses: currentMode().bonuses });
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
function recordMove({ status, playerScore, playedWord = null, playedMove = null }) {
  const tm = state.topMove;
  const timeMs = stopMoveTimer();
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
    neg: playerScore - (tm?.score || 0),
    status,        // "top" | "giveup" | "timeout"
    invalidCount: state.moveInvalidCount,
    timeMs,
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
    computeTop();
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
    // §3.7 exception : tant qu'un joker ou le Y est dans le pool (≥2 lettres),
    // la partie ne peut pas s'arrêter — joker/Y peuvent servir de voyelle ou consonne.
    const jokersInPool = (state.bag["?"] || 0)
      + remainingRackLetters.filter(l => l === "?").length;
    const totalPool = vAvail + cAvail + jokersInPool;
    const hasWildcard = jokersInPool > 0 || (state.bag["Y"] || 0) > 0
      || remainingRackLetters.includes("Y");
    if (!(hasWildcard && totalPool >= 2)) {
      endGame();
      return;
    }
  }

  // Compléter le chevalet selon le mode de partie
  const mode = currentMode();
  const targetSize = mode.rackSize;
  // Mode joker : si jokers actifs disponibles, on impose 1 joker dans le tirage
  const jokerInRack = state.rack.some(t => t.letter === "?");
  const forceJoker = state.settings.withJoker && state.spareJokers > 0 && !jokerInRack;
  const regularTarget = forceJoker ? targetSize - 1 : targetSize;
  const kept = state.rack.map(t => t.letter);
  const result = drawForDuplicate(state.bag, kept, state.moveNo, regularTarget);
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
  setTimeout(() => { if (state._topPending) { computeTop(); state._topPending = false; } }, 0);
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

function computeTop() {
  if (!state.dict) return;
  // Mode pré-tiré : utiliser le top stocké, pas de calcul
  if (state.prepared) {
    const m = state.prepared.moves[state.preparedIdx];
    if (!m) { state.topMove = null; return; }
    state.topMove = {
      score: m.top.score,
      move: { word: m.top.word, row: m.top.row, col: m.top.col, dir: m.top.dir, blanks: m.top.blanks || [] },
      words: m.top.words || [],
    };
    return;
  }
  const mode = currentMode();
  const rackLetters = state.rack.map(t => t.letter);
  const t0 = performance.now();
  state.topMove = findTopRanked(state.board, rackLetters, state.dict, state.bag, {
    maxTilesUsed: mode.maxPlayed,
    bonuses: mode.bonuses,
    preserveJoker: state.settings.withJoker && state.spareJokers > 0,
  });
  const t1 = performance.now();
  // Pas de log du mot pour ne pas spoiler via la console
  void t1;
}

// ============================================================
//  Settings modal
// ============================================================
window.openSettings = () => {
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
  // Indication visuelle
  const lockMsg = $("#settingsLock");
  if (lockMsg) lockMsg.hidden = !inGame;
  $("#settings").hidden = false;
};
window.closeSettings = () => {
  const oldMode = state.settings.gameMode;
  const oldJoker = state.settings.withJoker;
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
  // Si on a changé le mode ou le joker, proposer de relancer
  if (oldMode !== state.settings.gameMode || oldJoker !== state.settings.withJoker) {
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


async function initGame() {
  captureSwVersion();   // détecter un éventuel service worker périmé
  state.bag = { ...LETTER_BAG };
  state.prepared = null;
  state.isPuzzle = false;
  state.preparedIdx = 0;
  // Mode joker : extraire les 2 jokers du sac et les stocker à part
  if (state.settings.withJoker) {
    state.spareJokers = state.bag["?"] || 0;
    state.bag["?"] = 0;
  } else {
    state.spareJokers = 0;
  }
  state.board = emptyBoard();
  state.rack = [];
  state.pending = [];
  state.cursor = null;
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
  if (_btnReview) { _btnReview.hidden = true; _btnReview.classList.remove("active"); }
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
  if (!state.dict) {
    // (Pas de feedback "Chargement du dictionnaire" — UX silencieuse)
    state.dict = await new Dictionary().load("ods9.txt");
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
  // Charger une partie pré-tirée si demandée via URL
  if (PREPARED_ID && !state.prepared) {
    showFeedback("", "Chargement de la partie…", "");
    try {
      await loadPreparedGame(PREPARED_ID);
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
  showFeedback("", `🧩 Puzzle — ${g.name} · coup ${moveNo}`,
    `Appuie sur <kbd>Entrée</kbd> pour démarrer. Trouve le top !`);
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
    $("#rvTop").innerHTML = `${wLink(m.top.word)} — ${m.top.score} pts en ${posLabelMove(m.top)}`;

    // Mot du joueur
    const ph = review.historyByMove[m.moveNo];
    if (ph) {
      if (ph.played) {
        $("#rvPlayed").innerHTML = `${wLink(ph.played)} — ${ph.playerScore} pts ${ph.status === "top" ? "🏆" : ph.status === "timeout" ? "⏱" : "🏳️"}`;
      } else {
        $("#rvPlayed").textContent = `— (rien joué, ${ph.status})`;
      }
      $("#rvNeg").textContent = ph.neg;
    } else {
      $("#rvPlayed").textContent = "—";
      $("#rvNeg").textContent = "—";
    }

    // Autres solutions valides (calcul à la volée)
    renderReviewSolutions(idx);
  }
}

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
        const bonus = BOARD_BONUSES[r][c];
        const isCenter = r === CENTER && c === CENTER;
        let cls = "normal";
        if (isCenter)         cls = "center";
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
    }) || [];
    // Au 1er coup, on ne joue jamais verticalement en duplicate
    if (idx === 0) all = all.filter(s => s.move.dir === "H");
    review._solutions = all.slice(0, 200);
    const rows = review._solutions.map((s, i) => {
      const isTop = s.move.word === topMv.word && s.move.row === topMv.row && s.move.col === topMv.col && s.move.dir === topMv.dir;
      const isPlayed = playedMv && s.move.word === playedMv
        && (!playedPos || posLabelMove(s.move) === playedPos);
      const cls = isTop ? "is-top" : (isPlayed ? "is-played" : "");
      return `<tr class="${cls}" data-i="${i}"><td>${wLink(s.move.word)}</td><td>${posLabelMove(s.move)}</td><td>${s.score}</td></tr>`;
    }).join("");
    div.innerHTML = `<table>
      <thead><tr><th>Mot</th><th>Place</th><th>Score</th></tr></thead>
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
  _btnReview.hidden = true; // masqué tant que la partie n'est pas terminée
  _btnReview.onclick = () => {
    if (review.active) {
      exitLocalReview();
    } else {
      if (!state.history?.length) return;
      // En mode tournoi, pas de review pendant la partie
      if (state.prepared && state.started) return;
      closeEndModal?.();
      enterLocalReview();
    }
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
  state.prepared = {
    id: data.id,
    name: data.name,
    mode: data.mode,
    withJoker: data.with_joker,
    timePerMove: data.time_per_move,
    moves: data.moves,
  };
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
  $("#btnPause").hidden = !isTraining;
  // Annot toolbar : masquée par défaut, visible uniquement via le bouton ✏️ Annoter
  if (isTraining) clearSavedTraining();
  // Bouton Revoir : masqué pendant la partie (tout mode), visible seulement en fin
  if (_btnReview) { _btnReview.hidden = true; _btnReview.classList.remove("active"); }
  updateTournamentNavButtons();
  startChrono();
  nextMove();
}

// ===== Pause + persistance (uniquement entraînement) =====
const TRAINING_STORAGE_KEY = "trainingPaused";
state.paused = false;
state._pauseInfo = null;

function saveTrainingState() {
  if (state.prepared || state.isPuzzle) return;
  try {
    const snapshot = {
      playerId: +(localStorage.getItem("currentPlayerId") || 0),
      bag: state.bag,
      board: state.board,
      rack: state.rack.map(t => ({ letter: t.letter })),
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

function pauseGame({ showModal = true } = {}) {
  if (!state.started || state.chronoFinal != null || state.prepared || state.isPuzzle) return;
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
  if (_btnReview) { _btnReview.hidden = false; _btnReview.classList.remove("active"); }
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
  if (_btnReview) { _btnReview.hidden = false; _btnReview.classList.add("active"); }
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
  const rows = state.history.map((h, i) => {
    const time = h.timeMs ? (h.timeMs / 1000).toFixed(2) + "s" : "—";
    // Surbrillance des tops non-trouvés (timeout = temps écoulé OU abandon)
    const isMiss = h.status === "giveup" || h.status === "timeout";
    const rowClass = isMiss ? "sheet-miss" : "";
    // Icônes distinctes : timeout = ⏱ chrono · giveup (voir le coup / abandon) = 🏳️ drapeau blanc
    const statusIcon = { top: "🏆", giveup: "🏳️", timeout: "⏱" }[h.status] || "";
    const statusLabel = { top: "top", giveup: "abandon", timeout: "temps écoulé" }[h.status] || h.status;
    const coord = pos => `<span style="font-size:.75em;color:#888;vertical-align:.1em">${pos}</span>`;
    const topCell = h.top
      ? `<strong>${wLink(h.top.word)}</strong> ${coord(h.top.pos)} ${h.top.score} pts`
      : "—";
    const playedCell = h.played
      ? `<strong>${wLink(h.played)}</strong>${h.playedPos ? " " + coord(h.playedPos) : ""} ${h.playerScore} pts`
      : `<em>—</em>`;
    const onclick = clickable ? `onclick="jumpToReviewMove(${h.moveNo})" style="cursor:pointer"` : "";
    return `<tr class="${rowClass}" ${onclick}>
      <td>${h.moveNo}</td>
      <td style="padding-right:26px"><code>${rackDisplay(h)}</code></td>
      <td style="padding-right:26px">${topCell}</td>
      <td>${playedCell}</td>
      <td style="text-align:center;padding:6px 4px" class="${h.neg < 0 ? 'neg' : ''}">${h.neg < 0 ? h.neg : ''}</td>
      <td>${statusIcon} <span style="color:#888;font-size:.85em">${statusLabel}</span></td>
      <td style="text-align:right">${time}</td>
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
        <th style="padding:6px 8px;text-align:left">Statut</th>
        <th style="padding:6px 8px;text-align:right">Temps</th>
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

// Touche Shift seule (tap) : Pause / Reprendre. Détecté via paire keydown/keyup
// SANS autre touche intermédiaire, pour ne pas se déclencher quand on tape une
// majuscule (Shift + lettre).
let shiftAloneFlag = false;
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "Shift") {
    if (!e.repeat) shiftAloneFlag = true;
  } else {
    shiftAloneFlag = false;   // une autre touche est tombée → Shift sert de modificateur
  }
});
document.addEventListener("keyup", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "Shift" && shiftAloneFlag) {
    shiftAloneFlag = false;
    // Seulement en entraînement actif, partie démarrée non terminée
    if (state.started && !state.prepared && state.chronoFinal == null) {
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
  window.location.href = TOURNAMENT_ID
    ? `../index.html#tid=${TOURNAMENT_ID}`
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
    const gameInProgress = state.prepared && state.started && state.chronoFinal == null;
    goBackToTournament(gameInProgress);
  };
}

const _btnNextGame = $("#btnNextGame");
if (_btnNextGame) {
  _btnNextGame.onclick = () => goBackToTournament(false);
}

// Met à jour la visibilité des boutons Accueil / Tournoi / Nouvelle partie / Partie suivante
// La classe CSS body.mode-tournament pilote #btnNextGame et #btnRestart via game.css.
function updateTournamentNavButtons() {
  const isTournament = !!state.prepared && !state.isPuzzle;
  const gameOver = state.chronoFinal != null;
  // Classe CSS — source de vérité unique pour les deux boutons principaux
  document.body.classList.toggle("mode-tournament", isTournament);
  // Accueil / ← Tournoi
  const btnHome = $("#btnHome");
  if (btnHome) btnHome.hidden = isTournament;
  if (_btnBackToTournament) _btnBackToTournament.hidden = !isTournament;
  // Partie suivante : enabled seulement quand la partie est terminée
  if (_btnNextGame) _btnNextGame.disabled = !gameOver;
  // Modale de fin
  const endModalRestart = $("#endModalRestart");
  const endModalNextGame = $("#endModalNextGame");
  if (endModalRestart) endModalRestart.hidden = isTournament;
  if (endModalNextGame) endModalNextGame.hidden = !isTournament;
}
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
      const r = scoreMove(state.board, m, state.dict, { bonuses: currentMode().bonuses });
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
