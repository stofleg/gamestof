//  Page publique du tournoi d'Halloween : création de compte / connexion, puis
//  directement les parties du tournoi et le classement. Les comptes créés ici
//  sont des comptes « halloween » : la base ne leur ouvre que les tournois
//  publics (cf. schema-halloween.sql), et Topissimo les renvoie ici.
import { modeDisplayName, modeNomOrigine, ecranMobile, MSG_MORT_MOBILE, pointsJigsaw } from "../scrabble/engine.js?v=482";

const $ = id => document.getElementById(id);
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
let mode = "signup", joueur = null;

const message = (txt, type = "") => { $("hwMsg").textContent = txt; $("hwMsg").className = `hw-msg ${type}`; };
const echappe = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// --- formulaire ------------------------------------------------------------------
function changeMode(m) {
  mode = m;
  document.querySelectorAll(".hw-onglets button").forEach(b => b.classList.toggle("actif", b.dataset.mode === m));
  $("hwChampPseudo").hidden = m !== "signup";
  $("hwChampMdp").hidden = m === "forgot";
  $("hwRegles").hidden = m !== "signup";
  $("hwMdp").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("hwValider").textContent = { signup: "Créer mon compte", login: "Se connecter", forgot: "Recevoir un lien" }[m];
  message("");
}
document.querySelectorAll(".hw-onglets button").forEach(b => b.onclick = () => changeMode(b.dataset.mode));

$("hwForm").onsubmit = async e => {
  e.preventDefault();
  const email = $("hwEmail").value.trim().toLowerCase(), mdp = $("hwMdp").value, pseudo = $("hwPseudo").value.trim();
  $("hwValider").disabled = true;
  try {
    if (mode === "signup") {
      if (!/^[\p{L}\p{N} _.-]{2,24}$/u.test(pseudo)) throw new Error("Pseudo : 2 à 24 caractères (lettres, chiffres, espace, _ . -).");
      if (mdp.length < 6) throw new Error("Mot de passe : 6 caractères minimum.");
      const { data: libre, error: e0 } = await sb.rpc("pseudo_libre", { p_name: pseudo });
      if (e0) throw e0;
      if (!libre) throw new Error("Ce pseudo est déjà pris, choisis-en un autre.");
      const { data, error } = await sb.auth.signUp({
        email, password: mdp,
        options: { data: { pseudo, tournoi: "halloween" }, emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      if (!data.session) message("📬 Compte créé ! Clique sur le lien reçu par email pour l'activer, puis reviens ici.", "ok");
    } else if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password: mdp });
      if (error) throw new Error(/confirm/i.test(error.message)
        ? "Email pas encore confirmé : clique sur le lien reçu par email." : "Email ou mot de passe incorrect.");
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
      message("📬 Si ce compte existe, un lien t'a été envoyé.", "ok");
    }
  } catch (err) {
    message(err.message || String(err), "erreur");
  } finally {
    $("hwValider").disabled = false;
  }
};

// --- session -----------------------------------------------------------------------
/** Fiche joueur du compte connecté (créée au premier passage, en « halloween »). */
async function ficheJoueur(session) {
  const uid = session.user.id;
  let { data: p } = await sb.from("players").select("id,name,scope").eq("auth_user_id", uid).maybeSingle();
  if (!p) {
    const pseudo = (session.user.user_metadata?.pseudo || session.user.email.split("@")[0]).trim();
    const { data, error } = await sb.from("players")
      .insert({ name: pseudo, email: session.user.email, auth_user_id: uid, scope: "halloween" })
      .select("id,name,scope").single();
    if (error) throw new Error(/duplicate|unique/i.test(error.message)
      ? "Ce pseudo vient d'être pris par quelqu'un d'autre. Écris-nous pour le changer." : error.message);
    p = data;
    sb.rpc("note_ip", { p_evenement: "inscription" }).then(() => {}, () => {});
  }
  return p;
}

async function connecte(session) {
  try {
    joueur = await ficheJoueur(session);
  } catch (err) {
    $("hwAuth").hidden = false; changeMode("login"); message(err.message, "erreur");
    return;
  }
  // La page de jeu lit ces clés (joueur courant, et périmètre « halloween »).
  localStorage.setItem("currentPlayerId", joueur.id);
  localStorage.setItem("currentPseudo", joueur.name);
  // Aperçu « joueur extérieur » (?exterieur) réservé à stof : les pages de jeu se comportent
  // comme pour un inscrit de la page publique. Topissimo remet le périmètre « club » à l'ouverture.
  const exterieur = new URLSearchParams(location.search).has("exterieur") && joueur.name.toLowerCase() === "stof";
  localStorage.setItem("currentScope", joueur.scope === "club" && !exterieur ? "club" : "halloween");
  if (exterieur) document.body.insertAdjacentHTML("afterbegin", '<div class="hw-apercu-ext">👁 Aperçu « joueur extérieur » (stof)</div>');
  $("hwAuth").hidden = true; $("hwTournoi").hidden = false;
  $("hwQui").textContent = `👻 ${joueur.name}`;
  afficheTournoi();
}

