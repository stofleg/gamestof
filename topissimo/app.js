// ============================================================
//  Scrabble Club — front statique + Supabase
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY ||
    window.SUPABASE_URL.includes("xxxx")) {
  $("#configError").hidden = false;
  $("#configError").innerHTML =
    "<strong>Config manquante.</strong> Crée un fichier <code>config.js</code> à côté de <code>index.html</code> (voir <code>SETUP.md</code>).";
  throw new Error("Supabase config missing");
}

const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// Service worker (PWA installable) + AUTO-MISE-À-JOUR.
// À chaque chargement, on force la vérification d'une nouvelle version du SW.
// Version attendue du cache SW — doit correspondre à CACHE dans sw.js.
// Si le cache actif du navigateur ne correspond pas, on force la mise à jour
// immédiatement au chargement de la page.
const EXPECTED_SW_CACHE = "garenna-v168";

let _swReg = null;   // référence globale pour ensureFreshAndNavigate()
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      _swReg = reg;
      // 1) Vérifier si le cache actif est à jour ; sinon forcer la mise à jour
      if (typeof caches !== "undefined") {
        caches.keys().then(keys => {
          if (!keys.includes(EXPECTED_SW_CACHE)) reg.update();
        }).catch(() => {});
      }
      // 2) Check immédiat systématique
      reg.update();
      // 3) Re-check toutes les 5 min si l'onglet reste ouvert
      setInterval(() => reg.update(), 5 * 60 * 1000);
      // 4) Quand un nouveau SW prend le contrôle → reload pour récupérer le neuf
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      // 5) Si un nouveau SW est en attente (installé mais pas activé) → activate now
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
    } catch (e) { /* silencieux */ }
  });
}

// Vérifie qu'on a la dernière version du SW avant d'ouvrir une partie.
// Si une mise à jour est disponible ou en cours, on l'applique (skipWaiting)
// et on attend que le nouveau SW prenne le contrôle AVANT de naviguer.
// Délai max : 3 s (évite de bloquer si le réseau est lent).
async function ensureFreshAndNavigate(url) {
  try {
    const reg = _swReg || await navigator.serviceWorker.getRegistration();
    if (!reg) { location.href = url; return; }

    const applyAndGo = (sw) => new Promise(resolve => {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        resolve();
      }, { once: true });
      sw.postMessage({ type: "SKIP_WAITING" });
    });

    // Cas 1 : un nouveau SW est déjà en attente → l'activer puis naviguer
    if (reg.waiting) {
      await Promise.race([applyAndGo(reg.waiting), new Promise(r => setTimeout(r, 3000))]);
      location.href = url;
      return;
    }

    // Cas 2 : vérifier s'il y a une mise à jour disponible (max 3 s)
    const updateReady = new Promise(resolve => {
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) { resolve(null); return; }
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed") resolve(sw);
        });
      }, { once: true });
    });
    await reg.update();
    const newSw = await Promise.race([updateReady, new Promise(r => setTimeout(() => r(null), 3000))]);
    if (newSw) {
      await Promise.race([applyAndGo(newSw), new Promise(r => setTimeout(r, 2000))]);
    }
  } catch (e) { /* silencieux */ }
  location.href = url;
}

// Détection mode app (Chrome standalone/fullscreen/minimal-ui, Safari home-screen)
function detectAppMode() {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true;     // iOS
  document.body.classList.toggle("app-mode", isStandalone);
}
detectAppMode();
window.matchMedia("(display-mode: standalone)").addEventListener?.("change", detectAppMode);
window.matchMedia("(display-mode: fullscreen)").addEventListener?.("change", detectAppMode);

const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

const state = {
  players: [],
  currentPlayerId: localStorage.getItem("currentPlayerId") || null,
  selectedGameId: null,
  lastRanking: [],   // pour export CSV
  lastRankingMeta: {},
};

// ============================================================
//  Helpers
// ============================================================

function isoDate(d) { return d.toISOString().slice(0,10); }
function today() { return new Date().toISOString().slice(0,10); }

function periodBounds(period, ref) {
  if (period === "session") {
    return [ref, ref]; // soirée = la date de référence
  }
  const r = new Date(ref + "T00:00:00");
  if (period === "week") {
    const day = (r.getDay() + 6) % 7;
    const start = new Date(r); start.setDate(r.getDate() - day);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return [isoDate(start), isoDate(end)];
  }
  if (period === "month") {
    const start = new Date(r.getFullYear(), r.getMonth(), 1);
    const end = new Date(r.getFullYear(), r.getMonth() + 1, 0);
    return [isoDate(start), isoDate(end)];
  }
  if (period === "year") {
    return [`${r.getFullYear()}-01-01`, `${r.getFullYear()}-12-31`];
  }
  return ["1900-01-01", "2999-12-31"];
}

// Format seconds → "M:SS" ou "—"
function fmtTime(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2,"0")}`;
}

// Parse user input → seconds. Accepte "4:30", "4.5", "270"
function parseTime(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (s.includes(":")) {
    const [m, sec] = s.split(":").map(Number);
    if (isNaN(m) || isNaN(sec)) return null;
    return m * 60 + sec;
  }
  const num = parseFloat(s.replace(",", "."));
  if (isNaN(num)) return null;
  return Math.round(num * 60); // décimal en minutes
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function initials(name) {
  return name.split(/\s+/).map(w => w[0]).slice(0,2).join("").toUpperCase();
}

// ============================================================
//  Tabs
// ============================================================
$$("nav button").forEach(b => b.onclick = () => {
  $$("nav button").forEach(x => x.classList.toggle("active", x === b));
  $$(".tab").forEach(s => s.hidden = s.dataset.tab !== b.dataset.tab);
  // Quitter le tab "prepared" → oublier le tournoi sélectionné (retour à la liste au retour)
  if (b.dataset.tab !== "prepared") currentTournamentId = null;
  if (b.dataset.tab === "ranking") loadRanking();
  if (b.dataset.tab === "games") loadMyGames();
  if (b.dataset.tab === "stats") loadClubStats();
  if (b.dataset.tab === "prepared") loadPreparedGames();
  if (b.dataset.tab === "mystats") loadMyStats();
});

// ============================================================
//  Joueurs
// ============================================================
async function loadPlayers() {
  const { data, error } = await sb.from("players").select("*").order("name");
  if (error) return alert(error.message);
  state.players = data;

  // compter parties jouées par joueur (encore utilisé pour l'onglet Joueurs si présent)
  const { data: counts } = await sb.from("results").select("player_id");
  const byPlayer = {};
  (counts || []).forEach(r => byPlayer[r.player_id] = (byPlayer[r.player_id] || 0) + 1);

  const tbody = $("#playersBody");
  if (tbody) {
    tbody.innerHTML = data.map(p =>
      `<tr class="clickable" onclick="openPlayerModal(${p.id})">
         <td><strong>${escapeHtml(p.name)}</strong></td>
         <td>${byPlayer[p.id] || 0}</td>
         <td onclick="event.stopPropagation()"><button class="danger" onclick="delPlayer(${p.id})">supprimer</button></td>
       </tr>`
    ).join("") || `<tr><td colspan="3" class="muted">Aucun joueur.</td></tr>`;
  }
}

// ============================================================
//  Parties
// ============================================================
// ===== Mes parties (tournoi + entraînement) =====
async function loadMyGames() {
  if (!state.currentPlayerId) return;
  const pid = +state.currentPlayerId;
  const { modeDisplayName } = await import("./scrabble/engine.js");

  // Tournoi : prepared_game_results jointes avec prepared_games
  const { data: tour } = await sb.from("prepared_game_results")
    .select("*, prepared_games(id,name,mode,with_joker)")
    .eq("player_id", pid)
    .order("finished_at", { ascending: false })
    .limit(30);

  const btnRev = (id, type) => `<a style="text-decoration:none;padding:5px 10px;border-radius:6px;background:var(--soft);color:var(--petrol);font-weight:600;font-size:.82rem" href="scrabble/game.html?${type}=${id}">👁 Revoir</a>`;

  $("#myTournoiBody").innerHTML = (tour || []).map(r => {
    const g = r.prepared_games;
    if (!g) return "";
    const md = modeDisplayName(g.mode, g.with_joker);
    return `<tr>
      <td>${(r.finished_at || "").slice(0,10)}</td>
      <td><strong>${escapeHtml(g.name)}</strong></td>
      <td>${md}</td>
      <td>${r.total_score}</td>
      <td class="neg">${r.sum_neg}</td>
      <td>${fmtSec(r.total_time_seconds)}</td>
      <td>${btnRev(g.id, "review")}
        <button class="danger" onclick="delMyTournoi(${r.id})">supprimer</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="muted">Aucune partie tournoi jouée.</td></tr>`;

  // Entraînement
  const { data: train } = await sb.from("training_games")
    .select("*").eq("player_id", pid)
    .order("created_at", { ascending: false }).limit(30);

  $("#myTrainingBody").innerHTML = (train || []).map(t => {
    const md = modeDisplayName(t.mode, t.with_joker);
    return `<tr>
      <td>${(t.created_at || "").slice(0,10)}</td>
      <td>${md}</td>
      <td>${t.total_score}</td>
      <td class="neg">${t.sum_neg}</td>
      <td>${fmtSec(t.total_time_seconds)}</td>
      <td>${btnRev(t.id, "training")}
        <button class="danger" onclick="delMyTraining(${t.id})">supprimer</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">Aucun entraînement.</td></tr>`;
}

