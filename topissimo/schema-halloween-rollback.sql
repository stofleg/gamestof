-- ============================================================
--  Retour arrière de schema-halloween.sql
--  Remet les règles d'accès de schema-rls-hardening.sql +
--  schema-superadmin-stof.sql. Les colonnes ajoutées (scope, is_admin,
--  est_public) et la table ip_traces sont conservées (sans effet), sauf
--  si on décommente la fin.
-- ============================================================

drop trigger  if exists players_garde_fou on players;
drop function if exists public.players_garde_fou();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from players
    where auth_user_id = auth.uid()
      and (lower(email) = 'admin@garenna.fr' or name in ('admin', 'stof'))
  );
$$;

-- Lecture « tout membre connecté » partout où is_club() avait été mis
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public' and cmd = 'SELECT' and qual ilike '%is_club()%'
  loop
    execute format('alter policy %I on %I.%I using (auth.role() = ''authenticated'')',
                   p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

drop policy if exists "self insert" on players;
create policy "self insert" on players
  for insert with check (auth.uid() is not null and (auth_user_id = auth.uid() or auth_user_id is null));

drop policy if exists "self insert" on training_games;
create policy "self insert" on training_games
  for insert with check (player_id = current_player_id());

drop policy if exists "self insert" on prepared_game_results;
create policy "self insert" on prepared_game_results
  for insert with check (player_id = current_player_id());

drop view     if exists public.ip_partagees;
drop function if exists public.classement_public(bigint);
drop function if exists public.note_ip(text);
drop function if exists public.pseudo_libre(text);

-- Réclamation par pseudo (supprimée par la migration) : non recréée.

-- Pour tout effacer :
-- drop table if exists ip_traces;
-- alter table players drop column if exists scope, drop column if exists is_admin;
-- alter table tournaments drop column if exists est_public;
