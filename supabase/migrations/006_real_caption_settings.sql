alter table app_settings
  add column if not exists caption_hook text not null default '',
  add column if not exists caption_body text not null default '',
  add column if not exists caption_cta text not null default '',
  add column if not exists caption_hashtags text not null default '';

alter table publications
  add column if not exists caption_template_id uuid references caption_templates(id) on delete set null;
