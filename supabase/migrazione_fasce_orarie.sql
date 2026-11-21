-- Migrazione: orario di fine per le attività (fasce orarie).
-- Da eseguire UNA volta su Supabase: SQL Editor → New query → incolla → Run.
-- Aggiunge solo una colonna vuota: le attività già salvate restano come sono.

alter table public.tasks add column if not exists end_time text;   -- "HH:MM" oppure vuoto
