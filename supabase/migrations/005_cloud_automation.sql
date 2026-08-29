create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.invoke_cocorise_cloud_job(job_path text)
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $function$
declare
  app_url text;
  cron_secret text;
  request_id bigint;
begin
  if job_path not in ('/api/cron/drive-sync', '/api/cron/scheduler', '/api/cron/publisher') then
    raise exception 'Unsupported Cocorise job path';
  end if;

  select decrypted_secret into app_url
  from vault.decrypted_secrets
  where name = 'cocorise_app_url';

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'cocorise_cron_secret';

  if app_url is null or cron_secret is null then
    raise exception 'Cocorise cloud job secrets are not configured';
  end if;

  select net.http_get(
    url := app_url || job_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'User-Agent', 'Supabase-Cron/1.0'
    ),
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end;
$function$;

create or replace function public.configure_cocorise_cloud_jobs(target_url text, bearer_secret text)
returns table(job_name text, schedule text)
language plpgsql
security definer
set search_path = public, vault, extensions
as $function$
declare
  app_url_id uuid;
  cron_secret_id uuid;
  old_job record;
  normalized_url text := rtrim(target_url, '/');
begin
  if normalized_url !~ '^https://[A-Za-z0-9.-]+$' then
    raise exception 'target_url must be a public HTTPS origin without a path';
  end if;
  if length(bearer_secret) < 32 then
    raise exception 'bearer_secret must contain at least 32 characters';
  end if;

  select id into app_url_id from vault.secrets where name = 'cocorise_app_url';
  if app_url_id is null then
    perform vault.create_secret(normalized_url, 'cocorise_app_url', 'Cocorise production origin used by Supabase Cron');
  else
    perform vault.update_secret(app_url_id, normalized_url, 'cocorise_app_url', 'Cocorise production origin used by Supabase Cron');
  end if;

  select id into cron_secret_id from vault.secrets where name = 'cocorise_cron_secret';
  if cron_secret_id is null then
    perform vault.create_secret(bearer_secret, 'cocorise_cron_secret', 'Bearer secret used to invoke Cocorise cron routes');
  else
    perform vault.update_secret(cron_secret_id, bearer_secret, 'cocorise_cron_secret', 'Bearer secret used to invoke Cocorise cron routes');
  end if;

  for old_job in
    select jobid from cron.job
    where jobname in ('cocorise-drive-sync', 'cocorise-scheduler', 'cocorise-publisher')
  loop
    perform cron.unschedule(old_job.jobid);
  end loop;

  perform cron.schedule(
    'cocorise-drive-sync',
    '*/15 * * * *',
    $$select public.invoke_cocorise_cloud_job('/api/cron/drive-sync');$$
  );
  perform cron.schedule(
    'cocorise-scheduler',
    '*/30 * * * *',
    $$select public.invoke_cocorise_cloud_job('/api/cron/scheduler');$$
  );
  perform cron.schedule(
    'cocorise-publisher',
    '*/10 * * * *',
    $$select public.invoke_cocorise_cloud_job('/api/cron/publisher');$$
  );

  return query
  select j.jobname::text, j.schedule::text
  from cron.job as j
  where j.jobname in ('cocorise-drive-sync', 'cocorise-scheduler', 'cocorise-publisher')
  order by j.jobname;
end;
$function$;

create or replace function public.disable_cocorise_cloud_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  old_job record;
  removed integer := 0;
begin
  for old_job in
    select jobid from cron.job
    where jobname in ('cocorise-drive-sync', 'cocorise-scheduler', 'cocorise-publisher')
  loop
    perform cron.unschedule(old_job.jobid);
    removed := removed + 1;
  end loop;
  return removed;
end;
$function$;

revoke all on function public.invoke_cocorise_cloud_job(text) from public, anon, authenticated;
revoke all on function public.configure_cocorise_cloud_jobs(text, text) from public, anon, authenticated;
revoke all on function public.disable_cocorise_cloud_jobs() from public, anon, authenticated;