function fmtSec(s) {
  if (!s) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

window.delMyTournoi = async function(resultId) {
  if (!confirm("Supprimer ce résultat de ton historique ? (Ne supprime PAS la partie elle-même ni ton score au classement)")) return;
  await sb.from("prepared_game_results").delete().eq("id", resultId);
  loadMyGames();
};
window.delMyTraining = async function(id) {
  if (!confirm("Supprimer cet entraînement de ton historique ?")) return;
  await sb.from("training_games").delete().eq("id", id);
  loadMyGames();
};

// ============================================================
//  Mes stats personnelles (Phase H — onglet dédié)
// ============================================================
async function loadMyStats() {
  const body = $("#myStatsBody");
  if (!state.currentPlayerId) { body.innerHTML = `<p class="muted">Connecte-toi.</p>`; return; }
  const pid = +state.currentPlayerId;

  body.innerHTML = `<p class="muted">⏳ Calcul…</p>`;
  const { modeDisplayName } = await import("./scrabble/engine.js");

  // 1) Toutes mes parties tournoi (avec détails)
  const { data: tour } = await sb.from("prepared_game_results")
    .select("*, prepared_games(id,name,mode,with_joker,created_at,time_per_move)")
    .eq("player_id", pid);

  // 2) Tous mes entraînements
  const { data: train } = await sb.from("training_games").select("*").eq("player_id", pid);

  // 3) Mes résultats championnat (pour cohérence avec le classement)
  const { data: champ } = await sb.from("results")
    .select("*, games(top_score)").eq("player_id", pid);

  if ((tour || []).length === 0 && (train || []).length === 0) {
    body.innerHTML = `<p class="muted">Aucune partie jouée pour l'instant. Lance une partie ou un entraînement !</p>`;
    return;
  }

  // ===== Agrégats tournoi =====
  const tourGames = (tour || []).length;
  const tourScore = (tour || []).reduce((a, r) => a + (r.total_score || 0), 0);
  const tourNeg = (tour || []).reduce((a, r) => a + (r.sum_neg || 0), 0);
  const tourTime = (tour || []).reduce((a, r) => a + (r.total_time_seconds || 0), 0);
  // Meilleur temps tournoi : on EXCLUT les parties abandonnées
  const isAbandoned = h => Array.isArray(h) && h.length > 0 && h[0]?.abandonedGame === true;
  const bestTourTime = Math.min(
    ...(tour || [])
      .filter(r => r.total_time_seconds && !isAbandoned(r.details))
      .map(r => r.total_time_seconds),
    Infinity
  );

  // ===== Agrégats entraînement =====
  const trainGames = (train || []).length;
  const trainScore = (train || []).reduce((a, r) => a + r.total_score, 0);
  const trainNeg = (train || []).reduce((a, r) => a + r.sum_neg, 0);
  const trainTime = (train || []).reduce((a, r) => a + (r.total_time_seconds || 0), 0);
  // Meilleur temps entraînement : EXCLUT les parties abandonnées
  const bestTrainTime = Math.min(
    ...(train || [])
      .filter(r => r.total_time_seconds && !isAbandoned(r.history))
      .map(r => r.total_time_seconds),
    Infinity
  );

  // ===== Streak inter-parties tournoi =====
  const tourSorted = [...(tour || [])].sort((a, b) => {
    const da = a.prepared_games?.created_at || a.finished_at || "";
    const db = b.prepared_games?.created_at || b.finished_at || "";
    return da.localeCompare(db);
  });
  let cur = 0, maxStreak = 0;
  for (const r of tourSorted) {
    for (const m of (r.details || []).sort((a, b) => a.moveNo - b.moveNo)) {
      if (m.status === "top") { cur++; if (cur > maxStreak) maxStreak = cur; }
      else cur = 0;
    }
  }

  // ===== Solos =====
  // Mes coups où j'ai topé seul. On a besoin des autres résultats des mêmes games.
  let mySolos = 0;
  if (tour && tour.length) {
    const gameIds = [...new Set(tour.map(r => r.prepared_game_id))];
    const { data: allResults } = await sb.from("prepared_game_results")
      .select("player_id, prepared_game_id, details").in("prepared_game_id", gameIds);
    const byGame = {};
    for (const r of allResults || []) (byGame[r.prepared_game_id] ||= []).push(r);
    for (const rs of Object.values(byGame)) {
      const topsByMove = {};
      for (const r of rs) for (const h of (r.details || [])) {
        if (h.status === "top") (topsByMove[h.moveNo] ||= []).push(r.player_id);
      }
      for (const ids of Object.values(topsByMove)) {
        if (ids.length === 1 && ids[0] === pid) mySolos++;
      }
    }
  }

  // ===== Coups au top sur l'ensemble =====
  let topsCount = 0, allMoves = 0;
  for (const r of tour || []) {
    for (const m of (r.details || [])) {
      allMoves++;
      if (m.status === "top") topsCount++;
    }
  }
  for (const t of train || []) {
    for (const m of (t.history || [])) {
      allMoves++;
      if (m.status === "top") topsCount++;
    }
  }
  const topsPct = allMoves ? (topsCount / allMoves * 100).toFixed(1) : "—";

  // ===== Meilleurs scores sur 1 partie =====
  const bestTourScore = Math.max(0, ...(tour || []).map(r => r.total_score));
  const bestTrainScore = Math.max(0, ...(train || []).map(r => r.total_score));

  const fmtT = (s) => !isFinite(s) || !s ? "—" : `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  const fmtTLong = (s) => !s ? "—" : `${Math.floor(s/60)} min`;

  body.innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="label">Parties tournoi</div><div class="value">${tourGames}</div></div>
      <div class="stat"><div class="label">Entraînements</div><div class="value">${trainGames}</div></div>
      <div class="stat"><div class="label">% de tops trouvés</div><div class="value">${topsPct}%</div></div>
      <div class="stat"><div class="label">Solos en tournoi</div><div class="value">${mySolos}</div></div>
    </div>

    <h2 style="margin-top:20px">🏆 Tournois</h2>
    <div class="tournament-stats-grid">
      <div class="t-stat-card">
        <h3>Score total</h3>
        <p style="margin:0;font-size:1.4rem;font-weight:700;color:var(--petrol-dark)">${tourScore}</p>
      </div>
      <div class="t-stat-card">
        <h3>Σ négatifs cumulés</h3>
        <p style="margin:0;font-size:1.4rem;font-weight:700" class="neg">${tourNeg}</p>
      </div>
      <div class="t-stat-card">
        <h3>Meilleure partie</h3>
        <p style="margin:0;font-size:1.4rem;font-weight:700;color:var(--petrol-dark)">${bestTourScore}</p>
      </div>
      <div class="t-stat-card">
        <h3>⏱ Meilleur temps</h3>
        <p style="margin:0;font-size:1.4rem;font-weight:700;color:var(--petrol-dark)">${fmtT(bestTourTime)}</p>
      </div>
    </div>

    <h2 style="margin-top:20px">🔥 Plus longue série de tops</h2>
    <p style="font-size:1.6rem;font-family:'Fraunces',serif;font-weight:700;color:var(--petrol-dark);margin:6px 0">
      ${maxStreak} coup${maxStreak > 1 ? 's' : ''} consécutif${maxStreak > 1 ? 's' : ''}
    </p>
    <p class="muted" style="margin-top:-4px">Calculé en continu sur toutes tes parties tournoi (du plus ancien au plus récent).</p>

    <h2 style="margin-top:20px">🎯 Entraînement</h2>
    <div class="tournament-stats-grid">
      <div class="t-stat-card">
        <h3>Score total</h3>
        <p style="margin:0;font-size:1.4rem;font-weight:700;color:var(--petrol-dark)">${trainScore}</p>
      </div>
      <div class="t-stat-card">
        <h3>Σ négatifs cumulés</h3>
        <p style="margin:0;font-size:1.4rem;font-weight:700" class="neg">${trainNeg}</p>
      </div>
      <div class="t-stat-card">
        <h3>Meilleure partie</h3>
        <p style="margin:0;font-size:1.4rem;font-weight:700;color:var(--petrol-dark)">${bestTrainScore}</p>
      </div>
      <div class="t-stat-card">
        <h3>⏱ Meilleur temps</h3>
        <p style="margin:0;font-size:1.4rem;font-weight:700;color:var(--petrol-dark)">${fmtT(bestTrainTime)}</p>
      </div>
    </div>
  `;
}

// ============================================================
//  Classement
// ============================================================
if ($("#rkRef")) {
  $("#rkRef").value = today();
  ["rkPeriod", "rkRef", "rkMode"].forEach(id => $("#" + id).onchange = loadRanking);
  $("#rkPeriod").addEventListener("change", () => {
    const lab = $("#rkRefWrap label");
    if ($("#rkPeriod").value === "session") lab.textContent = "Date de la soirée";
    else lab.textContent = "Date de référence";
  });
}

async function loadRanking() {
  const period = $("#rkPeriod").value;
  const ref = $("#rkRef").value || today();
  const [start, end] = periodBounds(period, ref);

  const { data: games, error: gErr } = await sb.from("games").select("*")
    .gte("played_on", start).lte("played_on", end);
  if (gErr) return alert(gErr.message);
  const gameIds = (games || []).map(g => g.id);

  const periodLabel = {
    session: `Soirée du ${ref}`,
    week: `Semaine du ${start} au ${end}`,
    month: `Mois de ${start.slice(0,7)}`,
    year: `Année ${start.slice(0,4)}`,
    all: "Tout l'historique",
  }[period];
  $("#rkPeriodLabel").textContent = `${periodLabel} — ${gameIds.length} partie(s)`;

  if (gameIds.length === 0) {
    $("#rkStats").innerHTML = "";
    $("#podiumWrap").innerHTML = "";
    $("#rkBody").innerHTML = `<tr><td colspan="8" class="muted">Aucune partie sur cette période.</td></tr>`;
    state.lastRanking = [];
    return;
  }

  const { data: resultsRaw, error: rErr } = await sb.from("results")
    .select("*, players(name)")
    .in("game_id", gameIds);
  if (rErr) return alert(rErr.message);
  const results = excludeAdminRows(resultsRaw);

  const gameById = Object.fromEntries(games.map(g => [g.id, g]));
  const byGame = {};
  for (const r of results || []) (byGame[r.game_id] ||= []).push(r);

  const stats = {};
  for (const [gid, rows] of Object.entries(byGame)) {
    const g = gameById[gid];
    const sorted = [...rows].sort((a,b) => b.score - a.score);
    sorted.forEach((r, rank) => {
      const s = stats[r.player_id] ||= {
        id: r.player_id, name: r.players.name,
        games: 0, sum_neg: 0, points: 0, sum_pct: 0,
        missed: 0, time: 0, time_count: 0,
      };
      s.games++;
      s.sum_neg += r.score - g.top_score;
      s.points += rank < POINTS.length ? POINTS[rank] : 0;
      if (g.top_score > 0) s.sum_pct += 100 * r.score / g.top_score;
      s.missed += r.missed_moves || 0;
      if (r.time_seconds) { s.time += r.time_seconds; s.time_count++; }
    });
  }

  const list = Object.values(stats).map(s => ({
    ...s,
    avg_pct: s.games ? +(s.sum_pct / s.games).toFixed(2) : 0,
    avg_time: s.time_count ? Math.round(s.time / s.time_count) : null,
  }));

  const mode = $("#rkMode").value;
  if (mode === "sum_neg") list.sort((a,b) => b.sum_neg - a.sum_neg);
  else if (mode === "points") list.sort((a,b) => b.points - a.points);
  else list.sort((a,b) => b.avg_pct - a.avg_pct);

  state.lastRanking = list;
  state.lastRankingMeta = { period: periodLabel, start, end };

  renderRankingStats(list, results, gameIds.length);
  renderPodium(list, mode);

  const me = +state.currentPlayerId || 0;
  $("#rkBody").innerHTML = list.map((p, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    return `
    <tr class="${p.id === me ? 'me' : ''} clickable" onclick="openPlayerModal(${p.id})">
      <td><span class="rank-badge ${rankClass}">${i+1}</span></td>
      <td><strong>${escapeHtml(p.name)}</strong>${p.id === me ? ' <span class="muted">(toi)</span>' : ''}</td>
      <td>${p.games}</td>
      <td class="neg">${p.sum_neg}</td>
      <td><strong>${p.points}</strong></td>
      <td>${p.avg_pct}%</td>
      <td>${p.missed}</td>
      <td>${fmtTime(p.avg_time)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="muted">Aucun résultat.</td></tr>`;
}

function renderRankingStats(list, allResults, nbGames) {
  if (!list.length) { $("#rkStats").innerHTML = ""; return; }
  const totalPlayers = list.length;
  const bestScore = Math.max(...allResults.map(r => r.score));
  const bestPlayer = allResults.find(r => r.score === bestScore);
  const clubAvgPct = (list.reduce((a,p) => a + p.avg_pct * p.games, 0) /
                     list.reduce((a,p) => a + p.games, 0)).toFixed(1);
  $("#rkStats").innerHTML = `
    <div class="stat"><div class="label">Parties</div><div class="value">${nbGames}</div></div>
    <div class="stat"><div class="label">Joueurs</div><div class="value">${totalPlayers}</div></div>
    <div class="stat"><div class="label">Meilleur score</div><div class="value">${bestScore}</div><div class="muted" style="font-size:.75rem">${escapeHtml(bestPlayer.players.name)}</div></div>
    <div class="stat"><div class="label">% moyen club</div><div class="value">${clubAvgPct}%</div></div>
  `;
}

function renderPodium(list, mode) {
  const wrap = $("#podiumWrap");
  if (!list.length) { wrap.innerHTML = ""; return; }
  const top3 = list.slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const order = [1, 0, 2];
  const valueOf = p => mode === "sum_neg" ? p.sum_neg
                    : mode === "points"  ? p.points
                    : p.avg_pct + "%";
  const labelOf = () => mode === "sum_neg" ? "Σ négatifs"
                    : mode === "points"  ? "points"
                    : "% moyen";

  wrap.innerHTML = `
    <div class="podium">
      ${order.map(i => {
        const p = top3[i];
        if (!p) return `<div></div>`;
        const cls = i === 0 ? "p1" : i === 1 ? "p2" : "p3";
        return `
          <div class="podium-spot ${cls} clickable" onclick="openPlayerModal(${p.id})">
            <div class="podium-medal">${medals[i]}</div>
            <div class="podium-name">${escapeHtml(p.name)}</div>
            <div class="podium-score ${mode==='sum_neg' ? 'neg' : ''}">${valueOf(p)}</div>
            <div class="podium-meta">${labelOf()} · ${p.games} partie${p.games>1?'s':''}</div>
          </div>`;
      }).join("")}
    </div>`;
}

// ============================================================
//  Export CSV
// ============================================================
if ($("#rkExport")) $("#rkExport").onclick = () => {
  if (!state.lastRanking.length) return alert("Rien à exporter.");
  const headers = ["Rang","Joueur","Parties","Somme négatifs","Points","% moyen","Coups ratés","Temps moyen (s)"];
  const rows = state.lastRanking.map((p, i) => [
    i+1, p.name, p.games, p.sum_neg, p.points, p.avg_pct, p.missed, p.avg_time || ""
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); // BOM pour Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeLabel = (state.lastRankingMeta.period || "classement").replace(/[^a-z0-9]+/gi, "_");
  a.href = url;
  a.download = `garenna_${safeLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ============================================================
//  Modal détail joueur
// ============================================================
window.openPlayerModal = async function(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  const { data: rows } = await sb.from("results")
    .select("*, games(played_on, session_no, game_no, top_score, notes)")
    .eq("player_id", playerId);

  const sorted = (rows || []).map(r => ({
    ...r,
    neg: r.score - r.games.top_score,
    pct: r.games.top_score > 0 ? 100 * r.score / r.games.top_score : 0,
    date: r.games.played_on,
  })).sort((a,b) => a.date.localeCompare(b.date) || a.games.session_no - b.games.session_no || a.games.game_no - b.games.game_no);

  if (!sorted.length) {
    $("#playerModalBody").innerHTML = `
      <div class="player-header">
        <div class="player-avatar">${initials(player.name)}</div>
        <div><div class="player-name">${escapeHtml(player.name)}</div></div>
      </div>
      <p class="muted">Aucune partie enregistrée pour ce joueur.</p>`;
    $("#playerModal").hidden = false;
    return;
  }

  const totalGames = sorted.length;
  const avgPct = (sorted.reduce((a,r) => a + r.pct, 0) / totalGames).toFixed(1);
  const bestScore = Math.max(...sorted.map(r => r.score));
  const bestNeg = Math.max(...sorted.map(r => r.neg));
  const sumNeg = sorted.reduce((a,r) => a + r.neg, 0);
  const avgScore = Math.round(sorted.reduce((a,r) => a + r.score, 0) / totalGames);
  const sumMissed = sorted.reduce((a,r) => a + (r.missed_moves||0), 0);

  // Sparkline du % par partie
  const pcts = sorted.map(r => r.pct);
  const W = 600, H = 80, P = 8;
  const minY = Math.min(60, Math.min(...pcts));
  const maxY = 100;
  const x = i => P + (i / Math.max(1, pcts.length - 1)) * (W - 2*P);
  const y = v => H - P - ((v - minY) / (maxY - minY)) * (H - 2*P);
  const linePath = pcts.map((v,i) => `${i?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(pcts.length-1).toFixed(1)},${H-P} L${x(0).toFixed(1)},${H-P} Z`;
  const dots = pcts.map((v,i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3"/>`).join("");

  $("#playerModalBody").innerHTML = `
    <div class="player-header">
      <div class="player-avatar">${initials(player.name)}</div>
      <div>
        <div class="player-name">${escapeHtml(player.name)}</div>
        <div class="muted">${totalGames} partie${totalGames>1?'s':''} jouée${totalGames>1?'s':''}</div>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="label">% moyen</div><div class="value">${avgPct}%</div></div>
      <div class="stat"><div class="label">Score moyen</div><div class="value">${avgScore}</div></div>
      <div class="stat"><div class="label">Meilleur score</div><div class="value">${bestScore}</div></div>
      <div class="stat"><div class="label">Meilleure partie</div><div class="value">${bestNeg}</div></div>
      <div class="stat"><div class="label">Σ négatifs</div><div class="value neg">${sumNeg}</div></div>
      <div class="stat"><div class="label">Coups ratés</div><div class="value">${sumMissed}</div></div>
    </div>

    <h2 style="margin-top:20px">Évolution du % du top</h2>
    <svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line class="axis" x1="${P}" y1="${y(100).toFixed(1)}" x2="${W-P}" y2="${y(100).toFixed(1)}"/>
      <path class="area" d="${areaPath}"/>
      <path class="line" d="${linePath}"/>
      ${dots}
    </svg>

    <h2 style="margin-top:20px">Dernières parties</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>S.</th><th>P.</th><th>Score</th><th>Top</th><th>Négatif</th><th>%</th><th>Temps</th></tr></thead>
        <tbody>
          ${[...sorted].reverse().slice(0, 20).map(r => `
            <tr>
              <td>${r.date}</td>
              <td>${r.games.session_no}</td>
              <td>${r.games.game_no}</td>
              <td><strong>${r.score}</strong></td>
              <td>${r.games.top_score}</td>
              <td class="neg">${r.neg}</td>
              <td>${r.pct.toFixed(1)}%</td>
              <td>${fmtTime(r.time_seconds)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
  $("#playerModal").hidden = false;
};
window.closePlayerModal = () => $("#playerModal").hidden = true;
document.addEventListener("keydown", e => { if (e.key === "Escape") closePlayerModal(); });

// ============================================================
//  Stats du club
// ============================================================
async function loadClubStats() {
  await loadSolosAndStreaks();
}

async function loadSolosAndStreaks() {
  const { data: detailedRaw } = await sb.from("prepared_game_results")
    .select("player_id, prepared_game_id, total_time_seconds, finished_at, details, players(name), prepared_games(id,name,mode,with_joker,time_per_move,created_at)")
    .limit(5000);
  const detailed = excludeAdminRows(detailedRaw);
  if (!detailed || detailed.length === 0) {
    $("#recordsGrid").innerHTML = `<p class="muted">Pas encore de parties tournoi.</p>`;
    return;
  }

  const me = +state.currentPlayerId || 0;
  const fmtT = (s) => !s ? "—" : `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  // (Les solos rejouables sont désormais dans les Records du tournoi concerné,
  //  pas dans les Stats du club.)

  // ===== STREAK INTER-PARTIES =====
  // Pour chaque joueur : concaténer tous ses coups dans l'ordre chronologique (par created_at de la partie puis moveNo),
  // puis trouver la plus longue série de "top" consécutifs.
  const byPlayer = {};
  for (const r of detailed) {
    (byPlayer[r.player_id] ||= { name: r.players?.name || "?", id: r.player_id, entries: [] })
      .entries.push({
        gameDate: r.finished_at || r.prepared_games?.created_at || "1970-01-01",
        gameName: r.prepared_games?.name || "?",
        moves: (r.details || []).sort((a, b) => a.moveNo - b.moveNo),
      });
  }
  const streaks = [];
  for (const p of Object.values(byPlayer)) {
    // Trier les parties par date
    p.entries.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
    let cur = 0, max = 0;
    for (const e of p.entries) {
      for (const m of e.moves) {
        if (m.status === "top") { cur++; if (cur > max) max = cur; }
        else cur = 0;
      }
    }
    if (max > 0) streaks.push({ player_id: p.id, name: p.name, length: max });
  }
  streaks.sort((a, b) => b.length - a.length);

  // ===== Meilleurs temps sur une partie =====
  const timeRecs = detailed
    .filter(r => r.total_time_seconds)
    .map(r => ({
      player_id: r.player_id, name: r.players?.name || "?",
      time: r.total_time_seconds,
      gameName: r.prepared_games?.name || "?",
    }))
    .sort((a, b) => a.time - b.time);

  // ===== Affichage Records all-time (top 5 par catégorie) =====
  const renderRow = (p, val) => `
    <li class="${p.player_id === me ? 'me' : ''}">
      <strong onclick="openPlayerModal(${p.player_id})" style="cursor:pointer">${escapeHtml(p.name)}</strong>
      <span style="float:right">${val}</span>
    </li>`;
  $("#recordsGrid").innerHTML = `
    <div class="t-stat-card">
      <h3>🔥 Plus longue série de coups au top</h3>
      <ol>${streaks.slice(0, 5).map(s => renderRow(s, `${s.length} coup${s.length>1?'s':''}`)).join("") || '<li class="muted">—</li>'}</ol>
    </div>
    <div class="t-stat-card">
      <h3>⏱ Partie la plus rapide</h3>
      <ol>${timeRecs.slice(0, 5).map(r => renderRow(r, fmtT(r.time))).join("") || '<li class="muted">—</li>'}</ol>
    </div>`;
}

// ============================================================
//  Tournois + Parties pré-tirées (Phase E)
// ============================================================

let currentTournamentId = null;

async function loadPreparedGames() {
  // Si on est dans la vue détail d'un tournoi, recharger ce tournoi
  if (currentTournamentId) return loadTournamentDetail(currentTournamentId);
  return loadTournaments();
}

const MAX_ACTIVE_TOURNAMENTS = 10;

// ===== Présence temps réel (qui est connecté / en jeu) =====
let presenceChannel = null;
function startPresence(playerId) {
  if (presenceChannel || !playerId) return;
  presenceChannel = sb.channel("online", { config: { presence: { key: String(playerId) } } });
  presenceChannel.on("presence", { event: "sync" }, renderPresence);
  presenceChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await presenceChannel.track({ id: +playerId, context: "site", at: Date.now() });
    }
  });
}
function renderPresence() {
  if (!isAdmin()) return;
  const card = $("#presenceCard");
  const body = $("#presenceBody");
  if (!card || !body) return;
  const pres = presenceChannel ? presenceChannel.presenceState() : {};
  const me = +state.currentPlayerId || 0;
  const rows = Object.entries(pres).map(([key, metas]) => {
    const id = +key;
    const name = (state.players || []).find(p => p.id === id)?.name || `#${id}`;
    const inGame = metas.some(m => m.context === "jeu");
    return { id, name, inGame };
  }).sort((a, b) => (b.inGame - a.inGame) || a.name.localeCompare(b.name, "fr"));
  card.hidden = false;
  body.innerHTML = rows.length
    ? `<div style="display:flex;flex-direction:column;gap:6px">${rows.map(r => `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:9px;height:9px;border-radius:50%;background:${r.inGame ? '#e67e22' : '#2c7a3b'};flex:0 0 auto"></span>
          <strong>${escapeHtml(r.name)}</strong>${r.id === me ? ' <span class="muted">(toi)</span>' : ''}
          <span class="muted" style="margin-left:auto;font-size:.82rem">${r.inGame ? '🎮 en jeu' : 'sur le site'}</span>
        </div>`).join("")}</div>
       <p class="muted" style="margin-top:8px;font-size:.78rem">${rows.some(r => r.inGame) ? '⚠️ Des joueurs sont en partie — évite de déployer une mise à jour maintenant.' : 'Aucun joueur en partie.'}</p>`
    : `<p class="muted">Personne d'autre connecté pour l'instant.</p>`;
}

async function loadTournaments() {
  $("#tournamentsView").hidden = false;
  $("#tournamentDetailView").hidden = true;
  $("#tournamentFormCard").hidden = !isAdmin();
  if (isAdmin()) renderPresence(); else { const c = $("#presenceCard"); if (c) c.hidden = true; }

  const { data: tournaments, error } = await sb.from("tournaments")
    .select("*").is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    $("#tournamentsBody").innerHTML = `<tr><td colspan="4" class="muted">Erreur : ${error.message}<br>As-tu exécuté <code>schema-tournaments-archive.sql</code> ?</td></tr>`;
    return;
  }
  // Compter les parties par tournoi
  const ids = (tournaments || []).map(t => t.id);
  let countsByT = {};
  if (ids.length) {
    const { data: counts } = await sb.from("prepared_games").select("tournament_id").in("tournament_id", ids);
    (counts || []).forEach(p => countsByT[p.tournament_id] = (countsByT[p.tournament_id] || 0) + 1);
  }

  $("#tournamentsBody").innerHTML = (tournaments || []).map(t => `
    <tr class="clickable" onclick="openTournament(${t.id})">
      <td>${(t.created_at || "").slice(0,10)}</td>
      <td><strong>${escapeHtml(t.name)}</strong></td>
      <td>${countsByT[t.id] || 0}</td>
      <td>${isAdmin() ? `<button class="danger" onclick="event.stopPropagation();archiveTournament(${t.id})">archiver</button>` : ""}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="muted">${isAdmin() ? "Aucun tournoi actif. Crée-en un ci-dessus." : "Aucun tournoi disponible."}</td></tr>`;
}

// Archiver le plus ancien tournoi tant qu'on dépasse la limite
async function autoArchiveOldest() {
  const { data: active } = await sb.from("tournaments")
    .select("id").is("archived_at", null)
    .order("created_at", { ascending: false });
  const toArchive = (active || []).slice(MAX_ACTIVE_TOURNAMENTS);
  if (toArchive.length === 0) return;
  await sb.from("tournaments").update({ archived_at: new Date().toISOString() })
    .in("id", toArchive.map(t => t.id));
}

window.openTournament = async (id) => {
  currentTournamentId = id;
  // Refléter le tournoi ouvert dans l'URL (sans déclencher hashchange) pour que
  // le bouton "précédent" du navigateur revienne ici après un rejeu/une partie.
  if (location.hash !== `#tid=${id}`) history.replaceState(null, "", `#tid=${id}`);
  await loadTournamentDetail(id);
};
window.backToTournaments = async () => {
  currentTournamentId = null;
  history.replaceState(null, "", location.pathname);
  await loadTournaments();
};
window.archiveTournament = async (id) => {
  if (!confirm("Archiver ce tournoi ? Il disparaît de la liste mais les scores, l'historique et les replays restent accessibles.")) return;
  const { error } = await sb.from("tournaments").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) return alert(error.message);
  loadTournaments();
};
window.delCurrentTournament = () => archiveTournament(currentTournamentId).then(() => backToTournaments());

// Purge complète : supprime le tournoi, ses parties, tous les résultats associés,
// ET le mirroir championnat (table games + results).
window.purgeTournament = async (id) => {
  const ok1 = confirm("⚠️ Purger ce tournoi DÉFINITIVEMENT ?\n\nToutes les parties, tous les résultats, et leurs scores au classement seront perdus.\n\nUtile pour effacer un tournoi de test sans polluer les statistiques.");
  if (!ok1) return;
  const ok2 = confirm("Vraiment sûr ? Cette action est IRRÉVERSIBLE.");
  if (!ok2) return;

  // 1) Récupérer les ids des prepared_games du tournoi
  const { data: games } = await sb.from("prepared_games").select("id").eq("tournament_id", id);
  const gameIds = (games || []).map(g => g.id);

  // 2) Supprimer le mirroir championnat (games + results en cascade)
  //    convention : session_no = 1000 + prepared_game.id, game_no = 1
  if (gameIds.length) {
    const sessionNos = gameIds.map(gid => 1000 + gid);
    const { error: gErr } = await sb.from("games").delete().in("session_no", sessionNos);
    if (gErr) console.warn("Suppression games championnat :", gErr.message);
  }

  // 3) Supprimer les prepared_games (cascade sur prepared_game_results)
  if (gameIds.length) {
    const { error: pErr } = await sb.from("prepared_games").delete().in("id", gameIds);
    if (pErr) { alert("Suppression parties : " + pErr.message); return; }
  }

  // 4) Supprimer le tournoi
  const { error: tErr } = await sb.from("tournaments").delete().eq("id", id);
  if (tErr) { alert("Suppression tournoi : " + tErr.message); return; }

  alert("Tournoi purgé.");
};
window.purgeCurrentTournament = () => purgeTournament(currentTournamentId).then(() => backToTournaments());

async function loadTournamentDetail(tournamentId) {
  // Déclencher une vérification SW silencieuse en arrière-plan dès l'entrée dans un tournoi.
  if (_swReg) _swReg.update().catch(() => {});
  $("#tournamentsView").hidden = true;
  $("#tournamentDetailView").hidden = false;
  $("#pgFormCard").hidden = !isAdmin();
  $("#adminToolsCard").hidden = !isAdmin();
  $("#tournamentDelete").hidden = !isAdmin();
  $("#tournamentPurge").hidden = !isAdmin();

  const { data: t } = await sb.from("tournaments").select("*").eq("id", tournamentId).maybeSingle();
  if (!t) { backToTournaments(); return; }
  $("#tournamentDetailTitle").textContent = `🏟 ${t.name}`;

  const { data: gamesRaw, error } = await sb.from("prepared_games")
    .select("id,name,mode,with_joker,time_per_move,created_at")
    .eq("tournament_id", tournamentId);
  if (error) return alert(error.message);
  // Tri naturel par nom : "Partie 2" < "Partie 10" (au lieu de l'ordre lexico ou chrono).
  // Fallback : si même prefix → ordre chronologique de création.
  const games = (gamesRaw || []).slice().sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return cmp;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });

  // Pré-remplir le nom par défaut "Partie N+1" pour ce tournoi
  const nums = (games || []).map(g => {
    const m = g.name.match(/^Partie (\d+)$/);
    return m ? +m[1] : 0;
  });
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  $("#pgName").placeholder = `Partie ${next}`;
  $("#pgName").value = $("#pgName").value || `Partie ${next}`;

  // Parties déjà jouées par le joueur courant
  // → "jouée" = result présent ET détail coup par coup non vide (sinon c'est
  //   un résultat importé sans partie réelle, donc rien à revoir).
  const playedIds = new Set();
  if (state.currentPlayerId) {
    const { data: results } = await sb.from("prepared_game_results")
      .select("prepared_game_id,details").eq("player_id", +state.currentPlayerId);
    (results || []).forEach(r => {
      const hasDetails = Array.isArray(r.details) && r.details.length > 0;
      if (hasDetails) playedIds.add(r.prepared_game_id);
    });
  }

  const { modeDisplayName } = await import("./scrabble/engine.js");
  const btnStyle = "text-decoration:none;padding:5px 10px;border-radius:6px;font-weight:600;font-size:.85rem";
  const admin = isAdmin();
  $("#pgBody").innerHTML = (games || []).length === 0
    ? `<p class="muted">${admin ? "Aucune partie. Génère-en une." : "Aucune partie disponible."}</p>`
    : `<div class="pg-mini-list">${(games || []).map(g => {
        const played = playedIds.has(g.id);
        const action = played
          ? `<a style="${btnStyle};background:var(--soft);color:var(--petrol)" href="scrabble/game.html?review=${g.id}&tid=${currentTournamentId}">👁 Revoir</a>`
          : `<button style="${btnStyle};background:var(--yellow);color:var(--petrol-dark);border:none;cursor:pointer" onclick="ensureFreshAndNavigate('scrabble/game.html?prepared=${g.id}&tid=${currentTournamentId}')">▶ Jouer</button>`;
        const del = admin ? `<button class="danger" onclick="delPreparedGame(${g.id})" title="Supprimer">🗑</button>` : "";
        return `<div class="pg-mini">
          <div class="pg-name">${escapeHtml(g.name)}</div>
          <div class="pg-meta">${modeDisplayName(g.mode, g.with_joker)} · ${g.time_per_move ? g.time_per_move + 's' : 'illimité'}</div>
          <div class="pg-actions">${action} ${del}</div>
        </div>`;
      }).join("")}</div>`;

  loadTournamentStats(tournamentId, games || []);
  loadTournamentLeaderboard(tournamentId, games || []);
}

