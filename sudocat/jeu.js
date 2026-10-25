/* =========================================================================
   Sudocat — le jeu (gamestof.fr/sudocat)
   Dépend de : moteur.js (generatePuzzle, imageOrder, randomSizeFor, LEVELS…),
   illustrations.js (ILLUSTRATIONS), stockage.js (makeStore).
   ========================================================================= */

const MAX_ERREURS = 3;
// Temps cible par ligne de grille : réussir sans erreur et sous ce temps = grille « facile »
// pour le joueur, qui passe alors au niveau suivant (il ne redescend jamais).
const SECONDES_PAR_LIGNE = { 1: 15, 2: 20, 3: 25, 4: 30, 5: 35, 6: 40 };
const DOUBLE_TAP_MS = 350;
const ZONE_COLORS = [
  '#F6C1C1', '#BFE3C6', '#F9DFA5', '#BCD4F2', '#E3C8EE', '#FBD0A8',
  '#B9E6E3', '#E6E6A8', '#D7C9B5', '#F2C3DE', '#C7D3B0', '#CFCBEF',
];

const $ = (id) => document.getElementById(id);
const store = makeStore();

let profil = null;     // { pseudo, niveau, theme }
let game = null;       // ligne de la partie en cours (stockage)
let puzzle = null;     // grille (generatePuzzle)
let st = null;         // { marks, cats, bad: Set, errors, elapsed, over }
let images = null;     // dessin de chaque ligne (tous différents)

/* ------------------------------ Utilitaires ------------------------------ */
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function targetMs(p) { return p.size * SECONDES_PAR_LIGNE[p.targetLevel] * 1000; }
function themePool() { return ILLUSTRATIONS[profil && profil.theme === 'chien' ? 'chien' : 'chat']; }
function animal(n = 1) { return (profil && profil.theme === 'chien' ? 'chien' : 'chat') + (n > 1 ? 's' : ''); }

function problem(msg) {
  let el = $('problem');
  if (!el) {
    el = document.createElement('div');
    el.id = 'problem'; el.className = 'banner'; el.style.background = '#FBE3E0'; el.style.color = '#8A1F14';
    document.body.insertBefore(el, document.body.children[1]);
  }
  el.textContent = msg;
  el.hidden = !msg;
}

/* ------------------------------ Génération (tâche de fond) ------------------------------ */
let worker = null, reqId = 0;
const waiting = new Map();
try {
  worker = new Worker('worker.js?v=1');
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

/* ------------------------------ Chronomètre ------------------------------ */
let runningSince = null, tickTimer = null;
function elapsedNow() { return st ? st.elapsed + (runningSince ? performance.now() - runningSince : 0) : 0; }
function clockStart() {
  if (!st || st.over || runningSince || document.hidden) return;
  runningSince = performance.now();
  if (!tickTimer) tickTimer = setInterval(showClock, 250);
}
function clockStop() {
  if (runningSince) { st.elapsed += performance.now() - runningSince; runningSince = null; }
  showClock();
}
function showClock() {
  if (!st) return;
  const t = elapsedNow();
  $('clock').textContent = fmtTime(t);
  $('goal').classList.toggle('missed', st.errors > 0 || t > targetMs(puzzle));
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
  const pool = themePool();
  images = imageOrder(puzzle.seed, n, pool.length).map((k) => pool[k]);
  for (let i = 0; i < n * n; i++) renderCell(i);
  board.classList.toggle('over', st.over);
}

function renderCell(i, opts = {}) {
  const el = $('board').children[i];
  if (!el) return;
  const r = Math.floor(i / puzzle.size);
  el.classList.toggle('x', st.marks.has(i));
  el.classList.toggle('bad', st.bad.has(i));
  const showCat = st.cats.has(i) || (opts.hint && puzzle.solution[r] === i % puzzle.size);
  el.classList.toggle('cat', st.cats.has(i));
  el.classList.toggle('hint', !st.cats.has(i) && !!opts.hint && showCat);
  el.innerHTML = showCat ? catSvg(images[r]) : '';
}

function renderLives() {
  $('lives').innerHTML = Array.from({ length: MAX_ERREURS }, (_, k) =>
    `<span class="${k < MAX_ERREURS - st.errors ? '' : 'lost'}">❤️</span>`).join('');
  $('lives').title = `${MAX_ERREURS - st.errors} erreur(s) encore permise(s)`;
}

function renderStatus() {
  const lv = puzzle.targetLevel;
  $('levelNum').textContent = lv;
  $('levelName').textContent = LEVELS[lv].label;
  const next = profil.niveau < MAX_LEVEL
    ? `pour passer au niveau ${profil.niveau + 1}`
    : '(niveau maximum)';
  $('goal').textContent = `Objectif : sans erreur en moins de ${fmtTime(targetMs(puzzle))} ${next}`;
  renderLives();
  showClock();
}

/* ------------------------------ Gestes : croix, glisser, double-clic ------------------------------ */
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
    // Double-clic : on annule la croix posée par le premier clic, puis on pose un chat.
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
  lastTap = { i: -1, t: 0, before: false };   // un glissé n'est pas un double-clic
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
    if (st.cats.size === n) return finish(true);
  } else {
    st.errors++;
    st.bad.add(i);
    renderCell(i);
    renderLives();
    showClock();
    if (st.errors >= MAX_ERREURS) return finish(false);
  }
  saveNow();
}

