-- Marque si une partie tournoi a été jouée sur un appareil mobile/tactile.
-- Utilisé pour afficher un picto 📱 à côté du temps dans le classement.
-- À exécuter une fois dans l'éditeur SQL Supabase.
alter table prepared_game_results
  add column if not exists played_on_mobile boolean default false;
