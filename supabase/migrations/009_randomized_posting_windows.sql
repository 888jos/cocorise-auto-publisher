update app_settings
set
  morning_start = '06:30',
  morning_end = '07:30',
  afternoon_start = '16:30',
  afternoon_end = '17:30',
  evening_start = '21:30',
  evening_end = '22:30',
  min_stagger_minutes = 0,
  max_stagger_minutes = 59,
  updated_at = now()
where id = true;

with future_slots as (
  select
    publication.id,
    coalesce(account.timezone, 'Europe/Paris') as timezone,
    (publication.scheduled_at at time zone coalesce(account.timezone, 'Europe/Paris'))::date as local_day,
    case
      when (publication.scheduled_at at time zone coalesce(account.timezone, 'Europe/Paris'))::time < '12:00' then '06:30'::time
      when (publication.scheduled_at at time zone coalesce(account.timezone, 'Europe/Paris'))::time < '20:00' then '16:30'::time
      else '21:30'::time
    end as window_start,
    case
      when (publication.scheduled_at at time zone coalesce(account.timezone, 'Europe/Paris'))::time < '12:00' then 'Morning'
      when (publication.scheduled_at at time zone coalesce(account.timezone, 'Europe/Paris'))::time < '20:00' then 'Afternoon'
      else 'Evening'
    end as window_name,
    publication.account_group_id
  from publications publication
  join account_groups account on account.id = publication.account_group_id
  where publication.status = 'scheduled'
    and publication.provider_job_id is null
    and publication.scheduled_at > now()
), randomized_slots as (
  select
    id,
    (
      local_day
      + window_start
      + make_interval(
          mins => abs(
            mod(
              hashtextextended(account_group_id::text || ':' || local_day::text || ':' || window_name, 0),
              60
            )::integer
          )
        )
    ) at time zone timezone as scheduled_at
  from future_slots
)
update publications publication
set scheduled_at = randomized.scheduled_at
from randomized_slots randomized
where publication.id = randomized.id;