// ===== Classement complet par tournoi (Std / Blitz / Originales) =====
function categorize(g) {
  if (g.with_joker) return "orig";
  // Blitz : soit le mode explicite "blitz", soit une partie Normal générée à
  // 60 s/coup (cas historique où le blitz n'était qu'un réglage de temps).
  if (g.mode === "blitz") return "blitz";
  if (g.mode === "duplicate") return Number(g.time_per_move) === 60 ? "blitz" : "std";
  return "orig";
}
const CAT_LABEL = { std: "Standard", blitz: "Blitz", orig: "Originales" };
const CAT_CLASS = { std: "cat-std", blitz: "cat-blitz", orig: "cat-orig" };

async function loadTournamentLeaderboard(tournamentId, games) {
  const body = $("#tournamentLeaderboardBody");
  if (!games.length) { body.innerHTML = `<p class="muted">Pas encore de partie.</p>`; return; }

  // Trier les parties par catégorie + tri naturel par nom (Partie 2 < Partie 10)
  const cats = { std: [], blitz: [], orig: [] };
  for (const g of games) cats[categorize(g)].push(g);
  for (const k of Object.keys(cats)) {
    cats[k].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" });
      return cmp !== 0 ? cmp : (a.created_at || "").localeCompare(b.created_at || "");
    });
  }
  const gameIds = games.map(g => g.id);

  const { data: resultsRaw } = await sb.from("prepared_game_results")
    .select("player_id, prepared_game_id, total_score, sum_neg, total_time_seconds, details, played_on_mobile, players(name)")
    .in("prepared_game_id", gameIds);
  const results = excludeAdminRows(resultsRaw);
  if (!results || results.length === 0) { body.innerHTML = `<p class="muted">Aucun résultat enregistré.</p>`; return; }

  // Index resultats : player_id -> game_id -> result
  const byPlayer = {};
  for (const r of results) {
    if (!byPlayer[r.player_id]) byPlayer[r.player_id] = {
      id: r.player_id, name: r.players?.name || `#${r.player_id}`,
      perGame: {},
    };
    const missed = (r.details || []).filter(h => h.status === "giveup" || h.status === "timeout").length;
    byPlayer[r.player_id].perGame[r.prepared_game_id] = {
      neg: r.sum_neg, time: r.total_time_seconds || 0, missed,
      details: r.details || [],
      totalScore: r.total_score || 0,
      mobile: !!r.played_on_mobile,
    };
  }
  const players = Object.values(byPlayer);

  // Calculer les totaux par catégorie + global
  for (const p of players) {
    p.byCat = { std: { neg: 0, time: 0, missed: 0, count: 0 },
                blitz: { neg: 0, time: 0, missed: 0, count: 0 },
                orig: { neg: 0, time: 0, missed: 0, count: 0 } };
    for (const g of games) {
      const r = p.perGame[g.id];
      if (!r) continue;
      const c = p.byCat[categorize(g)];
      c.neg += r.neg; c.time += r.time; c.missed += r.missed; c.count++;
    }
    p.total = {
      neg: p.byCat.std.neg + p.byCat.blitz.neg + p.byCat.orig.neg,
      time: p.byCat.std.time + p.byCat.blitz.time + p.byCat.orig.time,
      missed: p.byCat.std.missed + p.byCat.blitz.missed + p.byCat.orig.missed,
      count: p.byCat.std.count + p.byCat.blitz.count + p.byCat.orig.count,
    };
  }

  // Calcul des rangs : par catégorie (par neg DESC car neg ≤ 0) + global
  function rank(getKey, asc = false) {
    const ranks = {};
    const sorted = [...players].sort((a, b) => {
      const va = getKey(a), vb = getKey(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return asc ? va - vb : vb - va;
    });
    sorted.forEach((p, i) => ranks[p.id] = i + 1);
    return ranks;
  }
  // ----- Complétude & rangs : un rang chiffré n'est attribué qu'aux joueurs
  //       ayant TERMINÉ l'ensemble concerné (toutes les parties pour le
  //       général ; toutes les parties de la catégorie pour chaque bloc). -----
  const rankAmong = (eligible, getVal, asc = false) => {
    const ranks = {};
    eligible.slice().sort((a, b) => asc ? getVal(a) - getVal(b) : getVal(b) - getVal(a))
      .forEach((p, i) => ranks[p.id] = i + 1);
    return ranks;
  };
  const completeGeneral = (p) => games.length > 0 && p.total.count === games.length;
  const completeCat = (p, c) => cats[c].length > 0 && p.byCat[c].count === cats[c].length;

  const genEligible = players.filter(completeGeneral);
  const rankTotalNeg    = rankAmong(genEligible, p => p.total.neg);
  const rankTotalTime   = rankAmong(genEligible, p => p.total.time, true);
  const rankTotalMissed = rankAmong(genEligible, p => p.total.missed, true);
  const rankByCat = {};
  for (const c of ["std", "blitz", "orig"]) {
    rankByCat[c] = rankAmong(players.filter(p => completeCat(p, c)), p => p.byCat[c].neg);
  }

  const me = +state.currentPlayerId || 0;
  const fmtT = (s) => !s ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const rankClass = (r) => r === 1 ? "gold" : r === 2 ? "silver" : r === 3 ? "bronze" : "";
  const orderedCats = ["std", "blitz", "orig"].filter(c => cats[c].length > 0);

  // Contexte pour les modales feuille de route joueur
  const myGameIds = new Set(results.filter(r => r.player_id === me).map(r => r.prepared_game_id));
  window._lbCtx = { games, byPlayer, myGameIds };

  // Liste affichée : les classés (triés par rang) + le joueur courant en plus
  // s'il n'est pas classé (rang "–"), pour qu'il puisse se situer.
  const displayList = (ranks, eligible) => {
    const list = eligible.slice().sort((a, b) => (ranks[a.id] || 1e9) - (ranks[b.id] || 1e9));
    if (me && !list.some(p => p.id === me) && byPlayer[me]) list.push(byPlayer[me]);
    return list;
  };

  const expandHtml = (p) => {
    let html = `<div class="expand-inner"><table>
      <thead><tr><th>Catégorie</th><th>Partie</th><th>Négatif</th><th>Temps</th><th>Loupés</th><th></th></tr></thead><tbody>`;
    for (const c of orderedCats) cats[c].forEach((g) => {
      const r = p.perGame[g.id];
      // Picto 📱 si la partie a été jouée sur mobile.
      const mobileIcon = r && r.mobile ? ` <span title="Jouée sur mobile" style="font-size:.9em">📱</span>` : "";
      // Bouton feuille de route : seulement si CE joueur a joué la partie ET que
      // l'utilisateur courant l'a aussi jouée (sinon on dévoilerait une partie
      // non encore jouée par l'utilisateur).
      let sheetBtn = "";
      if (r) {
        if (myGameIds.has(g.id)) {
          sheetBtn = `<button class="btn ghost small" style="font-size:.75rem;padding:3px 8px;font-weight:500" onclick="event.stopPropagation();openPlayerGameSheet('${p.id}', '${g.id}')">📋 Feuille de route</button>`;
        } else {
          sheetBtn = `<span class="muted" style="font-size:.78rem" title="Joue d'abord cette partie pour voir sa feuille de route">🔒</span>`;
        }
      }
      html += `<tr><td>${CAT_LABEL[c]}</td><td>${escapeHtml(g.name)}</td><td class="neg">${r ? r.neg : "—"}</td><td>${r ? fmtT(r.time) + mobileIcon : "—"}</td><td>${r ? r.missed : "—"}</td><td style="text-align:right">${sheetBtn}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    return html;
  };

  // ===== Constructeurs de lignes =====
  const genRowFn = (p) => {
    const gr = rankTotalNeg[p.id];
    let row = `<tr class="${p.id === me ? 'me' : ''}" onclick="toggleLbRow(this)" data-pid="${p.id}">
      <td class="rank ${rankClass(gr)}">${gr || "–"}</td>
      <td class="player-name"><span class="player-name-link">${escapeHtml(p.name)}</span></td>`;
    for (const c of orderedCats) {
      const cd = p.byCat[c];
      if (cd.count === 0) { row += `<td class="cat-cell muted">—</td>`; continue; }
      const cr = rankByCat[c][p.id];
      row += `<td class="cat-cell"><span class="cat-neg">${cd.neg}</span><span class="cat-rank">${cr ? "rang " + cr : "—"}</span></td>`;
    }
    row += `<td><strong>${p.total.neg || 0}</strong></td>
            <td>${fmtT(p.total.time)}</td>
            <td>${p.total.missed}</td>
            <td class="rank ${rankClass(rankTotalTime[p.id])}">${rankTotalTime[p.id] || "–"}</td>
            <td class="rank ${rankClass(rankTotalMissed[p.id])}">${rankTotalMissed[p.id] || "–"}</td></tr>`;
    row += `<tr class="expand-row" hidden><td colspan="${5 + orderedCats.length}">${expandHtml(p)}</td></tr>`;
    return row;
  };
  const catRowFn = (c) => (p) => {
    const cd = p.byCat[c];
    const cr = rankByCat[c][p.id];
    const played = cd.count > 0;
    return `<tr class="${p.id === me ? 'me' : ''}" onclick="toggleLbRow(this)" data-pid="${p.id}">
      <td class="rank ${rankClass(cr)}">${cr || "–"}</td>
      <td class="player-name"><span class="player-name-link">${escapeHtml(p.name)}</span></td>
      <td><strong>${played ? cd.neg : "—"}</strong></td>
      <td>${played ? fmtT(cd.time) : "—"}</td></tr>
      <tr class="expand-row" hidden><td colspan="4">${expandHtml(p)}</td></tr>`;
  };

  // ===== En-têtes triables (data-sort) =====
  const th = (key, label, extra = "") => `<th data-sort="${key}" style="cursor:pointer"${extra}>${label}<span class="lb-arrow"></span></th>`;
  let genHeader = `<thead><tr>${th("rank", "#")}${th("name", "Joueur")}`;
  for (const c of orderedCats) genHeader += th("cat_" + c, `${CAT_LABEL[c]}<br><small style="font-weight:400;text-transform:none">${cats[c].length} partie${cats[c].length > 1 ? 's' : ''}</small>`);
  genHeader += `${th("sumNeg", "∑ Nég.")}${th("sumTime", "∑ Temps")}${th("sumMiss", "∑ Loupés")}${th("rankT", "R-T", ' title="Rang temps"')}${th("rankL", "R-L", ' title="Rang loupés"')}</tr></thead>`;
  const catHeader = `<thead><tr>${th("rank", "#")}${th("name", "Joueur")}${th("catNeg", "∑ Négatif")}${th("catTime", "∑ Temps")}</tr></thead>`;

  // ===== Accesseurs de tri =====
  const genCols = {
    rank:    p => rankTotalNeg[p.id] || 1e9,
    name:    p => p.name.toLowerCase(),
    sumNeg:  p => -(p.total.neg || 0),
    sumTime: p => p.total.time || 1e12,
    sumMiss: p => p.total.missed || 0,
    rankT:   p => rankTotalTime[p.id] || 1e9,
    rankL:   p => rankTotalMissed[p.id] || 1e9,
  };
  for (const c of orderedCats) genCols["cat_" + c] = p => p.byCat[c].count ? -(p.byCat[c].neg || 0) : 1e9;
  const catCols = (c) => ({
    rank:    p => rankByCat[c][p.id] || 1e9,
    name:    p => p.name.toLowerCase(),
    catNeg:  p => p.byCat[c].count ? -(p.byCat[c].neg || 0) : 1e9,
    catTime: p => p.byCat[c].time || 1e12,
  });

  // ===== Panneaux =====
  const catMeta = { std: "Parties standard", blitz: "Parties blitz", orig: "Parties originales" };
  const panels = [{
    k: "gen", label: "Classement général", header: genHeader, rowFn: genRowFn, cols: genCols,
    list: displayList(rankTotalNeg, genEligible), colspan: 5 + orderedCats.length,
    empty: "Aucun joueur n'a encore terminé toutes les parties.",
  }];
  for (const c of ["std", "blitz", "orig"]) {
    if (!cats[c].length) continue;
    panels.push({
      k: c, label: catMeta[c], header: catHeader, rowFn: catRowFn(c), cols: catCols(c),
      list: displayList(rankByCat[c], players.filter(pp => completeCat(pp, c))), colspan: 4,
      empty: "Aucun joueur n'a encore terminé ce bloc.",
    });
  }
  const panelTable = (pn) => `<table class="lb-compact">${pn.header}<tbody>${
    pn.list.map(pn.rowFn).join("") || `<tr><td colspan="${pn.colspan}" class="muted">${pn.empty}</td></tr>`
  }</tbody></table>`;

  const tabBase = "padding:7px 13px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--ink-soft);font-weight:600;font-size:.85rem;cursor:pointer";
  const tabActive = "padding:7px 13px;border:none;border-bottom:2px solid var(--petrol);background:transparent;color:var(--petrol);font-weight:700;font-size:.85rem;cursor:pointer";

  body.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid rgba(0,0,0,.08);margin-bottom:10px">${
      panels.map((pn, i) => `<button data-lbtab="${pn.k}" style="${i === 0 ? tabActive : tabBase}">${pn.label}</button>`).join("")
    }</div>
    ${panels.map((pn, i) => `<div data-lbpanel="${pn.k}" style="display:${i === 0 ? 'block' : 'none'}">${panelTable(pn)}</div>`).join("")}
    <p class="muted" style="margin-top:8px;font-size:.78rem">Rang attribué après avoir terminé l'ensemble · clique sur une colonne pour trier · clique sur un joueur pour le détail.</p>`;

  // Bascule d'onglets
  body.querySelectorAll("button[data-lbtab]").forEach(btn => {
    btn.onclick = () => {
      const k = btn.dataset.lbtab;
      body.querySelectorAll("button[data-lbtab]").forEach(b => b.setAttribute("style", b === btn ? tabActive : tabBase));
      body.querySelectorAll("div[data-lbpanel]").forEach(pan => pan.style.display = pan.dataset.lbpanel === k ? "block" : "none");
    };
  });

  // Tri par clic sur en-tête (indépendant par panneau)
  const sortState = {};
  for (const pn of panels) {
    const panelEl = body.querySelector(`div[data-lbpanel="${pn.k}"]`);
    if (!panelEl) continue;
    panelEl.querySelectorAll("th[data-sort]").forEach(thEl => {
      thEl.onclick = () => {
        const key = thEl.dataset.sort;
        const st = sortState[pn.k] || { key: "rank", dir: "asc" };
        if (st.key === key) st.dir = st.dir === "asc" ? "desc" : "asc";
        else { st.key = key; st.dir = "asc"; }
        sortState[pn.k] = st;
        const get = pn.cols[key];
        const sorted = pn.list.slice().sort((a, b) => {
          const va = get(a), vb = get(b);
          if (va < vb) return st.dir === "asc" ? -1 : 1;
          if (va > vb) return st.dir === "asc" ? 1 : -1;
          return 0;
        });
        panelEl.querySelector("tbody").innerHTML = sorted.map(pn.rowFn).join("");
        panelEl.querySelectorAll("th[data-sort] .lb-arrow").forEach(s => s.textContent = "");
        const arrow = panelEl.querySelector(`th[data-sort="${key}"] .lb-arrow`);
        if (arrow) arrow.textContent = st.dir === "asc" ? " ▲" : " ▼";
      };
    });
  }
}

window.toggleLbRow = function(tr) {
  const next = tr.nextElementSibling;
  if (next?.classList.contains("expand-row")) next.hidden = !next.hidden;
};

// ===== Stats agrégées par tournoi (Phase F) =====
async function loadTournamentStats(tournamentId, games) {
  const body = $("#tournamentStatsBody");
  if (!games.length) { body.innerHTML = `<p class="muted">Pas encore de partie dans ce tournoi.</p>`; return; }

  const gameIds = games.map(g => g.id);
  const { data: resultsRaw } = await sb.from("prepared_game_results")
    .select("*, players(name)").in("prepared_game_id", gameIds);
  const results = excludeAdminRows(resultsRaw);

  if (!results || results.length === 0) {
    body.innerHTML = `<p class="muted">Aucun joueur n'a encore terminé une partie de ce tournoi.</p>`;
    return;
  }

  // === Aggréger par joueur ===
  const byPlayer = {};
  for (const r of results) {
    const pid = r.player_id;
    if (!byPlayer[pid]) byPlayer[pid] = {
      id: pid, name: r.players?.name || `#${pid}`,
      games: 0, sumNeg: 0, sumTime: 0,
      bestSingleTime: Infinity,
      solos: 0,
      results: [],
    };
    const p = byPlayer[pid];
    p.games++;
    p.sumNeg += r.sum_neg;
    // Pour le meilleur temps individuel : on EXCLUT les parties abandonnées
    const isAbandoned = Array.isArray(r.details) && r.details.length > 0 && r.details[0]?.abandonedGame === true;
    if (r.total_time_seconds) {
      p.sumTime += r.total_time_seconds;
      if (!isAbandoned) {
        p.bestSingleTime = Math.min(p.bestSingleTime, r.total_time_seconds);
      }
    }
    p.results.push(r);
  }

  // === Calcul des solos joueurs + solos ordinateur ===
  const byGame = {};
  for (const r of results) (byGame[r.prepared_game_id] ||= []).push(r);
  const soloList = [];         // solos joueurs  : { gid, moveNo, pid }
  const computerSoloList = []; // solos ordinateur : { gid, moveNo, gameName }
  const gameMap = Object.fromEntries(games.map(g => [g.id, g]));
  for (const [gid, rs] of Object.entries(byGame)) {
    const finishers = new Set(rs.filter(r => Array.isArray(r.details) && r.details.length).map(r => r.player_id));
    if (finishers.size < 2) continue;
    // Construire map moveNo → liste de player_ids ayant top
    const topsByMove = {};
    // Aussi collecter tous les moveNos joués (pour détecter absence de top)
    const allMoveNos = new Set();
    for (const r of rs) {
      for (const h of (r.details || [])) {
        allMoveNos.add(h.moveNo);
        if (h.status === "top") {
          (topsByMove[h.moveNo] ||= []).push(r.player_id);
        }
      }
    }
    // Solos joueurs : un seul joueur a trouvé le top
    for (const [moveNo, list] of Object.entries(topsByMove)) {
      if (list.length === 1) {
        const pid = list[0];
        if (byPlayer[pid]) byPlayer[pid].solos++;
        soloList.push({ gid: +gid, moveNo: +moveNo, pid });
      }
    }
    // Solos ordinateur : aucun joueur n'a trouvé le top
    const gameName = gameMap[+gid]?.name || `#${gid}`;
    for (const moveNo of allMoveNos) {
      if (!topsByMove[moveNo]) {
        computerSoloList.push({ gid: +gid, moveNo: +moveNo, gameName });
      }
    }
  }
  // Trier par partie puis numéro de coup
  computerSoloList.sort((a, b) => a.gid - b.gid || a.moveNo - b.moveNo);

  const players = Object.values(byPlayer);
  const me = +state.currentPlayerId || 0;
  const fmtT = (s) => !isFinite(s) || !s ? "—" : `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  // Top-N pour chaque critère
  const topN = (arr, n = 3, key, asc = false) => {
    const sorted = [...arr].sort((a, b) => asc ? a[key] - b[key] : b[key] - a[key]);
    return sorted.slice(0, n).filter(p => p[key] != null && isFinite(p[key]) && p[key] !== 0 || key === "sumNeg");
  };

  const renderRow = (p, val) => `
    <li class="${p.id === me ? 'me' : ''}">
      <strong>${escapeHtml(p.name)}</strong>
      <span style="float:right">${val}</span>
    </li>`;

  // Solos : sous chaque pseudo, un bouton "Rejouer" par solo (coup trouvé seul).
  // Styles inline (comme le bouton "Jouer") pour être insensible au cache CSS.
  // Le rejeu n'est cliquable que si le joueur courant a DÉJÀ joué la partie
  // correspondante (sinon on spoile une partie non encore jouée).
  const myPlayedGames = new Set(
    results.filter(r => r.player_id === me && Array.isArray(r.details) && r.details.length)
           .map(r => r.prepared_game_id));
  const _soloBtnStyle = "display:inline-block;text-decoration:none;padding:5px 12px;border-radius:6px;font-weight:600;font-size:.85rem;background:var(--yellow);color:var(--petrol-dark);white-space:nowrap";
  const _soloBtnDisabled = "display:inline-block;padding:5px 12px;border-radius:6px;font-weight:600;font-size:.85rem;background:#e6e9eb;color:#9aa6ac;white-space:nowrap;cursor:not-allowed";
  const soloReplayBtn = (gid, moveNo) => {
    if (!myPlayedGames.has(gid)) {
      return `<span style="${_soloBtnDisabled}" title="Joue d'abord cette partie pour pouvoir la rejouer">↻ Rejouer</span>`;
    }
    return `<a style="${_soloBtnStyle}" href="scrabble/game.html?puzzle=${gid}&move=${moveNo}&tid=${currentTournamentId}">↻ Rejouer</a>`;
  };
  const solosByPlayer = {};
  for (const s of soloList) (solosByPlayer[s.pid] ||= []).push(s);
  for (const k in solosByPlayer) solosByPlayer[k].sort((a, b) => a.gid - b.gid || a.moveNo - b.moveNo);
  const cardSolos = `
    <h3>🏆 Solos</h3>
    <ul style="list-style:none;padding:0;margin:0">${
      topN(players, 5, "solos").map((p, i) => `
        <li style="padding:6px 0;border-bottom:1px solid rgba(0,0,0,.06)${p.id === me ? ';color:var(--petrol)' : ''}">
          <div style="display:flex;align-items:baseline;gap:6px">
            <span style="color:var(--ink-soft)">${i + 1}.</span>
            <strong style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</strong>
            <span style="color:var(--ink-soft)">${p.solos}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0 16px">${(solosByPlayer[p.id] || []).map(s => soloReplayBtn(s.gid, s.moveNo)).join("")}</div>
        </li>`).join("") || '<li class="muted">Aucun solo pour l\'instant</li>'
    }</ul>`;
  // Solos ordinateur : regroupés par partie pour l'affichage
  const csByGame = {};
  for (const s of computerSoloList) (csByGame[s.gid] ||= { gid: s.gid, gameName: s.gameName, moves: [] }).moves.push(s.moveNo);
  const cardComputerSolos = `
    <h3>🤖 Solos ordinateur</h3>
    ${
    computerSoloList.length === 0
      ? `<p class="muted">✅ Aucun — tous les tops ont été trouvés !</p>`
      : `<ul style="list-style:none;padding:0;margin:0">${
          Object.values(csByGame).map(g => `
            <li style="padding:6px 0;border-bottom:1px solid rgba(0,0,0,.06)">
              <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px">
                <strong style="flex:1">${escapeHtml(g.gameName.replace(/^(Partie\s+\d+).*$/i, '$1'))}</strong>
                <span style="color:var(--ink-soft)">${g.moves.length} coup${g.moves.length > 1 ? 's' : ''}</span>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-left:16px">${
                g.moves.map(moveNo => soloReplayBtn(g.gid, moveNo)).join("")
              }</div>
            </li>`).join("")
        }</ul>`
    }`;
  const cardBestTime = `
    <h3>⏱ Meilleur temps sur une partie</h3>
    <ol>${topN(players.filter(p => isFinite(p.bestSingleTime)), 5, "bestSingleTime", true).map(p => renderRow(p, fmtT(p.bestSingleTime))).join("") || '<li class="muted">—</li>'}</ol>`;
  const cardCumulTime = `
    <h3>⌛ Meilleur temps cumulé</h3>
    <ol>${topN(players.filter(p => p.sumTime > 0 && p.games === games.length), 5, "sumTime", true).map(p => renderRow(p, fmtT(p.sumTime))).join("") || '<li class="muted">Aucun joueur n\'a fait toutes les parties</li>'}</ol>`;
  const cardCumulNeg = `
    <h3>📉 Meilleur négatif cumulé</h3>
    <ol>${topN(players.filter(p => p.games === games.length), 5, "sumNeg").map(p => renderRow(p, p.sumNeg)).join("") || '<li class="muted">Aucun joueur n\'a fait toutes les parties</li>'}</ol>`;

  // ===== HALL OF SHAME =====
  for (const p of players) {
    p.invalidCount = 0;
    for (const r of (p.results || []))
      for (const m of (r.details || [])) p.invalidCount += (m.invalidCount || 0);
  }
  const antiCount = {};
  for (const [, rs] of Object.entries(byGame)) {
    if (rs.length < 2) continue;
    const topsByMv = {};
    for (const r of rs) {
      for (const h of (r.details || [])) {
        (topsByMv[h.moveNo] ||= { tops: new Set(), all: new Set() }).all.add(r.player_id);
        if (h.status === "top") topsByMv[h.moveNo].tops.add(r.player_id);
      }
    }
    for (const d of Object.values(topsByMv)) {
      if (d.all.size < 2) continue;
      const missed = [...d.all].filter(pid => !d.tops.has(pid));
      if (missed.length === 1) antiCount[missed[0]] = (antiCount[missed[0]] || 0) + 1;
    }
  }
  for (const p of players) p.antiSolos = antiCount[p.id] || 0;
  for (const p of players) {
    const ts = (p.results || [])
      .filter(r => r.total_time_seconds > 0 && !(Array.isArray(r.details) && r.details[0]?.abandonedGame))
      .map(r => r.total_time_seconds);
    p.worstSingleTime = ts.length ? Math.max(...ts) : 0;
  }
  // Scrabbles ratés : un coup où le TOP était un scrabble (le joueur aurait pu
  // poser tous ses jetons et toucher la prime) mais où le joueur ne l'a pas fait.
  // On détermine « le top est un scrabble » en REjouant le plateau coup par coup
  // (nombre de NOUVELLES tuiles posées par le top == clé de prime du mode), ce qui
  // est fiable même sur d'anciennes parties (le hadBonus stocké est non fiable).
  const { emptyBoard, applyMove, GAME_MODES } = await import("./scrabble/engine.js");
  const gameById = {};
  for (const g of games) gameById[g.id] = g;
  const bonusesOf = (gid) => (GAME_MODES[gameById[gid]?.mode] || GAME_MODES.duplicate).bonuses || { 7: 50 };

  const topScrabbleByGame = {};   // gid → Set(moveNo) où le top est un scrabble
  for (const [gid, rs] of Object.entries(byGame)) {
    const bonuses = bonusesOf(gid);
    const topByMove = {};
    for (const r of rs) for (const h of (r.details || [])) {
      if (h.top && h.top.word && h.top.row != null && topByMove[h.moveNo] == null) topByMove[h.moveNo] = h.top;
    }
    const moveNos = Object.keys(topByMove).map(Number).sort((a, b) => a - b);
    let board = emptyBoard();
    const set = new Set();
    for (const mv of moveNos) {
      const t = topByMove[mv];
      const dr = t.dir === "V" ? 1 : 0, dc = t.dir === "H" ? 1 : 0;
      let placed = 0;
      for (let i = 0; i < t.word.length; i++) {
        const rr = t.row + i * dr, cc = t.col + i * dc;
        if (board[rr] && !board[rr][cc]) placed++;
      }
      if (bonuses[placed]) set.add(mv);
      board = applyMove(board, { word: t.word, row: t.row, col: t.col, dir: t.dir, blanks: t.blanks || [] });
    }
    topScrabbleByGame[gid] = set;
  }

  for (const p of players) p.missedScrabbles = 0;
  // La rubrique n'est fiable que si TOUTES les feuilles du tournoi sont au
  // format v:2 (placedCount = meilleur nb de jetons posés, capturé même sur les
  // coups abandonnés). Les feuilles antérieures mettaient placedCount=0 sur les
  // abandons → impossible de savoir si le joueur avait posé un scrabble → on
  // masque la rubrique pour tout le tournoi ("—").
  const scrabbleReliable = players.every(p =>
    (p.results || []).every(r =>
      !(r.details || []).length || (r.details || []).every(m => m.v >= 2)));
  if (scrabbleReliable) {
    for (const p of players) {
      for (const r of (p.results || [])) {
        const scrabbleMoves = topScrabbleByGame[r.prepared_game_id];
        if (!scrabbleMoves) continue;
        const bonuses = bonusesOf(r.prepared_game_id);
        for (const m of (r.details || [])) {
          if (!scrabbleMoves.has(m.moveNo)) continue;        // le top n'était pas un scrabble
          // Le joueur a posé un scrabble (son meilleur mot atteint la prime) →
          // pas de raté, même si ce n'était pas le top.
          if (bonuses[m.placedCount]) continue;
          p.missedScrabbles++;
        }
      }
    }
  }
  const shRow = (p, val) => `<li class="${p.id === me ? 'me' : ''}"><strong>${escapeHtml(p.name)}</strong><span style="float:right">${val}</span></li>`;
  const cardShame = `<h2>🧐 Les Taupissimes !</h2>
    <div class="shame-grid">
      <div><h4>💩 Mots faux</h4><ol>${[...players].sort((a,b)=>b.invalidCount-a.invalidCount).filter(p=>p.invalidCount>0).slice(0,5).map(p=>shRow(p,p.invalidCount+' mot'+(p.invalidCount>1?'s':''))).join('')||'<li class="muted">Pas encore de données</li>'}</ol></div>
      <div><h4>🫣 Anti-solos</h4><ol>${[...players].sort((a,b)=>b.antiSolos-a.antiSolos).filter(p=>p.antiSolos>0).slice(0,5).map(p=>shRow(p,p.antiSolos+' coup'+(p.antiSolos>1?'s':''))).join('')||'<li class="muted">—</li>'}</ol></div>
      <div><h4>🐢 Partie la plus lente</h4><ol>${[...players].sort((a,b)=>b.worstSingleTime-a.worstSingleTime).filter(p=>p.worstSingleTime>0).slice(0,5).map(p=>shRow(p,fmtT(p.worstSingleTime))).join('')||'<li class="muted">—</li>'}</ol></div>
      <div><h4>😤 Scrabbles ratés</h4><ol>${[...players].sort((a,b)=>b.missedScrabbles-a.missedScrabbles).filter(p=>p.missedScrabbles>0).slice(0,5).map(p=>shRow(p,p.missedScrabbles+' scrabble'+(p.missedScrabbles>1?'s':''))).join('')||'<li class="muted">—</li>'}</ol></div>
    </div>`;

  body.innerHTML = `
    <div class="tournament-stats-grid">
      <div class="t-stat-card">${cardSolos}</div>
      <div class="t-stat-card">${cardComputerSolos}</div>
      <div class="t-stat-card">${cardBestTime}</div>
      <div class="t-stat-card">${cardCumulTime}</div>
      <div class="t-stat-card">${cardCumulNeg}</div>
    </div>`;

  const shameContainer = $("#tournamentShameBody");
  if (shameContainer) {
    shameContainer.innerHTML = `<div class="card t-stat-card shame" style="margin-top:0">${cardShame}</div>`;
  }
}

$("#tCreate").onclick = async () => {
  if (!isAdmin()) return alert("Réservé à l'admin.");
  const name = $("#tName").value.trim();
  if (!name) return alert("Donne un nom au tournoi.");
  const { data, error } = await sb.from("tournaments").insert({
    name, created_by_player_id: state.currentPlayerId ? +state.currentPlayerId : null,
  }).select().single();
  if (error) return alert(error.message);
  $("#tName").value = "";
  await autoArchiveOldest();        // garder max 10 actifs
  await loadTournaments();
  openTournament(data.id);          // ouvrir directement le tournoi créé
};

// Quand on change de mode, mettre à jour le temps/coup par défaut
$("#pgMode").addEventListener("change", async () => {
  const { GAME_MODES } = await import("./scrabble/engine.js");
  const m = GAME_MODES[$("#pgMode").value];
  if (m) $("#pgTime").value = m.defaultTime;
});

window.delPreparedGame = async function(id) {
  if (!confirm("Supprimer cette partie pré-tirée et tous ses résultats ?")) return;
  const { error } = await sb.from("prepared_games").delete().eq("id", id);
  if (error) return alert(error.message);
  loadPreparedGames();
};

$("#pgCreate").onclick = async () => {
  if (!isAdmin()) { alert("Seul l'admin peut créer des parties."); return; }
  if (!currentTournamentId) { alert("Choisis ou crée d'abord un tournoi."); return; }
  try {
    const name = $("#pgName").value.trim();
    if (!name) return alert("Donne un nom à la partie.");
    const mode = $("#pgMode").value;
    const withJoker = $("#pgJoker").checked;
    const timePerMove = +$("#pgTime").value || 0;

    $("#pgStatus").innerHTML = "⏳ Chargement du dictionnaire (≈1 s)…";

    let mods;
    try {
      mods = await Promise.all([
        import("./scrabble/dictionary.js"),
        import("./scrabble/generator.js"),
      ]);
    } catch (e) {
      $("#pgStatus").innerHTML = `<span style="color:#a02525">Échec de chargement des modules : ${escapeHtml(e.message)}</span>`;
      console.error(e);
      return;
    }
    const { Dictionary } = mods[0];
    const { generateGame } = mods[1];

    let dict;
    try {
      dict = await new Dictionary().load("scrabble/ods9.txt");
    } catch (e) {
      $("#pgStatus").innerHTML = `<span style="color:#a02525">Impossible de charger le dictionnaire : ${escapeHtml(e.message)}</span>`;
      return;
    }

    $("#pgStatus").innerHTML = "⏳ Génération de la partie… <span id='pgPct'>0%</span>";
    const onProgress = (p) => { const el = $("#pgPct"); if (el) el.textContent = Math.round(p * 100) + "%"; };

    await new Promise(r => setTimeout(r, 20));
    const game = generateGame(dict, { mode, withJoker }, onProgress);

    // Bloquer la sauvegarde si la génération a produit des racks joker invalides
    if (game.jokerError) {
      $("#pgStatus").innerHTML = `<span style="color:#a02525">❌ Erreur de génération : joker absent dans certains coups (${escapeHtml(game.jokerError)}). Partie non sauvegardée — relance la génération.</span>`;
      return;
    }

    $("#pgStatus").textContent = "💾 Enregistrement…";
    const { data, error } = await sb.from("prepared_games").insert({
      name, mode, with_joker: withJoker, time_per_move: timePerMove,
      moves: game.moves, total_top_score: game.totalTopScore,
      created_by_player_id: state.currentPlayerId ? +state.currentPlayerId : null,
      tournament_id: currentTournamentId,
    }).select().single();

    if (error) {
      $("#pgStatus").innerHTML = `<span style="color:#a02525">Erreur Supabase : ${escapeHtml(error.message)}<br>As-tu exécuté <code>scrabble/schema-prepared.sql</code> dans Supabase SQL Editor ?</span>`;
      return;
    }

    $("#pgStatus").innerHTML = `✅ Partie « ${escapeHtml(name)} » créée.`;
    $("#pgName").value = "";
    loadPreparedGames();
  } catch (e) {
    console.error("pgCreate error:", e);
    $("#pgStatus").innerHTML = `<span style="color:#a02525">Erreur inattendue : ${escapeHtml(e.message || String(e))}</span> (voir console)`;
  }
};

// ============================================================
//  Recalcul correctif des négatifs pour les parties joker (Bug 4)
// ============================================================

window.recomputeAllNeg = async function(force = false) {
  if (!isAdmin()) return alert("Réservé à l'admin.");
  if (!currentTournamentId) return alert("Ouvre d'abord un tournoi.");
  const statusEl = $("#recomputeStatus");
  statusEl.textContent = "⏳ Chargement des modules…";

  let recomputeResult;
  try {
    ({ recomputeResult } = await import("./scrabble/recompute.js"));
  } catch (e) {
    statusEl.textContent = "❌ Impossible de charger recompute.js : " + e.message;
    return;
  }

  statusEl.textContent = "⏳ Récupération des parties du tournoi…";
  const { data: games, error: gErr } = await sb
    .from("prepared_games")
    .select("id, mode, moves, with_joker")
    .eq("tournament_id", currentTournamentId);
  if (gErr) { statusEl.textContent = "❌ " + gErr.message; return; }
  if (!games || games.length === 0) {
    statusEl.textContent = "ℹ️ Aucune partie trouvée dans ce tournoi.";
    return;
  }
  const gameIds = games.map(g => g.id);

  statusEl.textContent = "⏳ Récupération des résultats…";
  const { data: allResults, error: rErr } = await sb
    .from("prepared_game_results")
    .select("player_id, prepared_game_id, details, sum_neg, total_score")
    .in("prepared_game_id", gameIds);
  if (rErr) { statusEl.textContent = "❌ " + rErr.message; return; }
  if (!allResults || allResults.length === 0) {
    statusEl.textContent = "ℹ️ Aucun résultat à recalculer.";
    return;
  }

  statusEl.textContent = `⏳ Recalcul de ${allResults.length} fiche(s)…`;

  const gameMap = Object.fromEntries(games.map(g => [g.id, g]));
  let changed = 0, done = 0, skipped = 0;
  const toUpdate = [];
  for (const r of allResults) {
    const game = gameMap[r.prepared_game_id];
    if (!game || !r.details) { skipped++; continue; }
    try {
      const { sumNeg, totalScore, details } = recomputeResult(game, r.details);
      // Forcer la mise à jour même si les valeurs semblent identiques
      // (cast explicite pour éviter les faux "égaux" string vs number)
      if (force || Number(sumNeg) !== Number(r.sum_neg) || Number(totalScore) !== Number(r.total_score)) {
        toUpdate.push({ player_id: r.player_id, prepared_game_id: r.prepared_game_id, sum_neg: sumNeg, total_score: totalScore, details });
        changed++;
      }
    } catch (e) {
      console.error("recomputeResult error", r.prepared_game_id, r.player_id, e);
      skipped++;
    }
  }

  if (toUpdate.length === 0) {
    statusEl.textContent = `✅ Tout correct — ${games.length} parties, ${allResults.length} fiches, ${skipped} ignorées, force=${force}`;
    return;
  }

  statusEl.textContent = `💾 Mise à jour de ${changed} fiche(s)…`;
  for (const u of toUpdate) {
    const { error: uErr } = await sb.rpc("admin_update_game_result", {
      p_player_id:   u.player_id,
      p_game_id:     u.prepared_game_id,
      p_sum_neg:     u.sum_neg,
      p_total_score: u.total_score,
      p_details:     u.details,
    });
    if (uErr) { statusEl.textContent = `❌ Erreur (${done}/${changed}) : ${uErr.message}`; return; }
    done++;
    if (done % 5 === 0) statusEl.textContent = `💾 ${done}/${changed} fiches mises à jour…`;
  }

  statusEl.textContent = `✅ ${changed} fiche(s) recalculée(s) sur ${allResults.length}.`;
  loadTournamentDetail(currentTournamentId);
};

// ============================================================
//  Correction admin : donner le top à un joueur sur des coups précis
// ============================================================
// Parse "16-19, 14,17" → [14,16,17,18,19] (trié, dédupliqué).
function parseMoveList(str) {
  const out = new Set();
  for (const part of String(str || "").split(",")) {
    const p = part.trim();
    if (!p) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    if (range) {
      const a = +range[1], b = +range[2];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else if (/^\d+$/.test(p)) {
      out.add(+p);
    }
  }
  return [...out].sort((a, b) => a - b);
}

window.adminGiveTop = async function() {
  if (!isAdmin()) return alert("Réservé à l'admin.");
  const statusEl = $("#fixStatus");
  if (!currentTournamentId) { statusEl.textContent = "❌ Ouvre d'abord un tournoi."; return; }

  const pseudo = $("#fixPseudo").value.trim();
  const gameNo = +$("#fixGame").value;
  const moveNos = parseMoveList($("#fixMoves").value);
  if (!pseudo) { statusEl.textContent = "❌ Indique un pseudo."; return; }
  if (!gameNo) { statusEl.textContent = "❌ Indique le n° de partie."; return; }
  if (!moveNos.length) { statusEl.textContent = "❌ Indique au moins un coup (ex : 16-19)."; return; }

  statusEl.textContent = "⏳ Recherche du joueur et de la partie…";

  // 1) Joueur par pseudo (insensible à la casse)
  const { data: players, error: pErr } = await sb
    .from("players").select("id, name").ilike("name", pseudo);
  if (pErr) { statusEl.textContent = "❌ " + pErr.message; return; }
  if (!players || players.length === 0) { statusEl.textContent = `❌ Joueur « ${pseudo} » introuvable.`; return; }
  if (players.length > 1) { statusEl.textContent = `❌ Plusieurs joueurs nommés « ${pseudo} » — ambigu.`; return; }
  const player = players[0];

  // 2) Parties du tournoi → trouver "Partie {gameNo}"
  const { data: games, error: gErr } = await sb
    .from("prepared_games").select("id, name, moves").eq("tournament_id", currentTournamentId);
  if (gErr) { statusEl.textContent = "❌ " + gErr.message; return; }
  const game = (games || []).find(g => {
    const m = /(\d+)/.exec(g.name || "");
    return m && +m[1] === gameNo;
  });
  if (!game) { statusEl.textContent = `❌ Partie ${gameNo} introuvable dans ce tournoi.`; return; }

  // 3) Fiche résultat du joueur pour cette partie
  const { data: rows, error: rErr } = await sb
    .from("prepared_game_results")
    .select("player_id, prepared_game_id, details, total_score, sum_neg")
    .eq("prepared_game_id", game.id).eq("player_id", player.id);
  if (rErr) { statusEl.textContent = "❌ " + rErr.message; return; }
  if (!rows || rows.length === 0) {
    statusEl.textContent = `❌ ${player.name} n'a pas de résultat enregistré sur la partie ${gameNo}.`; return;
  }
  const res = rows[0];
  const details = Array.isArray(res.details) ? res.details.map(e => ({ ...e })) : [];
  if (!details.length) { statusEl.textContent = "❌ Fiche sans détail de coups."; return; }

  // 4) Appliquer le top sur les coups demandés
  const changes = [];
  const notFound = [];
  for (const mv of moveNos) {
    const e = details.find(d => d.moveNo === mv);
    if (!e) { notFound.push(mv); continue; }
    if (!e.top || typeof e.top.score !== "number") { notFound.push(mv); continue; }
    const before = e.playerScore || 0;
    e.playerScore = e.top.score;
    e.neg = 0;
    e.status = "top";
    e.played = e.top.word;
    e.playedPos = e.top.pos || e.playedPos || null;
    e.gotBonus = !!e.top.hadBonus;
    changes.push({ mv, before, after: e.top.score, word: e.top.word });
  }
  if (!changes.length) {
    statusEl.textContent = `❌ Aucun coup applicable (introuvables : ${notFound.join(", ") || "—"}).`; return;
  }

  // 5) Recalcul des totaux
  const newTotal = details.reduce((s, d) => s + (d.playerScore || 0), 0);
  const newNeg = details.reduce((s, d) => s + (d.neg || 0), 0);

  // 6) Confirmation avant écriture (données de production)
  const lines = changes.map(c => `  • coup ${c.mv} : ${c.before} → ${c.after} pts (${c.word})`).join("\n");
  const warn = notFound.length ? `\n\n⚠️ Coups ignorés (absents ou sans top) : ${notFound.join(", ")}` : "";
  const ok = confirm(
    `Donner le top à ${player.name} — Partie ${gameNo} :\n\n${lines}\n\n` +
    `Score total : ${res.total_score} → ${newTotal}\n` +
    `Négatif : ${res.sum_neg} → ${newNeg}${warn}\n\nConfirmer ?`);
  if (!ok) { statusEl.textContent = "Annulé."; return; }

  // 7) Écriture via la RPC admin (contourne RLS, contrôle admin côté serveur)
  statusEl.textContent = "💾 Enregistrement…";
  const { error: uErr } = await sb.rpc("admin_update_game_result", {
    p_player_id:   res.player_id,
    p_game_id:     res.prepared_game_id,
    p_sum_neg:     newNeg,
    p_total_score: newTotal,
    p_details:     details,
  });
  if (uErr) { statusEl.textContent = "❌ Erreur d'enregistrement : " + uErr.message; return; }

  statusEl.textContent = `✅ ${player.name} — Partie ${gameNo} : ${changes.length} coup(s) passé(s) au top. Total ${res.total_score} → ${newTotal}.`;
  loadTournamentDetail(currentTournamentId);
};

window.recomputeAllJokerNeg = async function() {
  if (!isAdmin()) return alert("Réservé à l'admin.");
  const statusEl = $("#recomputeStatus");
  statusEl.textContent = "⏳ Chargement des modules…";

  let recomputeResult;
  try {
    ({ recomputeResult } = await import("./scrabble/recompute.js"));
  } catch (e) {
    statusEl.textContent = "❌ Impossible de charger recompute.js : " + e.message;
    return;
  }

  statusEl.textContent = "⏳ Récupération des parties joker…";
  // 1. Récupérer toutes les parties joker du tournoi courant (ou tous les tournois)
  const { data: jokerGames, error: gErr } = await sb
    .from("prepared_games")
    .select("id, mode, moves")
    .eq("with_joker", true);
  if (gErr) { statusEl.textContent = "❌ " + gErr.message; return; }
  if (!jokerGames || jokerGames.length === 0) {
    statusEl.textContent = "ℹ️ Aucune partie joker trouvée.";
    return;
  }
  const jokerIds = jokerGames.map(g => g.id);

  statusEl.textContent = "⏳ Récupération des résultats…";
  // 2. Récupérer tous les résultats pour ces parties
  const { data: allResults, error: rErr } = await sb
    .from("prepared_game_results")
    .select("player_id, prepared_game_id, details, sum_neg, total_score")
    .in("prepared_game_id", jokerIds);
  if (rErr) { statusEl.textContent = "❌ " + rErr.message; return; }
  if (!allResults || allResults.length === 0) {
    statusEl.textContent = "ℹ️ Aucun résultat joker à recalculer.";
    return;
  }

  statusEl.textContent = `⏳ Recalcul de ${allResults.length} fiche(s)…`;

  // 3. Recalculer chaque résultat et préparer les upserts
  const gameMap = Object.fromEntries(jokerGames.map(g => [g.id, g]));
  const upserts = [];
  let changed = 0;
  for (const r of allResults) {
    const game = gameMap[r.prepared_game_id];
    if (!game || !r.details) continue;
    const { sumNeg, totalScore, details } = recomputeResult(game, r.details);
    // Ne mettre à jour que si quelque chose a changé
    if (sumNeg !== r.sum_neg || totalScore !== r.total_score) {
      upserts.push({
        player_id: r.player_id,
        prepared_game_id: r.prepared_game_id,
        sum_neg: sumNeg,
        total_score: totalScore,
        details,
      });
      changed++;
    }
  }

  if (upserts.length === 0) {
    statusEl.textContent = `✅ Tout est déjà correct (${allResults.length} fiches vérifiées).`;
    return;
  }

  statusEl.textContent = `💾 Mise à jour de ${changed} fiche(s)…`;
  // 4. UPDATE via fonction SECURITY DEFINER (contourne RLS)
  let done = 0;
  for (const u of upserts) {
    const { error: uErr } = await sb.rpc("admin_update_game_result", {
      p_player_id:   u.player_id,
      p_game_id:     u.prepared_game_id,
      p_sum_neg:     u.sum_neg,
      p_total_score: u.total_score,
      p_details:     u.details,
    });
    if (uErr) { statusEl.textContent = `❌ Erreur update (${done}/${changed}) : ${uErr.message}`; return; }
    done++;
    if (done % 5 === 0) statusEl.textContent = `💾 ${done}/${changed} fiches mises à jour…`;
  }

  statusEl.textContent = `✅ ${changed} fiche(s) recalculée(s) sur ${allResults.length}.`;
  // Recharger le classement si visible
  if (currentTournamentId) loadTournamentDetail(currentTournamentId);
};

// ============================================================
//  Authentification (Phase A)
// ============================================================

let authMode = "login";       // login | signup | forgot
let session = null;
let currentPlayer = null;     // { id, name, email, auth_user_id }
const ADMIN_PSEUDO = "admin"; // marqueur du compte administrateur
function isAdmin() { return currentPlayer?.name === ADMIN_PSEUDO; }

// Les parties de l'admin sont enregistrées (utile pour débusquer des bugs)
// mais ne doivent PAS apparaître dans les résultats publics (classements,
// records, solos, leaderboards). On filtre par player_id de l'admin.
function isAdminPlayerId(pid) {
  const p = (state.players || []).find(pl => pl.id === pid);
  return p?.name === ADMIN_PSEUDO;
}
function excludeAdminRows(rows) {
  return (rows || []).filter(r => !isAdminPlayerId(r.player_id));
}

function setAuthMode(mode) {
  authMode = mode;
  $$(".auth-tab").forEach(t => t.classList.toggle("active", t.dataset.mode === mode));
  $("#authPseudoField").hidden = mode !== "signup";
  $("#authClubField").hidden = mode !== "signup";
  $("#authPwField").hidden = mode === "forgot";
  // Désactiver les champs cachés pour qu'ils ne bloquent pas la validation
  // HTML5 du formulaire (sinon "An invalid form control is not focusable").
  $("#authPseudo").disabled = mode !== "signup";
  $("#authClub").disabled   = mode !== "signup";
  $("#authPassword").disabled = mode === "forgot";
  // Champ email — toujours "Email" (la connexion par pseudo n'est plus proposée)
  $("#authEmailLabel").textContent = "Email";
  $("#authEmail").placeholder = "alice@exemple.fr";
  const labels = { login: "Se connecter", signup: "Créer mon compte", forgot: "Recevoir un email" };
  $("#authSubmit").textContent = labels[mode];
  $("#authMsg").className = "auth-msg";
  $("#authMsg").textContent = "";
}
$$(".auth-tab").forEach(t => t.onclick = () => setAuthMode(t.dataset.mode));

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const pseudo = $("#authPseudo").value.trim();
  const club = $("#authClub").value.trim();
  const msg = $("#authMsg");
  msg.className = "auth-msg"; msg.textContent = "…";

  try {
    if (authMode === "login") {
      // Connexion par email uniquement (la résolution pseudo→email a été retirée).
      const loginEmail = email.toLowerCase().trim();
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail, password });
      if (error) throw error;
    } else if (authMode === "signup") {
      if (!pseudo) throw new Error("Choisis un pseudo.");
      // 1) Email : s'il est déjà rattaché à un COMPTE → connecte-toi. S'il
      //    correspond à un joueur non lié (placeholder créé par l'admin avec
      //    l'email), on autorise : il sera réclamé par email à la connexion.
      const { data: byEmail } = await sb.from("players").select("id,name,auth_user_id").ilike("email", email).maybeSingle();
      if (byEmail && byEmail.auth_user_id) {
        throw new Error(`Email déjà utilisé (par "${byEmail.name}"). Connecte-toi plutôt.`);
      }
      const willClaimByEmail = !!(byEmail && !byEmail.auth_user_id);
      // 2) Pseudo : s'il existe déjà (lié OU placeholder) → déjà pris.
      //    (Sauf si on réclame un placeholder par email : le pseudo saisi sera
      //    de toute façon remplacé par celui du placeholder.)
      if (!willClaimByEmail) {
        const { data: byName } = await sb.from("players").select("id").eq("name", pseudo).maybeSingle();
        if (byName) {
          throw new Error("Pseudo déjà pris, choisis-en un autre.");
        }
      }
      // 3) créer le compte auth (on stocke pseudo + club pour la création différée)
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { pseudo, club: club || null } },
      });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) throw new Error("Inscription échouée (Supabase n'a pas renvoyé d'utilisateur).");
      // 4) créer le player lié — SAUF si un placeholder par email sera réclamé
      //    à la connexion (onSignedIn s'en charge, pour éviter un doublon).
      if (!willClaimByEmail) {
        const { error: pErr } = await sb.from("players").insert({
          name: pseudo, email, auth_user_id: userId, club: club || null,
        });
        if (pErr) throw new Error("Création du profil : " + pErr.message);
      }
      // 4) Si la session est déjà ouverte (confirmation email désactivée), onAuthStateChange prendra le relais.
      //    Sinon on bascule sur l'onglet Connexion avec un message clair.
      msg.className = "auth-msg ok";
      msg.textContent = `✅ Compte « ${pseudo} » créé avec succès !`;
      if (!data.session) {
        setTimeout(() => {
          setAuthMode("login");
          $("#authEmail").value = pseudo;
          $("#authPassword").value = "";
          $("#authMsg").className = "auth-msg ok";
          $("#authMsg").textContent = "Compte créé. Connecte-toi avec ton mot de passe.";
        }, 1200);
      }
      return;
    } else if (authMode === "forgot") {
      // Normaliser : Supabase stocke les emails en minuscules → on aligne pour
      // garantir que l'email tapé matche un utilisateur existant.
      const normalizedEmail = email.toLowerCase().trim();
      const { error } = await sb.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw error;
      msg.className = "auth-msg ok";
      msg.textContent = "Email envoyé. Vérifie ta boîte de réception (et tes spams).";
      return;
    }
  } catch (err) {
    msg.className = "auth-msg error";
    msg.textContent = err.message || "Erreur";
  }
});

