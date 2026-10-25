/* =========================================================================
   Sudocat — le jeu (gamestof.fr/sudocat)
   Dépend de : moteur.js (generatePuzzle, LEVELS…), mascottes.js (MASCOTTES),
   progression.js (palierInfo, MAX_PALIER), stockage.js (makeStore).
   ========================================================================= */

const MAX_ERREURS = 3;
const DOUBLE_TAP_MS = 350;
// Couleurs vives des zones (écran uniquement ; l'impression garde ses pastels).
const ZONE_COLORS = [
  '#FF6B6B', '#FFD43B', '#4DABF7', '#69DB7C', '#B197FC', '#FF922B',
  '#3BC9DB', '#F783AC', '#A9E34B', '#748FFC', '#FFA8A8', '#63E6BE',
];

const $ = (id) => document.getElementById(id);
const store = makeStore();

let players = [];      // [{ j, nom, palier, theme }] — principal en premier
let player = null;     // joueur actif
let game = null;       // ligne de la partie en cours (stockage)
let puzzle = null;     // grille (generatePuzzle)
let st = null;         // { marks, cats, bad: Set, errors, elapsed, over }
let accountId = null;

/* ------------------------------ Utilitaires ------------------------------ */
function themeKey() { return player && player.theme === 'chien' ? 'chien' : 'chat'; }
function mascotte() { return MASCOTTES[themeKey()]; }
function problem(msg) { $('problem').textContent = msg || ''; $('problem').hidden = !msg; }
function rememberPlayer() { try { localStorage.setItem('sudocat-actif-' + accountId, JSON.stringify(player.j)); } catch { /* */ } }
function rememberedPlayer() { try { return JSON.parse(localStorage.getItem('sudocat-actif-' + accountId)); } catch { return null; } }

/* ------------------------------ Génération (tâche de fond) ------------------------------ */
let worker = null, reqId = 0;
const waiting = new Map();
try {
  worker = new Worker('worker.js?v=2');
  worker.onmessage = (e) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.puzzle);
  };
  worker.onerror = () => { worker = null; };
} catch { worker = null; }

function buildPuzzle(size, level, seed) {
  if (!worker) return new Promise((res) => setTimeout(() => res(generatePuzzle({ size, level, seed })), 30));
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, size, level, seed });
  });
}

/* ------------------------------ Temps de jeu (enregistré, pas affiché) ------------------------------ */
let runningSince = null;
function elapsedNow() { return st ? st.elapsed + (runningSince ? performance.now() - runningSince : 0) : 0; }
function clockStart() {
  if (!st || st.over || runningSince || document.hidden || !$('menu').hidden) return;
  runningSince = performance.now();
}
function clockStop() {
  if (st && runningSince) { st.elapsed += performance.now() - runningSince; runningSince = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clockStop(); saveNow(); } else clockStart();
});

/* ------------------------------ Sauvegarde ------------------------------ */
let saveTimer = null;
function snapshot() {
  return {
    etat: { marks: [...st.marks], cats: [...st.cats], bad: [...st.bad], elapsed: Math.round(elapsedNow()) },
    erreurs: st.errors, duree_ms: Math.round(elapsedNow()),
  };
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1500); }
async function saveNow(extra = {}) {
  clearTimeout(saveTimer);
  if (!game || !st) return;
  try { await store.saveGame(game.id, { ...snapshot(), ...extra }); problem(''); }
  catch (e) { problem('Sauvegarde impossible : ' + e.message); }
}
window.addEventListener('pagehide', () => { if (st && !st.over) { clockStop(); saveNow(); } });

/* ------------------------------ Plateau ------------------------------ */
function catSvg(img) {
  const [bx, by, bw, bh] = img.box, m = Math.max(bw, bh);
  return `<svg viewBox="${bx + bw / 2 - m / 2} ${by + bh / 2 - m / 2} ${m} ${m}" aria-hidden="true">${img.body}</svg>`;
}

function renderBoard() {
  const n = puzzle.size, board = $('board');
  board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  board.style.gap = n >= 10 ? '2px' : '3px';
  board.innerHTML = '';
  for (let i = 0; i < n * n; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.i = i;
    d.style.background = ZONE_COLORS[puzzle.region[i] % ZONE_COLORS.length];
    board.appendChild(d);
  }
  for (let i = 0; i < n * n; i++) renderCell(i);
  if (st.over && st.errors >= MAX_ERREURS) showSolution();
}

