export type VideoStatus =
  | "available"
  | "scheduled"
  | "partially_published"
  | "published"
  | "failed"
  | "disabled";

export type PublicationStatus =
  | "queued"
  | "scheduled"
  | "sending"
  | "processing"
  | "published"
  | "failed"
  | "cancelled";

export type SocialPlatform = "tiktok" | "instagram" | "youtube";
export type Platform = "all" | SocialPlatform;
export type PublishingProvider = "upload_post" | "direct";
export type ConnectionStatus = "connected" | "expired" | "revoked" | "error";
export type PlatformPublicationStatus = "pending" | "uploading" | "processing" | "published" | "failed" | "skipped";

export type Video = {
  id: string;
  drive_file_id: string;
  filename: string;
  file_hash: string;
  status: VideoStatus;
  imported_at: string;
  duration: number | null;
  caption_source: string | null;
  times_used: number;
  last_used_at: string | null;
};

export type AccountGroup = {
  id: string;
  name: string;
  upload_post_profile: string | null;
  active: boolean;
  posts_per_day: number;
  timezone: string;
  tiktok_enabled: boolean;
  instagram_enabled: boolean;
  youtube_enabled: boolean;
  consecutive_failures: number;
  paused_reason?: string | null;
};

export type Publication = {
  id: string;
  video_id: string;
  account_group_id: string;
  scheduled_at: string;
  caption: string;
  caption_template_id: string | null;
  status: PublicationStatus;
  platform_results?: Record<string, unknown>;
  provider_job_id: string | null;
  provider_request_id: string | null;
  provider_status: string | null;
  usage_recorded: boolean;
  retry_count: number;
  next_retry_at: string | null;
  published_at: string | null;
  failed_at: string | null;
  error_message: string | null;
};

export type SocialConnection = {
  id: string;
  account_group_id: string;
  platform: SocialPlatform;
  status: ConnectionStatus;
  external_account_id: string;
  external_username: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  last_error: string | null;
  connected_at: string;
  updated_at: string;
};

export type PublicationPlatform = {
  id: string;
  publication_id: string;
  platform: SocialPlatform;
  status: PlatformPublicationStatus;
  external_post_id: string | null;
  upload_session_id: string | null;
  post_url: string | null;
  raw_status: Record<string, unknown>;
  attempt_count: number;
  published_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type CaptionTemplate = {
  id: string;
  name: string;
  template: string;
  active: boolean;
  weight: number;
  platform: Platform;
};

export type SchedulerSettings = {
  postsPerDay: number;
  reuseCooldownHours: number;
  scheduleHorizonDays: number;
  minStaggerMinutes: number;
  maxStaggerMinutes: number;
  minMinutesBetweenPosts: number;
  timezone: string;
  windows: Array<{ name: "Morning" | "Afternoon" | "Evening"; start: string; end: string }>;
};

export type AppSettingsRow = {
  id: boolean;
  posts_per_day: number;
  reuse_cooldown_hours: number;
  schedule_horizon_days: number;
  morning_start: string;
  morning_end: string;
  afternoon_start: string;
  afternoon_end: string;
  evening_start: string;
  evening_end: string;
  min_stagger_minutes: number;
  max_stagger_minutes: number;
  min_minutes_between_posts: number;
  timezone: string;
  pause_all_publishing: boolean;
  failure_pause_threshold: number;
  caption_hook: string;
  caption_body: string;
  caption_cta: string;
  caption_hashtags: string;
};
