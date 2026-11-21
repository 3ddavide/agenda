-- Migrazione: permessi sulla tabella push_subs per gli utenti collegati.
-- Serve perché questo progetto Supabase non dà permessi automatici alle tabelle nuove:
-- senza, "Attiva promemoria" fallisce con "permission denied for table push_subs".
-- Da eseguire UNA volta su Supabase: SQL Editor → New query → incolla → Run.
-- Le regole RLS restano attive: ognuno vede e modifica solo le proprie iscrizioni.

grant select, insert, update, delete on table public.push_subs to authenticated;
