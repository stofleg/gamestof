-- ============================================================
--  Tournoi de la Mort : classement avec SCORE FINAL (positif, le vainqueur a le maximum)
--  À exécuter dans Supabase > SQL Editor (après schema-halloween.sql). Idempotent.
-- ============================================================

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
