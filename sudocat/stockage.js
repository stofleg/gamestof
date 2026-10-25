/* =========================================================================
   Sudocat — comptes, joueurs et sauvegarde
   Un compte (email + mot de passe) a un joueur principal (son profil) et peut
   avoir des joueurs secondaires (ex. les enfants) : chacun garde son palier,
   son thème et sa partie en cours. Un joueur est désigné par j : null pour le
   joueur principal, sinon l'id du joueur secondaire.

   Deux implémentations de la même interface (méthodes async) :
     - SupabaseStore : projet Supabase de Sudocat (config.js)
     - LocalStore    : mode local de test, quand config.js est vide
   Interface :
     user() → { id, email } ou null
     signUp(email, motDePasse, pseudo), signIn(email, motDePasse), signOut(),
     resetPassword(email), updatePassword(motDePasse)
     players()                → [{ j, nom, palier, theme }]  (principal en premier)
     updatePlayer(j, patch)   (palier, theme)
     currentGame(j)           → partie en cours ou null
     startGame(j, { niveau, palier, taille, graine, theme }) → partie
     saveGame(id, patch)
     stats(j)                 → { jouees, gagnees, faciles, perdues }
   ========================================================================= */

const FRENCH_ERRORS = [
  [/Invalid login credentials/i, 'Email ou mot de passe incorrect.'],
  [/User already registered/i, 'Un compte existe déjà avec cet email.'],
  [/Password should be at least/i, 'Le mot de passe doit faire au moins 6 caractères.'],
  [/Unable to validate email|invalid format|is invalid/i, "Cette adresse email n'est pas valide."],
  [/Email not confirmed/i, "Confirme d'abord ton adresse (lien reçu par email)."],
  [/rate limit/i, 'Trop de tentatives : réessaie dans quelques minutes.'],
  [/Failed to fetch|NetworkError|Load failed/i, 'Pas de connexion au serveur : vérifie ton réseau.'],
];
function frenchError(err) {
  const msg = (err && err.message) || String(err);
  for (const [re, fr] of FRENCH_ERRORS) if (re.test(msg)) return new Error(fr);
  return new Error(msg);
}

function countStats(rows) {
  return {
    jouees: rows.filter((r) => r.resultat !== 'abandon').length,
    gagnees: rows.filter((r) => r.resultat === 'gagnee').length,
    faciles: rows.filter((r) => r.facile).length,
    perdues: rows.filter((r) => r.resultat === 'perdue').length,
  };
}

/* ------------------------------ Supabase ------------------------------ */
class SupabaseStore {
  constructor(url, key) {
    this.local = false;
    this.sb = window.supabase.createClient(url, key, { auth: { storageKey: 'sudocat-auth' } });
  }
  async user() {
    const { data } = await this.sb.auth.getSession();
    const u = data.session && data.session.user;
    return u ? { id: u.id, email: u.email, pseudo: u.user_metadata && u.user_metadata.pseudo } : null;
  }
  async signUp(email, password, pseudo) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { data: { pseudo } } });
    if (error) throw frenchError(error);
    if (!data.session) return { needsConfirmation: true };
    await this.ensureProfile(pseudo);
    return { needsConfirmation: false };
  }
  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw frenchError(error);
    await this.ensureProfile();
  }
  async signOut() { await this.sb.auth.signOut(); }
  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw frenchError(error);
  }
  async updatePassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw frenchError(error);
  }
  /** Crée le profil s'il n'existe pas encore (ex. compte confirmé par email). */
  async ensureProfile(pseudo) {
    const u = await this.user();
    if (!u) return;
    const { data } = await this.sb.from('sudocat_profils').select('user_id').eq('user_id', u.id).maybeSingle();
    if (data) return;
    const name = (pseudo || u.pseudo || u.email.split('@')[0]).slice(0, 24).padEnd(2, '_');
    const { error } = await this.sb.from('sudocat_profils').insert({ user_id: u.id, pseudo: name });
    if (error) throw frenchError(error);
  }
  async players() {
    const u = await this.user();
    const [{ data: p, error: e1 }, { data: kids, error: e2 }] = await Promise.all([
      this.sb.from('sudocat_profils').select('pseudo, palier, theme').eq('user_id', u.id).maybeSingle(),
      this.sb.from('sudocat_joueurs').select('id, nom, palier, theme').eq('user_id', u.id).order('id'),
    ]);
    if (e1) throw frenchError(e1);
    if (e2) throw frenchError(e2);
    if (!p) { await this.ensureProfile(); return this.players(); }
    return [{ j: null, nom: p.pseudo, palier: p.palier, theme: p.theme },
      ...kids.map((k) => ({ j: k.id, nom: k.nom, palier: k.palier, theme: k.theme }))];
  }
  async updatePlayer(j, patch) {
    const u = await this.user();
    const q = j == null
      ? this.sb.from('sudocat_profils').update(patch).eq('user_id', u.id)
      : this.sb.from('sudocat_joueurs').update(patch).eq('id', j);
    const { error } = await q;
    if (error) throw frenchError(error);
  }
  forPlayer(q, j) { return j == null ? q.is('joueur_id', null) : q.eq('joueur_id', j); }
  async currentGame(j) {
    const u = await this.user();
    const q = this.sb.from('sudocat_parties').select('*').eq('user_id', u.id).is('resultat', null);
    const { data, error } = await this.forPlayer(q, j).order('commencee_le', { ascending: false }).limit(1);
    if (error) throw frenchError(error);
    return data[0] || null;
  }
  async startGame(j, g) {
    const { data, error } = await this.sb.from('sudocat_parties').insert({ ...g, joueur_id: j }).select('*').single();
    if (error) throw frenchError(error);
    return data;
  }
  async saveGame(id, patch) {
    const { error } = await this.sb.from('sudocat_parties').update(patch).eq('id', id);
    if (error) throw frenchError(error);
  }
  async stats(j) {
    const u = await this.user();
    const q = this.sb.from('sudocat_parties').select('resultat, facile').eq('user_id', u.id).not('resultat', 'is', null);
    const { data, error } = await this.forPlayer(q, j);
    if (error) throw frenchError(error);
    return countStats(data);
  }
}

