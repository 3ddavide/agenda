-- Migrazione: "salta solo oggi" / "sposta orario solo oggi" sugli impegni fissi.
-- Da eseguire UNA volta su Supabase: SQL Editor → New query → incolla → Run.
-- Aggiunge solo una colonna vuota alla tabella dei giorni: i dati già salvati restano come sono.
-- Contenuto: { "train": { "skip": true }, "rec:Pulizia della camera": { "t": "15:00" } }

alter table public.days add column if not exists fx jsonb;
