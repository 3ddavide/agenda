-- Migrazione: iscrizioni alle notifiche push ("Attiva promemoria").
-- Da eseguire UNA volta su Supabase: SQL Editor → New query → incolla → Run.
-- Crea solo una tabella nuova: i dati già salvati restano come sono.

create table if not exists public.push_subs (
  endpoint text primary key,                   -- indirizzo a cui il servizio push di Apple consegna le notifiche
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,                        -- chiave pubblica del telefono (cifratura del messaggio)
  auth text not null,                          -- segreto del telefono (cifratura del messaggio)
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs (user_id);

alter table public.push_subs enable row level security;
grant select, insert, update, delete on table public.push_subs to authenticated;
grant select, delete on table public.push_subs to service_role;
grant select on table public.tasks, public.days to service_role;

drop policy if exists "solo le mie iscrizioni" on public.push_subs;
create policy "solo le mie iscrizioni" on public.push_subs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