/* ------------------------------ Mode local (test) ------------------------------ */
class LocalStore {
  constructor() { this.local = true; this.KEY = 'sudocat-local-v2'; }
  read() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || { comptes: {}, session: null, nextId: 1 }; }
    catch { return { comptes: {}, session: null, nextId: 1 }; }
  }
  write(db) { try { localStorage.setItem(this.KEY, JSON.stringify(db)); } catch { /* stockage indisponible */ } }
  me(db) { return db.session ? db.comptes[db.session] : null; }
  async user() {
    const c = this.me(this.read());
    return c ? { id: c.email, email: c.email, pseudo: c.profil.pseudo } : null;
  }
  async signUp(email, password, pseudo) {
    const db = this.read();
    email = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Cette adresse email n'est pas valide.");
    if (password.length < 6) throw new Error('Le mot de passe doit faire au moins 6 caractères.');
    if (db.comptes[email]) throw new Error('Un compte existe déjà avec cet email.');
    db.comptes[email] = { email, motDePasse: password, profil: { pseudo, palier: 1, theme: 'chat' }, joueurs: [], parties: [] };
    db.session = email;
    this.write(db);
    return { needsConfirmation: false };
  }
  async signIn(email, password) {
    const db = this.read();
    const c = db.comptes[email.trim().toLowerCase()];
    if (!c || c.motDePasse !== password) throw new Error('Email ou mot de passe incorrect.');
    db.session = c.email;
    this.write(db);
  }
  async signOut() { const db = this.read(); db.session = null; this.write(db); }
  async resetPassword() { throw new Error('Mode local : pas d’email de réinitialisation.'); }
  async updatePassword() { throw new Error('Mode local : pas de réinitialisation.'); }
  /** Mode local seulement : ajoute un joueur secondaire (en ligne, c'est fait en SQL). */
  async addPlayer(nom) {
    const db = this.read();
    this.me(db).joueurs.push({ id: db.nextId++, nom, palier: 1, theme: 'chat' });
    this.write(db);
  }
  async players() {
    const c = this.me(this.read());
    return [{ j: null, nom: c.profil.pseudo, palier: c.profil.palier, theme: c.profil.theme },
      ...c.joueurs.map((k) => ({ j: k.id, nom: k.nom, palier: k.palier, theme: k.theme }))];
  }
  async updatePlayer(j, patch) {
    const db = this.read(), c = this.me(db);
    Object.assign(j == null ? c.profil : c.joueurs.find((k) => k.id === j), patch);
    this.write(db);
  }
  async currentGame(j) {
    const games = this.me(this.read()).parties;
    for (let k = games.length - 1; k >= 0; k--) {
      if (games[k].resultat == null && (games[k].joueur_id ?? null) === j) return { ...games[k] };
    }
    return null;
  }
  async startGame(j, g) {
    const db = this.read();
    const row = { id: db.nextId++, etat: null, erreurs: 0, duree_ms: 0, resultat: null, facile: null,
      commencee_le: new Date().toISOString(), finie_le: null, ...g, joueur_id: j };
    this.me(db).parties.push(row);
    this.write(db);
    return { ...row };
  }
  async saveGame(id, patch) {
    const db = this.read();
    const row = this.me(db).parties.find((p) => p.id === id);
    if (row) Object.assign(row, patch);
    this.write(db);
  }
  async stats(j) {
    return countStats(this.me(this.read()).parties.filter((p) => p.resultat != null && (p.joueur_id ?? null) === j));
  }
}

function makeStore() {
  const url = window.SUDOCAT_SUPABASE_URL, key = window.SUDOCAT_SUPABASE_ANON_KEY;
  if (url && key && window.supabase) return new SupabaseStore(url, key);
  return new LocalStore();
}
