-- ============================================================
--  Superadmin « stof »
--
--  Depuis la refonte des rôles, le pseudo « stof » est un SUPERADMIN
--  (via le bouton « admin » de l'interface) : il doit avoir les mêmes
--  droits d'écriture que le compte « admin » (créer/verrouiller des
--  tournois, générer des parties pré-tirées, etc.).
--
--  Toutes les politiques RLS d'écriture (tournaments, prepared_games,
--  games, results, players…) reposent sur la fonction is_admin(). Il
--  suffit donc d'élargir is_admin() pour qu'elle reconnaisse aussi le
--  joueur dont le NOM est « admin » ou « stof » (en plus de l'email
--  historique admin@garenna.fr).
--
--  À exécuter UNE FOIS dans l'éditeur SQL de Supabase.
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from players
    where auth_user_id = auth.uid()
      and (lower(email) = 'admin@garenna.fr' or name in ('admin', 'stof'))
  );
$$;
