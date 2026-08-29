do $$ begin
  create type social_platform as enum ('tiktok', 'instagram', 'youtube');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type social_connection_status as enum ('connected', 'expired', 'revoked', 'error');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type platform_publication_status as enum ('pending', 'uploading', 'processing', 'published', 'failed', 'skipped');
exception when duplicate_object then null;
end $$;

alter table account_groups drop column if exists upload_post_profile;

alter table publications
  drop column if exists upload_post_job_id,
  drop column if exists upload_post_request_id,
  drop column if exists upload_post_status,
  add column if not exists usage_recorded boolean not null default false;

create table if not exists social_connections (
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

create table if not exists publication_platforms (
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

create index if not exists publication_platforms_status_idx on publication_platforms(status, updated_at);
create index if not exists social_connections_account_idx on social_connections(account_group_id, platform, status);

alter table social_connections enable row level security;
alter table publication_platforms enable row level security;

do $$ begin
  create policy "authenticated read publication platforms" on publication_platforms for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

-- social_connections deliberately has no client-readable policy because it stores encrypted OAuth credentials.
