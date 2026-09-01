do $migration$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'cocorise-publisher'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'cocorise-publisher',
    '*/5 * * * *',
    $command$select public.invoke_cocorise_cloud_job('/api/cron/publisher');$command$
  );
end
$migration$;