$("hwSortir").onclick = async () => {
  await sb.auth.signOut();
  ["currentPlayerId", "currentPseudo", "currentScope"].forEach(k => localStorage.removeItem(k));
  location.reload();
};

// --- tournoi -----------------------------------------------------------------------
async function afficheTournoi() {
  const { data: tournois } = await sb.from("tournaments").select("id,name,archived_at")
    .eq("est_public", true).is("archived_at", null).order("id", { ascending: false }).limit(1);
  const t = tournois?.[0];
  if (!t) { $("hwParties").innerHTML = "<p>Le tournoi n'a pas encore commencé. Reviens bientôt… si tu l'oses.</p>"; return; }
  $("hwTitre").textContent = t.name;
  // Mémorisé : les pages de jeu posent alors le thème Halloween dès leur premier affichage.
  try { const l = JSON.parse(localStorage.getItem("topissimo:tournoisMort") || "[]"); if (!l.includes(String(t.id))) localStorage.setItem("topissimo:tournoisMort", JSON.stringify([...l, String(t.id)].slice(-20))); } catch {}

  const { data: parties } = await sb.from("prepared_games").select("id,name,mode,created_at").eq("tournament_id", t.id);
  // Jigsaw (grille puzzle) se joue en DERNIER : placé en fin de liste et verrouillé tant
  // que les autres parties ne sont pas terminées. Son temps s'ajoute au temps général.
  const estJigsaw = g => g.mode === "puzzle";
  const liste = (parties || []).sort((a, b) => (estJigsaw(a) - estJigsaw(b)) || a.name.localeCompare(b.name, "fr", { numeric: true }));
  const { data: miens } = await sb.from("prepared_game_results")
    .select("prepared_game_id,sum_neg,summary,paused,total_time_seconds").eq("player_id", joueur.id);
  const etat = new Map((miens || []).map(r => [r.prepared_game_id, r]));
  const finie = g => { const r = etat.get(g.id); return !!(r && r.summary && Array.isArray(r.summary.mv) && r.summary.mv.length > 0 && !r.paused); };
  const resteAvantJigsaw = liste.filter(g => !estJigsaw(g) && !finie(g)).length;
  const duree = s => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;
  const mobile = ecranMobile();   // téléphone ou tablette : Jigsaw seulement sur ordinateur

  $("hwParties").innerHTML = liste.map(g => {
    const r = etat.get(g.id);
    const fini = finie(g);
    const action = fini
      ? (estJigsaw(g)
          ? `<span class="fait">✔ ${duree(r.total_time_seconds || 0)}</span>`
          : `<span class="fait">✔ ${r.sum_neg ?? 0}</span> <a class="hw-btn fantome" href="../scrabble/game.html?review=${g.id}&tid=${t.id}">Revoir</a>`)
      : mobile && estJigsaw(g)
        ? `<span class="verrou" title="${echappe(MSG_MORT_MOBILE)}">💻 sur ordinateur</span>`
      : estJigsaw(g) && resteAvantJigsaw > 0
        ? `<span class="verrou" title="Termine d'abord les autres parties">🔒 encore ${resteAvantJigsaw} partie${resteAvantJigsaw > 1 ? "s" : ""}</span>`
        : `<a class="hw-btn" href="../scrabble/game.html?prepared=${g.id}&tid=${t.id}">${r?.paused ? "Reprendre" : "Jouer"}</a>`;
    // Classement de la partie (et feuilles de route) : seulement une fois sa propre partie terminée.
    const medaille = !fini ? `<button class="hw-btn fantome hw-medaille" type="button" disabled title="Joue d'abord cette partie pour voir le classement">🏅</button>` : `<button class="hw-btn fantome hw-medaille" type="button" data-partie="${g.id}" data-nom="${echappe(g.name)}" title="Classement de la partie">🏅</button>`;
    return `<div class="hw-partie"><div class="nom">${echappe(g.name)}<div class="formule">${echappe(modeDisplayName(g.mode, false, true))} <span class="origine">· ${echappe(modeNomOrigine(g.mode))}</span></div></div>${action} ${medaille}</div>`;
  }).join("") || "<p>Aucune partie pour l'instant.</p>";
  if (mobile) $("hwParties").insertAdjacentHTML("afterbegin", `<p class="hw-mobile">💻 ${echappe(MSG_MORT_MOBILE)}</p>`);

  const { data: cl, error } = await sb.rpc("classement_public", { p_tournament: t.id });
  if (error || !cl?.length) { $("hwClassement").innerHTML = "<p>Personne n'a encore osé jouer.</p>"; return; }
  const heures = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };
  // Trois classements, tous sur les joueurs ayant terminé les 14 parties : le score final
  // (négatif − 1 point par minute de retard), le négatif seul et le temps seul.
  const finis = cl.filter(l => l.rang != null), autres = cl.filter(l => l.rang == null);
  const vues = {
    final: { nom: "Score final", tri: (a, b) => a.rang - b.rang, mise: "score_final" },
    neg:   { nom: "Négatif", tri: (a, b) => b.total_neg - a.total_neg || a.temps_total - b.temps_total, mise: "total_neg" },
    temps: { nom: "Temps", tri: (a, b) => a.temps_total - b.temps_total || b.total_neg - a.total_neg, mise: "temps_total" },
  };
  const dessine = cle => {
    const v = vues[cle], classes = finis.slice().sort(v.tri);
    const ligne = (l, rang) => `<tr class="${l.joueur === joueur.name ? "moi" : ""}"><td>${rang ?? "–"}</td><td>${echappe(l.joueur)}</td>` +
      `<td class="n">${l.parties}/${l.total_parties}</td>` +
      `<td class="n">${l.total_points}</td>` +
      `<td class="n${cle === "neg" ? " cle" : ""}">${l.total_neg}</td>` +
      `<td class="n${cle === "temps" ? " cle" : ""}">${heures(l.temps_total || 0)}</td>` +
      `<td class="n">${l.retard_min != null ? "+" + l.retard_min + " min" : "–"}</td>` +
      `<td class="n">${l.jigsaw_pts ?? "–"}</td>` +
      `<td class="n${cle === "final" ? " cle" : ""}"><strong>${l.score_final ?? "–"}</strong></td></tr>`;
    $("hwClassementCorps").innerHTML = `<div class="hw-defile"><table class="hw-classement"><tr><th>#</th><th>Joueur</th><th class="n">Parties</th><th class="n">Points</th><th class="n">Négatif</th><th class="n">Temps</th><th class="n">Retard</th><th class="n">Jigsaw</th><th class="n">Score final</th></tr>` +
      classes.map((l, i) => ligne(l, i + 1)).join("") + autres.map(l => ligne(l, null)).join("") + "</table></div>";
    document.querySelectorAll("#hwClassement .hw-onglets button").forEach(b => b.classList.toggle("actif", b.dataset.vue === cle));
  };
  $("hwClassement").innerHTML = `<div class="hw-onglets">${Object.entries(vues).map(([k, v]) => `<button data-vue="${k}" type="button">${v.nom}</button>`).join("")}</div>` +
    `<div id="hwClassementCorps"></div>` +
    `<p class="hw-regles">Classement général : score final = points marqués + points Jigsaw − 1 point par minute entière de retard sur le joueur le plus rapide (le vainqueur a le score le plus élevé ; à égalité, le plus rapide passe devant). Jigsaw rapporte jusqu'à 500 points : terminé = 250 pour la résolution + 250 pour le temps (−3 points par minute de retard sur le Jigsaw le plus rapide) ; abandonné = des points pour l'essai si tu as cherché au moins 15 minutes : 125, puis au prorata jusqu'à 200 à 30 minutes de recherche. Les classements « Négatif » et « Temps » comptent chaque critère seul. Seuls les joueurs ayant terminé toutes les parties sont classés. Le temps de Jigsaw, la dernière partie, s'ajoute au temps général.</p>`;
  document.querySelectorAll("#hwClassement .hw-onglets button").forEach(b => b.onclick = () => dessine(b.dataset.vue));
  dessine("final");
}

