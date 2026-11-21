-- Schema del database dell'agenda.
-- Incollalo in Supabase → SQL Editor → New query, e premi Run. Si esegue una volta sola.
-- Ogni riga appartiene a un utente (user_id) e le regole RLS fanno sì che
-- ognuno veda e modifichi solo i propri dati.

-- Un giorno: abitudini spuntate e 3 priorità
create table if not exists public.days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  h jsonb not null default '{}'::jsonb,        -- es. {"sveglia": true, "medit": false}
  top jsonb,                                   -- es. ["Ripasso cap. 4", "", ""]
  topd jsonb,                                  -- es. [true, false, false]
  fx jsonb,                                    -- impegni fissi cambiati solo quel giorno, es. {"train": {"skip": true}}
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- Attività singole e scadenze
create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  date date,
  time text,                                   -- "HH:MM" oppure vuoto
  end_time text,                               -- fine della fascia oraria, "HH:MM" oppure vuoto
  area text not null default 'pers' check (area in ('uni','sport','lavoro','pers','eventi')),
  dl boolean not null default false,           -- true = scadenza (esame, consegna)
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- Obiettivi del mese
create table if not exists public.goals (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  month text not null,                         -- "AAAA-MM"
  area text not null default 'pers' check (area in ('uni','sport','lavoro','pers','eventi')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists tasks_user_date on public.tasks (user_id, date);
create index if not exists goals_user_month on public.goals (user_id, month);

alter table public.days  enable row level security;
alter table public.tasks enable row level security;
alter table public.goals enable row level security;

drop policy if exists "solo i miei giorni" on public.days;
create policy "solo i miei giorni" on public.days
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "solo le mie attivita" on public.tasks;
create policy "solo le mie attivita" on public.tasks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "solo i miei obiettivi" on public.goals;
create policy "solo i miei obiettivi" on public.goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Aggiorna updated_at quando cambi un giorno
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists days_touch on public.days;
create trigger days_touch before update on public.days for each row execute function public.touch_updated_at();
