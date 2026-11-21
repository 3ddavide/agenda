-- Migrazione: permessi sulla tabella push_subs per gli utenti collegati.
-- Serve perché questo progetto Supabase non dà permessi automatici alle tabelle nuove:
-- senza, "Attiva promemoria" fallisce con "permission denied for table push_subs".
-- Da eseguire UNA volta su Supabase: SQL Editor → New query → incolla → Run.
-- Le regole RLS restano attive: ognuno vede e modifica solo le proprie iscrizioni.

grant select, insert, update, delete on table public.push_subs to authenticated;

-- La Edge Function "promemoria" usa il ruolo del server (service_role): deve poter leggere
-- iscrizioni, attività e giorni, e cancellare le iscrizioni scadute.
grant select, delete on table public.push_subs to service_role;
grant select on table public.tasks, public.days to service_role;