// Gestion du clic sur le lien de reset (hash OU query dans l'URL).
// 1) Au chargement : on regarde si l'URL contient un token de recovery
// 2) En cours de session : on écoute l'événement PASSWORD_RECOVERY
// 3) hashchange : au cas où l'URL change après le 1er rendu
function checkRecoveryHash() {
  const h = location.hash || "";
  const q = location.search || "";
  if (h.includes("type=recovery") || q.includes("type=recovery")) {
    $("#resetPwModal").hidden = false;
  }
  // Retour depuis une partie tournoi → activer directement le tab Tournois
  if (h === "#tab=prepared") {
    const btn = document.querySelector('nav button[data-tab="prepared"]');
    if (btn) { btn.click(); history.replaceState(null, "", location.pathname); }
  }
  // Retour vers un tournoi spécifique (on CONSERVE le #tid pour que le bouton
  // "précédent" du navigateur puisse y revenir après un rejeu).
  if (h.startsWith("#tid=")) {
    const tid = h.slice(5);
    const btn = document.querySelector('nav button[data-tab="prepared"]');
    if (btn) btn.click();
    if (tid) openTournament(tid).catch(() => {});
  }
}
window.addEventListener("hashchange", checkRecoveryHash);
window.addEventListener("DOMContentLoaded", checkRecoveryHash);
checkRecoveryHash();   // dès l'import du script (au cas où DOMContentLoaded déjà fired)
$("#setNewPasswordBtn").onclick = async () => {
  const pw = $("#newPassword").value;
  if (!pw || pw.length < 6) { $("#resetPwMsg").textContent = "Mot de passe trop court (min 6)."; return; }
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) { $("#resetPwMsg").textContent = error.message; return; }
  $("#resetPwMsg").textContent = "✅ Mot de passe modifié. Tu peux te connecter.";
  setTimeout(() => {
    $("#resetPwModal").hidden = true;
    location.hash = "";
  }, 1500);
};

