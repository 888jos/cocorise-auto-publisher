alter table app_settings
  add column if not exists telegram_notify_published boolean not null default true,
  add column if not exists telegram_notify_failed boolean not null default true,
  add column if not exists telegram_daily_summary boolean not null default true;

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid references publications(id) on delete cascade,
  channel text not null default 'telegram' check (channel = 'telegram'),
  event text not null check (event in ('publication_published', 'publication_failed', 'daily_summary', 'test')),
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_deliveries_retry_idx
  on notification_deliveries(status, next_retry_at, created_at);

alter table notification_deliveries enable row level security;

drop policy if exists "authenticated read notification deliveries" on notification_deliveries;
create policy "authenticated read notification deliveries"
  on notification_deliveries for select to authenticated using (true);
