-- =====================================================================
-- Sudocat — tables du projet Supabase dédié (à coller dans SQL Editor → Run)
-- Chaque joueur ne voit et ne modifie que ses propres lignes (RLS).
-- =====================================================================

-- Profil : pseudo, niveau atteint (1 à 6), thème préféré.
create table if not exists public.sudocat_profils (
  user_id   uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  pseudo    text not null check (char_length(pseudo) between 2 and 24),
  niveau    smallint not null default 1 check (niveau between 1 and 6),
  theme     text not null default 'chat' check (theme in ('chat', 'chien')),
  cree_le   timestamptz not null default now()
);

-- Parties : la grille se reconstruit à l'identique à partir de (niveau, taille, graine).
-- « etat » garde la partie en cours (croix, chats posés, cases fausses, temps écoulé).
create table if not exists public.sudocat_parties (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  niveau        smallint not null check (niveau between 1 and 6),
  taille        smallint not null check (taille between 4 and 12),
  graine        bigint not null,
  theme         text not null default 'chat',
  etat          jsonb,
  erreurs       smallint not null default 0,
  duree_ms      integer not null default 0,
  resultat      text check (resultat in ('gagnee', 'perdue', 'abandon')),   -- null = en cours
  facile        boolean,                                                   -- gagnée sans erreur et dans le temps
  commencee_le  timestamptz not null default now(),
  finie_le      timestamptz
);
create index if not exists sudocat_parties_joueur on public.sudocat_parties (user_id, commencee_le desc);

alter table public.sudocat_profils enable row level security;
alter table public.sudocat_parties enable row level security;

drop policy if exists "profil : lecture" on public.sudocat_profils;
drop policy if exists "profil : création" on public.sudocat_profils;
drop policy if exists "profil : modification" on public.sudocat_profils;
create policy "profil : lecture"      on public.sudocat_profils for select using (auth.uid() = user_id);
create policy "profil : création"     on public.sudocat_profils for insert with check (auth.uid() = user_id);
create policy "profil : modification" on public.sudocat_profils for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "parties : lecture" on public.sudocat_parties;
drop policy if exists "parties : création" on public.sudocat_parties;
drop policy if exists "parties : modification" on public.sudocat_parties;
create policy "parties : lecture"      on public.sudocat_parties for select using (auth.uid() = user_id);
create policy "parties : création"     on public.sudocat_parties for insert with check (auth.uid() = user_id);
create policy "parties : modification" on public.sudocat_parties for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