window.logout = async () => {
  await sb.auth.signOut();
  // onAuthStateChange → onSignedOut
};

// Réagir aux changements de session
sb.auth.onAuthStateChange((event, sess) => {
  session = sess;
  // Supabase déclenche cet event quand l'utilisateur arrive depuis le lien
  // de reset password → on ouvre directement la modale "définir nouveau mdp".
  if (event === "PASSWORD_RECOVERY") {
    $("#resetPwModal").hidden = false;
    return;
  }
  if (sess) onSignedIn();
  else onSignedOut();
});

async function onSignedIn() {
  const userId = session.user?.id;
  // Charger le player lié à cet auth_user_id
  let { data: player } = await sb.from("players").select("*").eq("auth_user_id", userId).maybeSingle();
  if (!player) {
    // Pas de player lié à ce compte. Avant de créer un nouveau joueur (et donc
    // un doublon), on tente de RATTACHER un joueur existant non lié dont l'EMAIL
    // correspond. On ne rattache JAMAIS par pseudo seul (risque d'usurpation) :
    // l'email prouve l'identité.
    const meta = session.user.user_metadata || {};
    const desiredPseudo = (meta.pseudo || "").trim();
    let claimedId = null;
    {
      const { data } = await sb.rpc("claim_player_by_email");
      claimedId = data || null;
    }
    if (claimedId) {
      const { data: linked } = await sb.from("players").select("*").eq("id", claimedId).maybeSingle();
      player = linked;
    }
    if (!player) {
      // Aucun joueur à rattacher : on crée un nouveau profil.
      const fallbackName = desiredPseudo || (session.user.email || "Joueur").split("@")[0];
      const { data: created } = await sb.from("players").insert({
        name: fallbackName, email: session.user.email, auth_user_id: userId,
        club: meta.club || null,
      }).select().single();
      player = created;
    }
  }
  currentPlayer = player;
  state.currentPlayerId = player.id;
  localStorage.setItem("currentPlayerId", player.id);
  $("#authOverlay").hidden = true;
  $("#userPill").hidden = false;
  $("#currentPseudo").textContent = player.name;
  // Affiche la version SW (pour stof) et la logue en DB pour tous
  const swVerEl = $("#swVersion");
  if (typeof caches !== "undefined") {
    caches.keys().then(async keys => {
      const v = keys.find(k => k.startsWith("garenna-")) || "";
      // Affichage pour stof
      if (player.name === "stof" && swVerEl) {
        swVerEl.textContent = v ? ` · ${v}` : "";
        swVerEl.hidden = !v;
      } else if (swVerEl) { swVerEl.hidden = true; }
      // Logger en DB pour tout le monde
      if (v && player.id) {
        sb.from("players").update({ sw_version: v }).eq("id", player.id).then(() => {});
      }
    }).catch(() => { if (swVerEl) swVerEl.hidden = true; });
  } else if (swVerEl) { swVerEl.hidden = true; }
  // Charger les données
  loadPlayers().then(() => { startPresence(player.id); loadPreparedGames(); });
}

