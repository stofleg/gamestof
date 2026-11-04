-- ============================================================
--  Tournoi de la Mort : résultats d'UNE partie publique, lisibles par tous les inscrits
--  (classement de la partie, classements intermédiaires, feuilles de route des autres).
--  Les joueurs « halloween » ne lisent que leurs propres lignes de prepared_game_results
--  (RLS) : cette fonction leur donne les parties TERMINÉES des autres, pour les seules
--  parties d'un tournoi public. À exécuter dans Supabase > SQL Editor. Idempotent.
-- ============================================================
drop function if exists public.resultats_partie_publique(bigint);
create or replace function public.resultats_partie_publique(p_game bigint)
returns table (player_id bigint, name text, sum_neg int, total_time_seconds int,
               played_on_mobile boolean, details jsonb, summary jsonb)
language sql stable security definer set search_path = public as $$
  select r.player_id, p.name, r.sum_neg, r.total_time_seconds, r.played_on_mobile, r.details, r.summary
    from prepared_game_results r
    join players p on p.id = r.player_id
   where r.prepared_game_id = p_game
     and est_partie_publique(p_game)
     and auth.uid() is not null
     and r.paused is null;                 -- parties terminées seulement
$$;
revoke all on function public.resultats_partie_publique(bigint) from public, anon;
grant execute on function public.resultats_partie_publique(bigint) to authenticated;
