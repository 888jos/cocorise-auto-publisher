alter table account_groups
  add column if not exists upload_post_profile text;

alter table publications
  add column if not exists provider_job_id text,
  add column if not exists provider_request_id text,
  add column if not exists provider_status text;

create index if not exists publications_provider_request_idx
  on publications(provider_request_id)
  where provider_request_id is not null;
