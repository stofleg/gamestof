-- ============================================================
--  Tournoi de la Mort : classement avec SCORE FINAL (positif, le vainqueur a le maximum)
--  À exécuter dans Supabase > SQL Editor (après schema-halloween.sql). Idempotent.
-- ============================================================

-- Classement d'un tournoi public (tournoi de la Mort) : pseudos et scores uniquement.
--   Score final = points marqués + points Jigsaw − 1 point par minute ENTIÈRE de retard sur le
--   temps total le plus court (parmi les joueurs ayant terminé TOUTES les parties du tournoi) :
--   le vainqueur a le score le plus élevé.
--   Points Jigsaw (500 au maximum) : terminé = 250 (résolution) + 250 (temps) − 3 points par
--   minute de retard sur le Jigsaw TERMINÉ le plus rapide (au prorata, arrondi, part temps ≥ 0) ;
--   abandonné = points d'essai selon le temps de recherche enregistré (sans pénalité) : 0 avant
--   15 min, 125 à 15 min, au prorata jusqu'à 200 à 30 min, 200 au-delà.
--   Mêmes valeurs que pointsJigsaw (scrabble/engine.js).
--   Les joueurs n'ayant pas tout terminé sont listés après, sans score final.
drop function if exists public.classement_public(bigint);
create or replace function public.classement_public(p_tournament bigint)
returns table (rang int, joueur text, parties int, total_parties int, total_points bigint,
               total_neg bigint, temps_total bigint, retard_min int, jigsaw_pts int, score_final bigint)
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
  jig as (
    select p.name as joueur, r.total_time_seconds as t,
           coalesce((r.summary->>'ab')::boolean, false) as ab
      from prepared_game_results r
      join prepared_games g on g.id = r.prepared_game_id and g.tournament_id = p_tournament and g.mode = 'puzzle'
      join players p on p.id = r.player_id
     where r.paused is null and r.summary is not null and p.name <> 'admin'
  ),
  jig_min as (select min(t) as t from jig where not ab),
  meilleur as (
    select min(res.temps_total) as t from res, nb where res.parties = nb.n and nb.n > 0
  ),
  calc as (
    select res.*, nb.n as total_parties,
           (res.parties = nb.n and nb.n > 0) as termine,
           case when res.parties = nb.n and nb.n > 0
                then (floor(greatest(0, res.temps_total - meilleur.t) / 60.0))::int end as retard_min,   -- minutes entières
           (case when jig.joueur is null then 0
                 when jig.ab then (case when jig.t < 900 then 0
                                        else round(125 + 75 * least(1.0, (jig.t - 900) / 900.0)) end)
                 else 250 + greatest(0, 250 - round(3.0 * greatest(0, jig.t - jig_min.t) / 60.0)) end)::int as jigsaw_pts
      from res cross join nb cross join meilleur cross join jig_min
      left join jig on jig.joueur = res.joueur
  )
  select case when termine
              then (rank() over (partition by termine order by (total_points + jigsaw_pts - retard_min) desc, temps_total asc))::int end as rang,
         joueur, parties, total_parties, total_points, total_neg, temps_total, retard_min, jigsaw_pts,
         case when termine then (total_points + jigsaw_pts - retard_min)::bigint end as score_final
    from calc
   order by termine desc, (total_points + jigsaw_pts - coalesce(retard_min, 0)) desc, parties desc, temps_total asc;
$$;
grant execute on function public.classement_public(bigint) to authenticated;
