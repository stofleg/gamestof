-- ============================================================
--  Tournoi public (Halloween) — cloisonnement des comptes
--
--  Deux sortes de joueurs :
--    • scope = 'club'      : membres du club, droits inchangés ;
--    • scope = 'halloween' : comptes créés par la page publique du tournoi.
--      Ils ne voient QUE les tournois marqués publics, leurs parties, leurs
--      propres résultats et un classement (pseudos + scores, sans email).
--
--  Toute inscription libre crée un compte 'halloween' : un compte club est
--  forcément un joueur pré-créé par l'admin (avec son email), réclamé à la
--  première connexion par claim_player_by_email().
--
--  Corrige aussi deux failles :
--    • l'admin n'est plus reconnu par son PSEUDO (renommable) mais par une
--      colonne is_admin que seul un admin peut modifier ;
--    • suppression de claim_player(pseudo) (réclamation par pseudo seul).
--
--  À exécuter dans Supabase > SQL Editor. Idempotent.
--  Retour arrière : schema-halloween-rollback.sql
-- ============================================================

-- ------------------------------------------------------------
--  1) Colonnes
-- ------------------------------------------------------------
alter table players add column if not exists scope text not null default 'club';
alter table players drop constraint if exists players_scope_check;
alter table players add constraint players_scope_check check (scope in ('club', 'halloween'));
alter table players add column if not exists is_admin boolean not null default false;

-- Les admins actuels (avant que le pseudo ne compte plus)
update players set is_admin = true
 where lower(coalesce(email, '')) = 'admin@garenna.fr' or name in ('admin', 'stof');

alter table tournaments add column if not exists est_public boolean not null default false;

-- Empreintes d'IP (équité du tournoi public) — jamais l'IP en clair
create table if not exists ip_traces (
  id          bigserial primary key,
  player_id   bigint not null references players(id) on delete cascade,
  empreinte   text   not null,
  evenement   text   not null,           -- 'inscription', 'partie', …
  created_at  timestamptz not null default now()
);
alter table ip_traces enable row level security;

-- ------------------------------------------------------------
--  2) Fonctions
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where auth_user_id = auth.uid() and is_admin);
$$;

create or replace function public.is_club()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where auth_user_id = auth.uid() and scope = 'club');
$$;

create or replace function public.est_tournoi_public(p_tournament bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tournaments where id = p_tournament and est_public);
$$;

create or replace function public.est_partie_publique(p_prepared bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from prepared_games g join tournaments t on t.id = g.tournament_id
     where g.id = p_prepared and t.est_public
  );
$$;