async function finish(won) {
  clockStop();
  st.over = true;
  $('board').classList.add('over');
  const t = st.elapsed, lv = puzzle.targetLevel;
  const facile = won && st.errors === 0 && t <= targetMs(puzzle);
  let levelMsg = '';
  if (facile && profil.niveau < MAX_LEVEL && lv === profil.niveau) {
    profil.niveau++;
    levelMsg = `Grille facile pour toi : tu passes au niveau ${profil.niveau} (${LEVELS[profil.niveau].label}) !`;
    try { await store.updateProfile({ niveau: profil.niveau }); } catch (e) { problem('Niveau non enregistré : ' + e.message); }
  } else if (facile) {
    levelMsg = 'Sans erreur et dans le temps, au niveau maximum : chapeau !';
  }
  await saveNow({ resultat: won ? 'gagnee' : 'perdue', facile, finie_le: new Date().toISOString() });

  if (won) {
    $('endTitle').textContent = 'Bravo !';
    $('endText').textContent = `Grille résolue en ${fmtTime(t)} avec ${st.errors} erreur${st.errors > 1 ? 's' : ''}.` +
      (facile ? '' : ` Pour progresser : aucune erreur et moins de ${fmtTime(targetMs(puzzle))}.`);
  } else {
    // Solution montrée en transparence.
    for (let r = 0; r < puzzle.size; r++) renderCell(r * puzzle.size + puzzle.solution[r], { hint: true });
    $('endTitle').textContent = 'Perdu…';
    $('endText').textContent = `${MAX_ERREURS} erreurs : la grille est perdue. Tu restes au niveau ${profil.niveau}.`;
  }
  $('endLevel').textContent = levelMsg;
  $('endLevel').hidden = !levelMsg;
  $('endDialog').hidden = false;
  renderStats();
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
  const niveau = profil.niveau;
  const graine = 1 + Math.floor(Math.random() * 2147483646);
  const taille = Math.min(themePool().length, randomSizeFor(niveau, graine));
  try {
    const p = await loadPuzzle(taille, niveau, graine);
    game = await store.startGame({ niveau, taille, graine, theme: profil.theme });
    begin(p, null);
    saveNow();
  } catch (e) { problem('Impossible de préparer la grille : ' + e.message); }
}