function onSignedOut() {
  currentPlayer = null;
  state.currentPlayerId = null;
  localStorage.removeItem("currentPlayerId");
  $("#authOverlay").hidden = false;
  $("#userPill").hidden = true;
  setAuthMode("login");
}

// ============================================================
//  Feuille de route d'un joueur (vue depuis le classement)
// ============================================================

function _psPos(row, col, dir) {
  const letter = "ABCDEFGHIJKLMNO"[row];
  const num = col + 1;
  return dir === "H" ? `${letter}${num}` : `${num}${letter}`;
}

window.openPlayerGamesModal = function(playerId) {
  const ctx = window._lbCtx;
  if (!ctx) return;
  const p = ctx.byPlayer[playerId];
  if (!p) return;

  // Parties jouées par ce joueur ET que l'utilisateur courant a aussi jouées
  const eligible = ctx.games.filter(g => p.perGame[g.id] && ctx.myGameIds.has(g.id));

  const modal = $("#playerSheetModal");
  const body = $("#playerSheetModalBody");

  if (!eligible.length) {
    body.innerHTML = `<h3 style="margin:0 0 12px">🎯 ${escapeHtml(p.name)}</h3>
      <p class="muted">Aucune partie en commun avec toi pour l'instant.</p>`;
    modal.hidden = false;
    return;
  }

  let html = `<h3 style="margin:0 0 12px">🎯 ${escapeHtml(p.name)}</h3>
    <p style="margin:0 0 10px;color:#5a6a73;font-size:.9rem">Clique sur une partie pour voir sa feuille de route :</p>
    <div style="display:flex;flex-direction:column;gap:6px">`;

  for (const g of eligible) {
    const r = p.perGame[g.id];
    const negDisp = r.neg !== undefined ? r.neg : "—";
    html += `<button class="btn ghost" style="text-align:left;justify-content:space-between"
      onclick="openPlayerGameSheet(${playerId}, '${g.id}')">
      <span>${escapeHtml(g.name)}</span>
      <span style="color:#888;font-size:.85rem">Nég. : ${negDisp} · Score : ${r.totalScore}</span>
    </button>`;
  }
  html += `</div>`;
  body.innerHTML = html;
  modal.hidden = false;
};

