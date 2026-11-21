-- Migrazione: promemoria serale alle 21:30 (ora italiana) con pg_cron.
-- Da eseguire DOPO aver creato la Edge Function "promemoria".
-- Supabase: SQL Editor → New query → incolla → Run. Si può rieseguire senza problemi.
--
-- Ora legale: pg_cron usa l'ora UTC. Le 21:30 italiane sono le 20:30 UTC d'inverno e le
-- 19:30 UTC d'estate, quindi programmiamo ENTRAMBE: la Edge Function controlla l'ora
-- italiana e invia solo quando sono le 21. Al cambio d'ora non serve toccare niente.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Codice segreto casuale nel Vault (cassaforte cifrata): protegge la chiamata alla
-- Edge Function. Viene generato qui dentro e non compare in nessun file.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'promemoria_cron') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'promemoria_cron',
      'Codice segreto: pg_cron -> Edge Function promemoria');
  end if;
end $$;

-- Legge il codice segreto. Può usarla SOLO il server (service_role), non l'app.
create or replace function public.promemoria_secret() returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'promemoria_cron' limit 1
$$;
revoke all on function public.promemoria_secret() from public, anon, authenticated;
grant execute on function public.promemoria_secret() to service_role;

-- Toglie i job precedenti con lo stesso nome (per poter rieseguire la migrazione).
select cron.unschedule(jobname) from cron.job
where jobname in ('promemoria-1930-utc', 'promemoria-2030-utc');

-- 19:30 UTC = 21:30 in Italia con l'ora legale (estate).
select cron.schedule('promemoria-1930-utc', '30 19 * * *', $job$
  select net.http_post(
    url := 'https://mpzyrywlzsacjnnlhxed.supabase.co/functions/v1/promemoria',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.promemoria_secret()),
    body := '{"mode":"cron"}'::jsonb
  );
$job$);

-- 20:30 UTC = 21:30 in Italia con l'ora solare (inverno).
select cron.schedule('promemoria-2030-utc', '30 20 * * *', $job$
  select net.http_post(
    url := 'https://mpzyrywlzsacjnnlhxed.supabase.co/functions/v1/promemoria',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.promemoria_secret()),
    body := '{"mode":"cron"}'::jsonb
  );
$job$);

-- Controllo: deve mostrare i due job.
select jobname, schedule, active from cron.job where jobname like 'promemoria-%';