function renderCell(i, opts = {}) {
  const el = $('board').children[i];
  if (!el) return;
  const r = Math.floor(i / puzzle.size);
  const showCat = st.cats.has(i) || (opts.hint && puzzle.solution[r] === i % puzzle.size);
  el.classList.toggle('x', st.marks.has(i));
  el.classList.toggle('bad', st.bad.has(i));
  el.classList.toggle('cat', st.cats.has(i));
  el.classList.toggle('hint', !st.cats.has(i) && !!opts.hint && showCat);
  el.innerHTML = showCat ? catSvg(mascotte()) : '';
}
function showSolution() { for (let r = 0; r < puzzle.size; r++) renderCell(r * puzzle.size + puzzle.solution[r], { hint: true }); }

function renderLives() {
  $('lives').innerHTML = Array.from({ length: MAX_ERREURS }, (_, k) =>
    `<span class="${k < MAX_ERREURS - st.errors ? '' : 'lost'}">❤️</span>`).join('');
}

function renderStatus() {
  const pal = game.palier || player.palier;
  $('palierNum').textContent = pal;
  renderLives();
}

/* ------------------------------ Gestes : croix, glisser, double-touche ------------------------------ */
let drag = null;                     // { mode: 'add' | 'remove', seen: Set }
let lastTap = { i: -1, t: 0, before: false };

function cellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const c = el && el.closest && el.closest('#board .cell');
  return c ? Number(c.dataset.i) : -1;
}
function locked(i) { return st.cats.has(i) || st.bad.has(i); }
function applyMark(i, mode) {
  if (locked(i)) return;
  if (mode === 'add') st.marks.add(i); else st.marks.delete(i);
  renderCell(i);
}

$('board').addEventListener('pointerdown', (e) => {
  if (!st || st.over || e.button > 0) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i < 0) return;
  e.preventDefault();
  const now = performance.now();
  if (lastTap.i === i && now - lastTap.t < DOUBLE_TAP_MS) {
    // Double-touche : on annule la croix du premier appui, puis on pose un chat.
    if (!locked(i)) { if (lastTap.before) st.marks.add(i); else st.marks.delete(i); }
    lastTap = { i: -1, t: 0, before: false };
    drag = null;
    placeCat(i);
    return;
  }
  lastTap = { i, t: now, before: st.marks.has(i) };
  if (locked(i)) { drag = null; return; }
  drag = { mode: st.marks.has(i) ? 'remove' : 'add', seen: new Set([i]) };
  applyMark(i, drag.mode);
  $('board').setPointerCapture(e.pointerId);
});
$('board').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i < 0 || drag.seen.has(i)) return;
  drag.seen.add(i);
  lastTap = { i: -1, t: 0, before: false };   // un glissé n'est pas un double-touche
  applyMark(i, drag.mode);
});
function endDrag() { if (drag) { drag = null; saveSoon(); } }
$('board').addEventListener('pointerup', endDrag);
$('board').addEventListener('pointercancel', endDrag);
$('board').addEventListener('contextmenu', (e) => e.preventDefault());

/* ------------------------------ Chats, erreurs, fin ------------------------------ */
function placeCat(i) {
  if (!st || st.over || st.cats.has(i) || st.bad.has(i)) return;
  const n = puzzle.size, r = Math.floor(i / n), c = i % n;
  st.marks.delete(i);
  if (puzzle.solution[r] === c) {
    st.cats.add(i);
    renderCell(i);
    if (navigator.vibrate) navigator.vibrate(10);
    if (st.cats.size === n) return finish(true);
  } else {
    st.errors++;
    st.bad.add(i);
    renderCell(i);
    renderLives();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    if (st.errors >= MAX_ERREURS) return finish(false);
  }
  saveNow();
}

/**
 * Progression : sans faute → palier suivant ; 1 ou 2 erreurs → même palier ;
 * perdue (3 erreurs) ou abandonnée → palier précédent (jamais sous le 1).
 */
async function movePalier(delta) {
  const gamePalier = game.palier || player.palier;
  if (gamePalier !== player.palier) return '';            // vieille partie reprise : pas d'effet
  const next = Math.min(MAX_PALIER, Math.max(1, player.palier + delta));
  if (next === player.palier) return delta > 0 ? 'Sans faute au palier maximum !' : '';
  player.palier = next;
  try { await store.updatePlayer(player.j, { palier: next }); } catch (e) { problem('Palier non enregistré : ' + e.message); }
  return delta > 0 ? `Palier ${next} débloqué !` : `Retour au palier ${next}.`;
}

