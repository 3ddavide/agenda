-- Migrazione: nuova area "eventi" per attività e obiettivi.
-- Da eseguire UNA volta su Supabase: SQL Editor → New query → incolla → Run.
-- Non cancella né modifica i dati già salvati: allarga solo l'elenco delle aree permesse.

alter table public.tasks drop constraint if exists tasks_area_check;
alter table public.tasks add constraint tasks_area_check
  check (area in ('uni','sport','lavoro','pers','eventi'));

alter table public.goals drop constraint if exists goals_area_check;
alter table public.goals add constraint goals_area_check
  check (area in ('uni','sport','lavoro','pers','eventi'));
