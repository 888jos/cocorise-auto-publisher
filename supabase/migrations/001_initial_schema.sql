create extension if not exists pgcrypto;

create type video_status as enum ('available', 'scheduled', 'partially_published', 'published', 'failed', 'disabled');
create type publication_status as enum ('queued', 'scheduled', 'sending', 'processing', 'published', 'failed', 'cancelled');
create type caption_platform as enum ('all', 'tiktok', 'instagram', 'youtube');
create type social_platform as enum ('tiktok', 'instagram', 'youtube');
create type social_connection_status as enum ('connected', 'expired', 'revoked', 'error');
create type platform_publication_status as enum ('pending', 'uploading', 'processing', 'published', 'failed', 'skipped');

create table app_settings (
  id boolean primary key default true,
  posts_per_day integer not null default 3 check (posts_per_day between 2 and 3),
  reuse_cooldown_hours integer not null default 96 check (reuse_cooldown_hours >= 0),
  schedule_horizon_days integer not null default 7 check (schedule_horizon_days between 1 and 30),
  morning_window tstzrange,
  afternoon_window tstzrange,
  evening_window tstzrange,
  morning_start time not null default '09:00',
  morning_end time not null default '11:00',
  afternoon_start time not null default '14:00',
  afternoon_end time not null default '17:00',
  evening_start time not null default '19:00',
  evening_end time not null default '22:00',
  min_stagger_minutes integer not null default 7,
  max_stagger_minutes integer not null default 53,
  min_minutes_between_posts integer not null default 150,
  timezone text not null default 'Europe/Paris',
  pause_all_publishing boolean not null default false,
  failure_pause_threshold integer not null default 3,
  caption_hook text not null default '',
  caption_body text not null default '',
  caption_cta text not null default '',
  caption_hashtags text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint singleton check (id)
);

insert into app_settings (id) values (true) on conflict do nothing;

create table videos (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  filename text not null,
  file_hash text not null unique,
  status video_status not null default 'available',
  created_at timestamptz not null default now(),
  imported_at timestamptz not null default now(),
  duration integer,
  caption_source text,
  times_used integer not null default 0,
  last_used_at timestamptz
);

create table account_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  upload_post_profile text,
  active boolean not null default true,
  posts_per_day integer not null default 3 check (posts_per_day between 2 and 3),
  timezone text not null default 'Europe/Paris',
  tiktok_enabled boolean not null default true,
  instagram_enabled boolean not null default true,
  youtube_enabled boolean not null default true,
  consecutive_failures integer not null default 0,
  paused_reason text,
  created_at timestamptz not null default now()
);

create table social_connections (
  id uuid primary key default gen_random_uuid(),
  account_group_id uuid not null references account_groups(id) on delete cascade,
  platform social_platform not null,
  status social_connection_status not null default 'connected',
  external_account_id text not null,
  external_username text,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_connection_per_platform unique (account_group_id, platform)
);

create table caption_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template text not null,
  active boolean not null default true,
  weight integer not null default 1 check (weight > 0),
  platform caption_platform not null default 'all',
  created_at timestamptz not null default now()
);

create table publications (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete restrict,
  account_group_id uuid not null references account_groups(id) on delete restrict,
  scheduled_at timestamptz not null,
  caption text not null,
  caption_template_id uuid references caption_templates(id) on delete set null,
  status publication_status not null default 'queued',
  platform_results jsonb not null default '{}'::jsonb,
  provider_job_id text,
  provider_request_id text,
  provider_status text,
  usage_recorded boolean not null default false,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  failed_at timestamptz,
  retry_count integer not null default 0,
  next_retry_at timestamptz,
  error_message text,
  constraint no_duplicate_video_account unique (video_id, account_group_id),
  constraint one_account_slot unique (account_group_id, scheduled_at)
);

create table publication_platforms (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references publications(id) on delete cascade,
  platform social_platform not null,
  status platform_publication_status not null default 'pending',
  external_post_id text,
  upload_session_id text,
  post_url text,
  raw_status jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  published_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_platform_send unique (publication_id, platform)
);

create table action_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  video_id uuid references videos(id) on delete set null,
  account_group_id uuid references account_groups(id) on delete set null,
  publication_id uuid references publications(id) on delete set null,
  action text not null,
  status text not null,
  error text
);

create index publications_status_scheduled_idx on publications(status, scheduled_at);
create index publications_account_status_idx on publications(account_group_id, status);
create index publications_provider_request_idx on publications(provider_request_id) where provider_request_id is not null;
create index publication_platforms_status_idx on publication_platforms(status, updated_at);
create index social_connections_account_idx on social_connections(account_group_id, platform, status);
create index videos_status_usage_idx on videos(status, times_used, last_used_at);

create or replace function increment_video_usage(target_video_id uuid)
returns void
language sql
security definer
as $$
  update videos
  set times_used = times_used + 1,
      last_used_at = now(),
      status = case when status = 'scheduled' then 'available'::video_status else status end
  where id = target_video_id;
$$;

alter table app_settings enable row level security;
alter table videos enable row level security;
alter table account_groups enable row level security;
alter table caption_templates enable row level security;
alter table publications enable row level security;
alter table publication_platforms enable row level security;
alter table social_connections enable row level security;
alter table action_logs enable row level security;

create policy "authenticated read settings" on app_settings for select to authenticated using (true);
create policy "authenticated read videos" on videos for select to authenticated using (true);
create policy "authenticated read accounts" on account_groups for select to authenticated using (true);
create policy "authenticated read captions" on caption_templates for select to authenticated using (true);
create policy "authenticated read publications" on publications for select to authenticated using (true);
create policy "authenticated read publication platforms" on publication_platforms for select to authenticated using (true);
create policy "authenticated read logs" on action_logs for select to authenticated using (true);