async function finish(won) {
  clockStop();
  st.over = true;
  const sansFaute = won && st.errors === 0;
  const levelMsg = await movePalier(sansFaute ? 1 : won ? 0 : -1);
  await saveNow({ resultat: won ? 'gagnee' : 'perdue', facile: sansFaute, finie_le: new Date().toISOString() });

  if (won) {
    $('endIcon').textContent = sansFaute ? '🏆' : '🎉';
    $('endTitle').textContent = sansFaute ? 'Sans faute !' : 'Bravo !';
    $('endText').textContent = sansFaute ? 'Grille résolue sans la moindre erreur.'
      : `Résolue avec ${st.errors} erreur${st.errors > 1 ? 's' : ''} : tu restes au palier ${player.palier}. Sans faute, tu monteras.`;
  } else {
    showSolution();
    $('endIcon').textContent = '😿';
    $('endTitle').textContent = 'Perdu…';
    $('endText').textContent = `${MAX_ERREURS} erreurs : la grille est perdue.`;
  }
  $('endLevel').textContent = levelMsg;
  $('endLevel').hidden = !levelMsg;
  $('endDialog').hidden = false;
}

/* ------------------------------ Parties ------------------------------ */
async function loadPuzzle(size, level, seed) {
  $('loading').hidden = false;
  try { return await buildPuzzle(size, level, seed); }
  finally { $('loading').hidden = true; }
}

async function newGrid() {
  $('endDialog').hidden = true;
  clockStop();
  st = null; puzzle = null;
  $('board').innerHTML = '';
  const who = player;
  const info = palierInfo(who.palier);
  const graine = 1 + Math.floor(Math.random() * 2147483646);
  const taille = info.taille;
  try {
    const p = await loadPuzzle(taille, info.niveau, graine);
    if (who !== player) return;                       // joueur changé entre-temps
    game = await store.startGame(who.j, { niveau: info.niveau, palier: info.palier, taille, graine, theme: who.theme });
    begin(p, null);
    saveNow();
  } catch (e) { problem('Impossible de préparer la grille : ' + e.message); }
}

async function resume(row) {
  const who = player;
  try {
    const p = await loadPuzzle(row.taille, row.niveau, Number(row.graine));
    if (who !== player) return;
    game = row;
    begin(p, row.etat);
  } catch (e) { problem('Impossible de reprendre la grille : ' + e.message); }
}

function begin(p, etat) {
  puzzle = p;
  const e = etat || {};
  st = {
    marks: new Set(e.marks || []),
    cats: new Set(e.cats || p.givens),
    bad: new Set(e.bad || []),
    errors: (e.bad || []).length,
    elapsed: e.elapsed || 0,
    over: false,
  };
  for (const g of p.givens) st.cats.add(g);
  renderBoard();
  renderStatus();
  clockStart();
}

$('nextGrid').addEventListener('click', newGrid);

/* ------------------------------ Joueurs ------------------------------ */
function renderPlayers() {
  const nav = $('players');
  nav.hidden = players.length < 2;
  nav.innerHTML = '';
  for (const pl of players) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = pl.nom;
    b.classList.toggle('on', pl === player);
    b.addEventListener('click', () => switchPlayer(pl));
    nav.appendChild(b);
  }
}

async function switchPlayer(pl) {
  if (pl === player) return;
  if (st && !st.over) { clockStop(); await saveNow(); }
  player = pl;
  rememberPlayer();
  game = null; st = null; puzzle = null;
  $('board').innerHTML = '';
  $('endDialog').hidden = true;
  renderPlayers();
  renderTheme();
  const row = await store.currentGame(player.j);
  if (player !== pl) return;
  if (row) await resume(row); else await newGrid();
}

/* ------------------------------ Thème ------------------------------ */
function renderTheme() {
  const chien = themeKey() === 'chien';
  $('themeBtn').textContent = chien ? '🐶' : '🐱';
  $('brand').textContent = chien ? 'Sudodog' : 'Sudocat';
  document.title = (chien ? 'Sudodog' : 'Sudocat') + ' · gamestof.fr';
}
$('themeBtn').addEventListener('click', async () => {
  const next = themeKey() === 'chien' ? 'chat' : 'chien';
  player.theme = next;
  renderTheme();
  if (puzzle && st) renderBoard();
  try { await store.updatePlayer(player.j, { theme: next }); } catch (e) { problem('Thème non enregistré : ' + e.message); }
});

/* ------------------------------ Menu ------------------------------ */
$('menuBtn').addEventListener('click', async () => {
  clockStop();
  $('menuWho').textContent = player.nom;
  $('menu').hidden = false;
  $('stats').innerHTML = '';
  try {
    const s = await store.stats(player.j);
    $('stats').innerHTML =
      `<div><b>${player.palier}</b><span>palier</span></div>` +
      `<div><b>${s.jouees}</b><span>jouées</span></div>` +
      `<div><b>${s.gagnees}</b><span>réussies</span></div>` +
      `<div><b>${s.faciles}</b><span>sans faute</span></div>`;
  } catch (e) { problem(e.message); }
});
function closeMenu() { $('menu').hidden = true; clockStart(); }
$('closeMenu').addEventListener('click', closeMenu);
$('menu').addEventListener('click', (e) => { if (e.target === $('menu')) closeMenu(); });

