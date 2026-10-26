-- ============================================================
--  Direct FFSc — classement des joueurs du club qui jouent en direct
--
--  Une ligne par joueur et par coup clos : ses points sur le coup, le top
--  officiel et le mot retenu. Le classement « Garenna en direct » se calcule
--  à partir de ces lignes (négatif cumulé).
--
--  Règles d'accès (comme schema-rls-hardening.sql) :
--   - lecture : membres authentifiés ;
--   - écriture : uniquement sur ses propres lignes.
--
--  À exécuter dans Supabase > SQL Editor > New query.
--  Idempotent : peut être relancé sans casse.
-- ============================================================

create table if not exists ffsc_live_scores (
  tournoi     text        not null,          -- identifiant FFSc du tournoi (ex. 26922)
  numero      int         not null,          -- numéro de la partie
  player_id   bigint      not null references players(id) on delete cascade,
  move_no     int         not null,          -- numéro du coup
  score       int         not null,          -- points du joueur sur ce coup
  top_score   int         not null,          -- top officiel du coup
  word        text,                          -- mot retenu (null : aucun)
  updated_at  timestamptz not null default now(),
  primary key (tournoi, numero, player_id, move_no)
);

create index if not exists ffsc_live_scores_partie
  on ffsc_live_scores (tournoi, numero);

alter table ffsc_live_scores enable row level security;

drop policy if exists "auth read"   on ffsc_live_scores;
drop policy if exists "self insert" on ffsc_live_scores;
drop policy if exists "self update" on ffsc_live_scores;

create policy "auth read" on ffsc_live_scores
  for select using (auth.role() = 'authenticated');

create policy "self insert" on ffsc_live_scores
  for insert with check (player_id = public.current_player_id());

create policy "self update" on ffsc_live_scores
  for update using (player_id = public.current_player_id())
  with check (player_id = public.current_player_id());
