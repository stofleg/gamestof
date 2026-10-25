-- =====================================================================
-- Sudocat — mise à jour v2 (à coller dans SQL Editor → Run, une seule fois)
--   1. 100 paliers de progression (au lieu de 6 niveaux)
--   2. Joueurs secondaires sur un même compte (ex. les enfants)
--   3. Soline et Emile sur le compte de Marion
-- Le script peut être relancé sans dommage.
-- =====================================================================

-- 1. Paliers -----------------------------------------------------------
alter table public.sudocat_profils add column if not exists palier smallint not null default 1;
alter table public.sudocat_profils drop constraint if exists sudocat_profils_palier_check;
alter table public.sudocat_profils add constraint sudocat_profils_palier_check check (palier between 1 and 100);
-- Les joueurs existants reprennent au premier palier de leur ancien niveau.
update public.sudocat_profils
   set palier = (array[1, 13, 29, 46, 65, 85])[niveau]
 where palier = 1 and niveau > 1;

alter table public.sudocat_parties add column if not exists palier smallint;

-- 2. Joueurs secondaires ------------------------------------------------
create table if not exists public.sudocat_joueurs (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade default auth.uid(),
  nom       text not null check (char_length(nom) between 1 and 24),
  palier    smallint not null default 1 check (palier between 1 and 100),
  theme     text not null default 'chat' check (theme in ('chat', 'chien')),
  cree_le   timestamptz not null default now()
);
create index if not exists sudocat_joueurs_compte on public.sudocat_joueurs (user_id);
alter table public.sudocat_joueurs enable row level security;

drop policy if exists "joueurs : lecture" on public.sudocat_joueurs;
drop policy if exists "joueurs : création" on public.sudocat_joueurs;
drop policy if exists "joueurs : modification" on public.sudocat_joueurs;
create policy "joueurs : lecture"      on public.sudocat_joueurs for select using (auth.uid() = user_id);
create policy "joueurs : création"     on public.sudocat_joueurs for insert with check (auth.uid() = user_id);
create policy "joueurs : modification" on public.sudocat_joueurs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Une partie appartient au titulaire du compte (joueur_id vide) ou à l'un de ses joueurs.
alter table public.sudocat_parties add column if not exists joueur_id bigint references public.sudocat_joueurs(id) on delete cascade;
create index if not exists sudocat_parties_joueur_id on public.sudocat_parties (user_id, joueur_id, commencee_le desc);

drop policy if exists "parties : création" on public.sudocat_parties;
drop policy if exists "parties : modification" on public.sudocat_parties;
create policy "parties : création" on public.sudocat_parties for insert with check (
  auth.uid() = user_id and (joueur_id is null or exists (
    select 1 from public.sudocat_joueurs j where j.id = joueur_id and j.user_id = auth.uid())));
create policy "parties : modification" on public.sudocat_parties for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and (joueur_id is null or exists (
    select 1 from public.sudocat_joueurs j where j.id = joueur_id and j.user_id = auth.uid())));

-- 3. Soline et Emile sur le compte de Marion ------------------------------
-- Ajoutés au compte dont le pseudo est « Marion » (majuscules indifférentes),
-- seulement s'ils n'existent pas déjà. Le résultat affiche les joueurs créés :
-- s'il est vide, vérifier le pseudo exact avec
--   select pseudo from public.sudocat_profils;
insert into public.sudocat_joueurs (user_id, nom)
select p.user_id, n.nom
  from public.sudocat_profils p
  cross join (values ('Soline'), ('Emile')) as n(nom)
 where lower(p.pseudo) = 'marion'
   and not exists (select 1 from public.sudocat_joueurs j where j.user_id = p.user_id and j.nom = n.nom)
returning nom, user_id;