$('giveUp').addEventListener('click', async () => {
  if (!st || st.over) { $('menu').hidden = true; return newGrid(); }
  if (!confirm(player.palier > 1 ? `Abandonner cette grille ? Elle compte comme perdue : retour au palier ${player.palier - 1}.`
    : 'Abandonner cette grille ? Elle compte comme perdue.')) return;
  $('menu').hidden = true;
  clockStop();
  st.over = true;
  await movePalier(-1);
  await saveNow({ resultat: 'abandon', finie_le: new Date().toISOString() });
  newGrid();
});

$('logout').addEventListener('click', async () => {
  $('menu').hidden = true;
  if (st && !st.over) await saveNow();
  await store.signOut();
  players = []; player = game = puzzle = st = null;
  showAuth('login');
});

/* ------------------------------ Connexion ------------------------------ */
let authMode = 'login';
function showAuth(mode) {
  authMode = mode;
  $('gameScreen').hidden = true; $('authScreen').hidden = false;
  $('authTitle').textContent = { login: 'Connexion', signup: 'Créer un compte', reset: 'Mot de passe oublié' }[mode];
  $('authPseudo').hidden = mode !== 'signup';
  $('authPseudo').required = mode === 'signup';
  $('authPassword').hidden = mode === 'reset';
  $('authPassword').required = mode !== 'reset';
  $('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('authSubmit').textContent = { login: 'Se connecter', signup: 'Créer mon compte', reset: 'Recevoir un lien' }[mode];
  $('toSignup').hidden = mode === 'signup';
  $('toLogin').hidden = mode === 'login';
  $('toReset').hidden = mode !== 'login';
  $('authError').hidden = true; $('authInfo').hidden = true;
}
$('toSignup').addEventListener('click', () => showAuth('signup'));
$('toLogin').addEventListener('click', () => showAuth('login'));
$('toReset').addEventListener('click', () => showAuth('reset'));

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('authEmail').value.trim(), password = $('authPassword').value, pseudo = $('authPseudo').value.trim();
  $('authError').hidden = true; $('authInfo').hidden = true;
  $('authSubmit').disabled = true;
  try {
    if (authMode === 'signup') {
      if (pseudo.length < 2) throw new Error('Choisis un pseudo d’au moins 2 caractères.');
      const r = await store.signUp(email, password, pseudo);
      if (r.needsConfirmation) {
        showAuth('login');
        $('authInfo').textContent = 'Compte créé : confirme ton adresse avec le lien reçu par email, puis connecte-toi.';
        $('authInfo').hidden = false;
        return;
      }
      await enterGame();
    } else if (authMode === 'login') {
      await store.signIn(email, password);
      await enterGame();
    } else {
      await store.resetPassword(email);
      $('authInfo').textContent = 'Si un compte existe avec cet email, un lien vient d’être envoyé.';
      $('authInfo').hidden = false;
    }
  } catch (err) {
    $('authError').textContent = err.message;
    $('authError').hidden = false;
  } finally { $('authSubmit').disabled = false; }
});

// Lien « mot de passe oublié » : Supabase ramène ici en mode récupération.
if (!store.local) {
  store.sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') $('newPasswordDialog').hidden = false;
  });
}
$('newPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await store.updatePassword($('newPassword').value);
    $('newPasswordDialog').hidden = true;
    await enterGame();
  } catch (err) { $('newPasswordError').textContent = err.message; $('newPasswordError').hidden = false; }
});

/* ------------------------------ Démarrage ------------------------------ */
async function enterGame() {
  accountId = (await store.user()).id;
  players = await store.players();
  const remembered = rememberedPlayer();
  player = players.find((p) => p.j === remembered) || players[0];
  $('authScreen').hidden = true;
  $('gameScreen').hidden = false;
  renderPlayers();
  renderTheme();
  const row = await store.currentGame(player.j);
  if (row) await resume(row); else await newGrid();
}

(async function init() {
  if (window.SUDOCAT_SUPABASE_URL && !window.supabase) {
    showAuth('login');
    $('authError').textContent = 'Connexion au serveur impossible. Vérifie ton réseau puis relance l’appli.';
    $('authError').hidden = false;
    return;
  }
  $('localBanner').hidden = !store.local;
  try {
    if (await store.user()) await enterGame(); else showAuth('login');
  } catch (e) {
    showAuth('login');
    $('authError').textContent = e.message;
    $('authError').hidden = false;
  }
})();