// --- démarrage -----------------------------------------------------------------------
sb.auth.onAuthStateChange((evt, session) => {
  if (evt === "PASSWORD_RECOVERY") {
    const mdp = prompt("Choisis un nouveau mot de passe (6 caractères minimum) :");
    if (mdp && mdp.length >= 6) sb.auth.updateUser({ password: mdp });
  }
});
const { data: { session } } = await sb.auth.getSession();
if (session) connecte(session);
else { $("hwAuth").hidden = false; changeMode("signup"); }
sb.auth.onAuthStateChange((evt, s) => { if (evt === "SIGNED_IN" && s && !joueur) connecte(s); });

// Classement d'une partie (médaille sur une partie terminée) : parties terminées de tous
// les joueurs, via resultats_partie_publique (la RLS ne laisse lire que ses propres lignes).
document.addEventListener("click", async e => {
  const b = e.target.closest(".hw-medaille");
  if (!b) return;
  const fond = document.createElement("div");
  fond.className = "hw-modale";
  fond.innerHTML = `<div class="hw-modale-boite"><button class="hw-fermer" type="button">×</button>
    <h2>🏅 ${b.dataset.nom}</h2><div class="hw-modale-corps">Chargement…</div></div>`;
  fond.onclick = ev => { if (ev.target === fond || ev.target.closest(".hw-fermer")) fond.remove(); };
  document.body.appendChild(fond);
  const corps = fond.querySelector(".hw-modale-corps");
  const { data, error } = await sb.rpc("resultats_partie_publique", { p_game: +b.dataset.partie });
  if (error) { corps.textContent = `Classement indisponible : ${error.message}`; return; }
  const lignes = (data || []).filter(r => (r.name || "").toLowerCase() !== "admin" && (r.summary?.mv?.length || r.summary?.puzzle))
    // Parties abandonnées en dernier, puis négatif, puis temps (Jigsaw : seul le temps départage).
    // Entre deux abandons, le plus long essai d'abord (Jigsaw : plus de points d'essai).
    .sort((a, c) => !!a.summary?.ab - !!c.summary?.ab || (c.sum_neg || 0) - (a.sum_neg || 0)
      || ((a.total_time_seconds || 0) - (c.total_time_seconds || 0)) * (a.summary?.ab ? -1 : 1));
  if (!lignes.length) { corps.textContent = "Personne n'a encore terminé cette partie."; return; }
  const moi = +(localStorage.getItem("currentPlayerId") || 0);
  const temps = s => !s ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const rang = i => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
  // Points gagnés : somme des points des coups ; Jigsaw : barème du tournoi (grille + temps, ou essai).
  const jigsaw = lignes.some(r => r.summary?.puzzle || r.details?.[0]?.puzzle);
  const tJig = lignes.filter(r => !r.summary?.ab).map(r => r.total_time_seconds || 0);
  const tMinJig = tJig.length ? Math.min(...tJig) : null;
  const points = r => jigsaw ? pointsJigsaw(r.total_time_seconds || 0, !!r.summary?.ab, tMinJig)
    : (r.total_score ?? (r.details || []).reduce((t, h) => t + (h.playerScore || 0), 0));
  // Feuilles de route des autres : seulement une fois SA partie terminée (sinon les mots seraient dévoilés).
  const feuilles = true;   // la médaille n'existe que sur une partie terminée
  corps.innerHTML = `<table class="hw-table"><thead><tr><th>#</th><th>Joueur</th><th>Points</th><th>Négatif</th><th>Temps</th>${feuilles ? "<th></th>" : ""}</tr></thead><tbody>${
    lignes.map((r, i) => `<tr${+r.player_id === moi ? ' class="moi"' : ""}><td>${r.summary?.ab ? "–" : rang(i)}</td><td>${echappe(r.name)}</td><td><b>${points(r)}</b></td><td>${r.sum_neg ?? 0}</td><td>${temps(r.total_time_seconds)}${r.summary?.ab ? ' <span class="hw-abandon">abandon</span>' : ""}</td>${
      feuilles && Array.isArray(r.details) && r.details.length ? `<td><button class="hw-btn fantome hw-feuille" type="button" data-i="${i}" title="Feuille de route">📋</button></td>` : (feuilles ? "<td></td>" : "")}</tr>`).join("")
  }</tbody></table>${feuilles ? "" : '<p class="hw-note">Les feuilles de route des autres joueurs seront visibles quand tu auras terminé cette partie.</p>'}<div class="hw-feuille-corps"></div>`;
  corps.onclick = ev => {
    const f = ev.target.closest(".hw-feuille");
    if (!f) return;
    const r = lignes[+f.dataset.i];
    const coord = pos => pos ? ` <small>${echappe(pos)}</small>` : "";
    corps.querySelector(".hw-feuille-corps").innerHTML = `<h3>📋 ${echappe(r.name)}</h3><table class="hw-table"><thead><tr><th>Coup</th><th>Tirage</th><th>Top</th><th>Joué</th><th>Nég.</th></tr></thead><tbody>${
      r.details.map(h => `<tr${(h.neg || 0) < 0 ? ' class="rate"' : ""}><td>${h.moveNo ?? ""}</td><td><code>${echappe(h.rack || "")}</code></td><td>${h.top ? `<b>${echappe(h.top.word)}</b>${coord(h.top.pos)} ${h.top.score}` : "—"}</td><td>${h.played ? `<b>${echappe(h.played)}</b>${coord(h.playedPos)} ${h.playerScore ?? ""}` : "—"}</td><td>${h.neg ?? 0}</td></tr>`).join("")
    }</tbody></table>`;
    corps.querySelector(".hw-feuille-corps").scrollIntoView({ behavior: "smooth", block: "start" });
  };
});