async function resume(row) {
  game = row;
  try {
    const p = await loadPuzzle(row.taille, row.niveau, Number(row.graine));
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
  for (const g of p.givens) st.cats.add(g);         // chats donnés, toujours présents
  renderBoard();
  renderStatus();
  clockStart();
}

$('nextGrid').addEventListener('click', newGrid);
$('giveUp').addEventListener('click', async () => {
  if (!st || st.over) return newGrid();
  if (!confirm('Abandonner cette grille ? Elle ne compte ni comme gagnée ni comme perdue.')) return;
  clockStop();
  st.over = true;
  await saveNow({ resultat: 'abandon', finie_le: new Date().toISOString() });
  newGrid();
});

/* ------------------------------ Thème, profil, statistiques ------------------------------ */
function renderTheme() {
  const chien = profil.theme === 'chien';
  $('themeChat').classList.toggle('on', !chien);
  $('themeChien').classList.toggle('on', chien);
  $('brand').textContent = chien ? 'Sudodog' : 'Sudocat';
  document.title = (chien ? 'Sudodog' : 'Sudocat') + ' · gamestof.fr';
}
async function setTheme(t) {
  if (profil.theme === t) return;
  profil.theme = t;
  renderTheme();
  if (puzzle && st) {
    if (themePool().length < puzzle.size) problem(`Pas assez de dessins de ${animal(2)} pour cette grille.`);
    else { renderBoard(); if (st.over && st.errors >= MAX_ERREURS) for (let r = 0; r < puzzle.size; r++) renderCell(r * puzzle.size + puzzle.solution[r], { hint: true }); }
  }
  try { await store.updateProfile({ theme: t }); } catch (e) { problem('Thème non enregistré : ' + e.message); }
}
$('themeChat').addEventListener('click', () => setTheme('chat'));
$('themeChien').addEventListener('click', () => setTheme('chien'));

async function renderStats() {
  try {
    const s = await store.stats();
    $('stats').innerHTML =
      `<div><b>${profil.niveau}</b><span>niveau</span></div>` +
      `<div><b>${s.jouees}</b><span>grilles jouées</span></div>` +
      `<div><b>${s.gagnees}</b><span>réussies</span></div>` +
      `<div><b>${s.faciles}</b><span>sans faute dans le temps</span></div>`;
  } catch (e) { problem(e.message); }
}

/* ------------------------------ Connexion ------------------------------ */
let authMode = 'login';
function showAuth(mode) {
  authMode = mode;
  $('gameScreen').hidden = true; $('who').hidden = true; $('authScreen').hidden = false;
  $('authTitle').textContent = { login: 'Connexion', signup: 'Créer un compte', reset: 'Mot de passe oublié' }[mode];
  $('authIntro').textContent = mode === 'reset'
    ? 'Indique ton email : tu recevras un lien pour choisir un nouveau mot de passe.'
    : 'Crée un compte pour enregistrer ta progression.';
  $('pseudoField').hidden = mode !== 'signup';
  $('authPseudo').required = mode === 'signup';
  $('passwordField').hidden = mode === 'reset';
  $('authPassword').required = mode !== 'reset';
  $('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('authSubmit').textContent = { login: 'Se connecter', signup: 'Créer mon compte', reset: 'Envoyer le lien' }[mode];
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

$('logout').addEventListener('click', async () => {
  if (st && !st.over) { clockStop(); await saveNow(); }
  await store.signOut();
  profil = game = puzzle = st = null;
  showAuth('login');
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
  profil = await store.profile();
  $('authScreen').hidden = true;
  $('gameScreen').hidden = false;
  $('who').hidden = false;
  $('pseudo').textContent = profil.pseudo;
  renderTheme();
  renderStats();
  const row = await store.currentGame();
  if (row) await resume(row); else await newGrid();
}

(async function init() {
  if (window.SUDOCAT_SUPABASE_URL && !window.supabase) {
    problem('Connexion au serveur impossible (bibliothèque Supabase non chargée). Vérifie ta connexion puis recharge la page.');
    return;
  }
  $('localBanner').hidden = !store.local;
  try {
    if (await store.user()) await enterGame(); else showAuth('login');
  } catch (e) { problem(e.message); showAuth('login'); }
})();
