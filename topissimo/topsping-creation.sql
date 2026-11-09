-- ============================================================
--  TopSping : création d'un tournoi (à exécuter dans l'éditeur SQL de Supabase).
--  Les parties sont pré-générées dans topissimo/topsping/ts1/ (une réserve par tour) :
--  la ligne prepared_games ne contient que le nom de la réserve.
--  Pour un nouveau TopSping avec d'autres parties : demander une nouvelle réserve (ts2…)
--  et remplacer 'ts1' ci-dessous.
-- ============================================================
with t as (
  insert into tournaments (name, created_by_player_id)
  values ('TopSping', (select id from players where lower(name) = 'stof' order by id limit 1))
  returning id, created_by_player_id
)
insert into prepared_games (name, mode, with_joker, time_per_move, moves, total_top_score, created_by_player_id, tournament_id)
select 'TopSping', 'topsping', false, 40, '[{"_topsping": {"reserve": "ts1"}}]'::jsonb, 0, t.created_by_player_id, t.id
from t
returning id, tournament_id;