-- Réclamation par pseudo seul : supprimée (n'importe qui pouvait prendre la
-- fiche d'un joueur non rattaché). L'appli n'utilise que la version email.
drop function if exists public.claim_player(text);

-- Classement d'un tournoi public (tournoi de la Mort) : pseudos et scores uniquement.
--   Score final = points marqués − 1 point par minute de retard sur le temps total le plus
--   court (parmi les joueurs ayant terminé TOUTES les parties du tournoi) : le vainqueur a le
--   score le plus élevé. À classement égal avec « négatif − retard » (le total des tops est
--   le même pour tous). Les joueurs n'ayant pas tout terminé sont listés après, sans score final.
drop function if exists public.classement_public(bigint);
create or replace function public.classement_public(p_tournament bigint)
returns table (rang int, joueur text, parties int, total_parties int, total_points bigint,
               total_neg bigint, temps_total bigint, retard_min numeric, score_final numeric)
language sql stable security definer set search_path = public as $$
  with partie as (select id from prepared_games where tournament_id = p_tournament),
  nb as (select count(*)::int as n from partie),
  res as (
    select p.name as joueur, count(*)::int as parties,
           coalesce(sum(r.total_score), 0)::bigint as total_points,
           sum(r.sum_neg)::bigint as total_neg,
           coalesce(sum(r.total_time_seconds), 0)::bigint as temps_total
      from prepared_game_results r
      join partie g on g.id = r.prepared_game_id
      join players p on p.id = r.player_id
     where est_tournoi_public(p_tournament)
       and r.paused is null                       -- partie terminée (paused = état de reprise)
       and p.name <> 'admin'                      -- comme Topissimo : seul le compte « admin » est exclu
     group by p.name
  ),
  meilleur as (
    select min(res.temps_total) as t from res, nb where res.parties = nb.n and nb.n > 0
  ),
  calc as (
    select res.*, nb.n as total_parties,
           (res.parties = nb.n and nb.n > 0) as termine,
           case when res.parties = nb.n and nb.n > 0
                then round(greatest(0, res.temps_total - meilleur.t) / 60.0, 1) end as retard_min
      from res cross join nb cross join meilleur
  )
  select case when termine
              then (rank() over (partition by termine order by (total_points - retard_min) desc))::int end as rang,
         joueur, parties, total_parties, total_points, total_neg, temps_total, retard_min,
         case when termine then round(total_points - retard_min, 1) end as score_final
    from calc
   order by termine desc, (total_points - coalesce(retard_min, 0)) desc, parties desc, temps_total asc;
$$;
grant execute on function public.classement_public(bigint) to authenticated;

-- Pseudo disponible ? (appelable avant inscription, ne révèle rien d'autre)
create or replace function public.pseudo_libre(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from players where lower(name) = lower(trim(p_name)));
$$;
grant execute on function public.pseudo_libre(text) to anon, authenticated;

-- Trace d'IP : l'adresse est lue dans les en-têtes de la requête (côté
-- serveur) et seule son empreinte salée est conservée.
create or replace function public.note_ip(p_evenement text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ip  text;
  v_pid bigint := current_player_id();
begin
  if v_pid is null then return; end if;
  v_ip := split_part(coalesce(
            current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  if v_ip = '' then return; end if;
  insert into ip_traces (player_id, empreinte, evenement)
  values (v_pid, encode(extensions.digest('topissimo-halloween:' || trim(v_ip), 'sha256'), 'hex'),
          left(p_evenement, 40));
end;
$$;
grant execute on function public.note_ip(text) to authenticated;

-- ------------------------------------------------------------
--  3) Garde-fou sur PLAYERS : un joueur ne peut pas changer lui-même son
--     périmètre, ses droits, son pseudo, son email ni son rattachement.
--     (Les fonctions SECURITY DEFINER comme claim_player_by_email passent.)
-- ------------------------------------------------------------
create or replace function public.players_garde_fou()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin() then
    new.scope        := old.scope;
    new.is_admin     := old.is_admin;
    new.name         := old.name;
    new.email        := old.email;
    new.auth_user_id := old.auth_user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists players_garde_fou on players;
create trigger players_garde_fou before update on players
  for each row execute function public.players_garde_fou();

-- ------------------------------------------------------------
--  4) Politiques PLAYERS
-- ------------------------------------------------------------
drop policy if exists "auth read"         on players;
drop policy if exists "self insert"       on players;
drop policy if exists "self/admin update" on players;
drop policy if exists "admin delete"      on players;

create policy "auth read" on players
  for select using (is_club() or auth_user_id = auth.uid());

-- Inscription : seulement sa propre fiche, forcément 'halloween', sans droits.
-- Les fiches club (et les fiches non rattachées) sont créées par l'admin.
create policy "self insert" on players
  for insert with check (
    is_admin()
    or (auth_user_id = auth.uid() and scope = 'halloween' and not is_admin)
  );

create policy "self/admin update" on players
  for update using (auth_user_id = auth.uid() or is_admin());

create policy "admin delete" on players
  for delete using (is_admin());

-- ------------------------------------------------------------
--  5) Lecture réservée au club sur TOUTES les autres tables : chaque
--     politique de lecture « tout membre connecté » devient « membre du club ».
--     (Couvre aussi les tables qui ne sont pas dans les scripts du dépôt.)
-- ------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public'
       and tablename not in ('players', 'tournaments', 'prepared_games', 'prepared_game_results')
       and cmd = 'SELECT'
       and qual ilike '%auth.role()%authenticated%'
  loop
    execute format('alter policy %I on %I.%I using (is_club())', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Écritures « sur sa propre ligne » des tables du club : membres du club seulement
drop policy if exists "self insert" on training_games;
create policy "self insert" on training_games
  for insert with check (player_id = current_player_id() and is_club());

-- ------------------------------------------------------------
--  6) Tournois et parties : le club voit tout, les autres les publics
-- ------------------------------------------------------------
drop policy if exists "auth read" on tournaments;
create policy "auth read" on tournaments
  for select using (is_club() or (est_public and auth.uid() is not null));

drop policy if exists "auth read" on prepared_games;
create policy "auth read" on prepared_games
  for select using (is_club() or (auth.uid() is not null and est_tournoi_public(tournament_id)));

-- Ancienne règle qui reconnaissait l'admin à son PSEUDO : doublon de
-- « owner update » (qui inclut déjà is_admin()), on la retire.
drop policy if exists "admin can update any prepared_game_result" on prepared_game_results;
drop policy if exists "auth read"    on prepared_game_results;
drop policy if exists "self insert"  on prepared_game_results;
create policy "auth read" on prepared_game_results
  for select using (is_club() or player_id = current_player_id());
create policy "self insert" on prepared_game_results
  for insert with check (
    player_id = current_player_id()
    and (is_club() or est_partie_publique(prepared_game_id))
  );

-- ------------------------------------------------------------
--  7) IP_TRACES : lecture admin seulement (écriture via note_ip)
-- ------------------------------------------------------------
drop policy if exists "admin read" on ip_traces;
create policy "admin read" on ip_traces for select using (is_admin());
drop policy if exists "admin delete" on ip_traces;
create policy "admin delete" on ip_traces for delete using (is_admin());

-- Comptes ayant joué depuis la même adresse (tableau admin)
create or replace view public.ip_partagees with (security_invoker = true) as
  select t.empreinte, array_agg(distinct p.name order by p.name) as joueurs, max(t.created_at) as derniere
    from ip_traces t join players p on p.id = t.player_id
   group by t.empreinte
  having count(distinct t.player_id) > 1;

-- ============================================================
--  APRÈS la migration
-- ============================================================
-- 1) Marquer le tournoi Halloween comme public :
--      update tournaments set est_public = true where id = <id du tournoi>;
-- 2) Supabase > Authentication > Sign In / Providers > Email :
--      « Confirm email » ACTIVÉ (un compte = un email vérifié).
--      Les inscriptions restent ouvertes (la page Halloween en a besoin).
-- 3) Supabase > Authentication > URL Configuration > Redirect URLs :
--      ajouter https://gamestof.fr/topissimo/halloween/
-- 4) Vérifier : select name, scope, is_admin from players where is_admin;
--      → doit lister admin et stof.
-- 5) Après le tournoi : delete from ip_traces;
-- ============================================================