window.openPlayerGameSheet = function(playerId, gameId) {
  const ctx = window._lbCtx;
  if (!ctx) return;
  const p = ctx.byPlayer[playerId];
  if (!p) return;
  const r = p.perGame[gameId];
  if (!r || !r.details) return;
  const game = ctx.games.find(g => String(g.id) === String(gameId));
  const gameName = game ? game.name : gameId;

  const coord = pos => `<span style="font-size:.75em;color:#888;vertical-align:.1em">${pos}</span>`;
  const rackDisplay = (h) => {
    const rack = h.rack || "";
    if (h.kept) {
      const rest = rack.split("");
      for (const ch of h.kept) { const i = rest.indexOf(ch); if (i >= 0) rest.splice(i, 1); }
      return rest.length ? `${h.kept}+${rest.join("")}` : rack;
    }
    if (h.freshRack) return "–" + rack;
    return rack;
  };

  const rows = r.details.map(h => {
    const isMiss = h.status === "giveup" || h.status === "timeout";
    const rowClass = isMiss ? "sheet-miss" : "";
    const statusIcon = { top: "🏆", giveup: "🏳️", timeout: "⏱" }[h.status] || "";
    const statusLabel = { top: "top", giveup: "abandon", timeout: "temps écoulé" }[h.status] || (h.status || "");
    const topPos = h.top?.pos || (h.top ? _psPos(h.top.row, h.top.col, h.top.dir) : "");
    const topCell = h.top
      ? `<strong>${h.top.word}</strong> ${coord(topPos)} ${h.top.score} pts`
      : "—";
    const playedCell = h.played
      ? `<strong>${h.played}</strong>${h.playedPos ? " " + coord(h.playedPos) : ""} ${h.playerScore} pts`
      : `<em>—</em>`;
    const time = h.timeMs ? (h.timeMs / 1000).toFixed(2) + "s" : "—";
    return `<tr class="${rowClass}">
      <td>${h.moveNo}</td>
      <td style="padding-right:26px"><code>${rackDisplay(h)}</code></td>
      <td style="padding-right:26px">${topCell}</td>
      <td>${playedCell}</td>
      <td style="text-align:center;padding:6px 4px" class="${(h.neg || 0) < 0 ? 'neg' : ''}">${(h.neg || 0) < 0 ? h.neg : ''}</td>
      <td>${statusIcon} <span style="color:#888;font-size:.85em">${statusLabel}</span></td>
      <td style="text-align:right">${time}</td>
    </tr>`;
  }).join("");

  const body = $("#playerSheetModalBody");
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <button class="btn ghost small" onclick="closePlayerSheetModal()">← Fermer</button>
      <h3 style="margin:0">🎯 ${escapeHtml(p.name)} — ${escapeHtml(gameName)}</h3>
    </div>
    <div style="margin-bottom:10px;font-size:.9rem;color:#5a6a73">
      Score : <strong>${r.totalScore}</strong> · Négatif : <strong>${r.neg || 0}</strong>
    </div>
    <div style="max-height:65vh;overflow:auto">
    <table style="width:100%;border-collapse:collapse;font-size:.9rem">
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
  // Afficher la modale (appel direct depuis la liste déroulée du classement —
  // on ne passe plus par openPlayerGamesModal qui l'ouvrait auparavant).
  $("#playerSheetModal").hidden = false;
};

window.closePlayerSheetModal = function() {
  $("#playerSheetModal").hidden = true;
};

// ============================================================
//  Init
// ============================================================
(async () => {
  // Masquer l'overlay immédiatement si on a un joueur en cache (évite le flash
  // de déconnexion pendant le temps de vérification asynchrone de la session).
  if (localStorage.getItem("currentPlayerId")) {
    $("#authOverlay").hidden = true;
  }
  // Vérifier la session existante
  const { data: { session: sess } } = await sb.auth.getSession();
  session = sess;
  if (sess) await onSignedIn();
  else onSignedOut();
  checkRecoveryHash();
})();
