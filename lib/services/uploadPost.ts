import type { SocialPlatform } from "@/lib/types/domain";

const UPLOAD_POST_API_BASE = "https://api.upload-post.com/api";

export type UploadPostProfile = {
  username: string;
  created_at?: string;
  social_accounts?: Partial<Record<SocialPlatform, unknown>>;
};

export type UploadPostResult = {
  platform: string;
  status?: string;
  success?: boolean;
  skipped?: boolean;
  skip_reason?: string;
  fallback_to_inbox?: boolean;
  error?: string;
  message?: string;
  post_url?: string | null;
  platform_post_id?: string | null;
  post_id?: string | null;
  id?: string | null;
  [key: string]: unknown;
};

export type UploadPostStatus = {
  request_id?: string;
  job_id?: string;
  external_id?: string | null;
  status: string;
  message?: string;
  results?: UploadPostResult[];
  [key: string]: unknown;
};

export class UploadPostApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
    this.name = "UploadPostApiError";
  }
}

function apiKey() {
  const key = process.env.UPLOAD_POST_API_KEY;
  if (!key) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  return key;
}

function messageFrom(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as Record<string, unknown>;
  return String(value.message || value.error || value.detail || fallback);
}

async function uploadPostRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${UPLOAD_POST_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Apikey ${apiKey()}`,
      ...init.headers
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(120_000)
  });
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    throw new UploadPostApiError(messageFrom(payload, `Upload-Post returned HTTP ${response.status}.`), response.status, payload);
  }
  return payload as T;
}

export async function listUploadPostProfiles() {
  return uploadPostRequest<{ success: boolean; limit?: number; plan?: string; profiles: UploadPostProfile[] }>("/uploadposts/users");
}

export async function getUploadPostProfile(username: string) {
  if (!username.trim()) throw new Error("Upload-Post profile username is required.");
  return uploadPostRequest<{ success: boolean; profile: UploadPostProfile }>(`/uploadposts/users/${encodeURIComponent(username.trim())}`);
}

export async function ensureUploadPostProfile(username: string) {
  const normalized = username.trim();
  if (!normalized) throw new Error("Upload-Post profile username is required.");
  try {
    return (await getUploadPostProfile(normalized)).profile;
  } catch (error) {
    if (!(error instanceof UploadPostApiError) || error.status !== 404) throw error;
  }
  const created = await uploadPostRequest<{ success: boolean; profile?: UploadPostProfile }>("/uploadposts/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: normalized })
  });
  return created.profile ?? { username: normalized };
}

export async function createUploadPostConnectUrl(username: string, redirectUrl: string, platform?: SocialPlatform) {
  await ensureUploadPostProfile(username);
  const response = await uploadPostRequest<{ success: boolean; access_url: string }>("/uploadposts/users/generate-jwt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: username.trim(),
      redirect_url: redirectUrl,
      show_calendar: false,
      language: "fr",
      ...(platform ? {
        platforms: [platform],
        connect_title: `Connecter ${platform === "youtube" ? "YouTube" : platform === "tiktok" ? "TikTok" : "Instagram"} à ${username.trim()}`,
        connect_description: `Vérifie le compte ${platform} affiché avant de l'autoriser.`
      } : {})
    })
  });
  if (!response.access_url) throw new Error("Upload-Post did not return an account connection URL.");
  return response.access_url;
}

export function uploadPostRequestId(publicationId: string) {
  return `cocorise-${publicationId}`;
}

export function uploadPostIdempotencyKey(publicationId: string) {
  return `cocorise-publication-${publicationId}`;
}

function youtubeTitle(caption: string, filename: string) {
  const firstLine = caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const fallback = filename.replace(/\.mp4$/i, "").replace(/[_-]+/g, " ").trim() || "Cocorise Short";
  return (firstLine || fallback).slice(0, 100);
}

export function buildUploadPostForm(input: {
  profile: string;
  platforms: SocialPlatform[];
  caption: string;
  publicationId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  scheduledAt?: string;
  timezone?: string;
}) {
  if (!input.profile.trim()) throw new Error("Upload-Post profile username is required.");
  if (!input.platforms.length) throw new Error("At least one Upload-Post platform must be enabled.");

  const form = new FormData();
  const title = youtubeTitle(input.caption, input.filename);
  form.set("user", input.profile.trim());
  for (const platform of input.platforms) form.append("platform[]", platform);
  form.set("video", new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename);
  form.set("title", title);
  form.set("description", input.caption);
  form.set("tiktok_title", input.caption.slice(0, 2_200));
  form.set("instagram_title", input.caption);
  form.set("youtube_title", title);
  form.set("youtube_description", input.caption);
  form.set("post_mode", "DIRECT_POST");
  form.set("disable_inbox_fallback", "true");
  form.set("media_type", "REELS");
  form.set("privacyStatus", "public");
  form.set("external_id", input.publicationId);
  form.set("request_id", uploadPostRequestId(input.publicationId));
  if (process.env.TIKTOK_CONTENT_IS_AIGC === "true") form.set("is_ai_generated", "true");
  if (input.scheduledAt) {
    form.set("scheduled_date", input.scheduledAt);
    form.set("timezone", input.timezone || "UTC");
  } else {
    form.set("async_upload", "true");
  }
  return form;
}

export async function publishVideo(input: Parameters<typeof buildUploadPostForm>[0]) {
  const form = buildUploadPostForm(input);
  const response = await uploadPostRequest<{
    success?: boolean;
    request_id?: string;
    job_id?: string;
    status?: string;
    scheduled_date?: string;
    message?: string;
  }>("/upload", {
    method: "POST",
    headers: { "Idempotency-Key": uploadPostIdempotencyKey(input.publicationId) },
    body: form
  });
  if (!response.request_id && !response.job_id) {
    throw new Error(`Upload-Post accepted no trackable job: ${response.message || "missing request_id/job_id"}`);
  }
  return response;
}

export async function scheduleVideo(input: Parameters<typeof buildUploadPostForm>[0] & { scheduledAt: string }) {
  return publishVideo(input);
}

export async function getPostStatus(input: { requestId?: string | null; jobId?: string | null }) {
  const params = new URLSearchParams();
  if (input.requestId) params.set("request_id", input.requestId);
  else if (input.jobId) params.set("job_id", input.jobId);
  else throw new Error("Upload-Post request_id or job_id is required.");
  return uploadPostRequest<UploadPostStatus>(`/uploadposts/status?${params.toString()}`);
}

export async function retryPost(input: { requestId?: string | null; jobId?: string | null }) {
  const body = input.requestId ? { request_id: input.requestId } : input.jobId ? { job_id: input.jobId } : null;
  if (!body) throw new Error("Upload-Post request_id or job_id is required for retry.");
  return uploadPostRequest<{ success: boolean; request_id?: string; job_id?: string; message?: string }>("/uploadposts/posts/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function cancelScheduledPost(jobId: string) {
  if (!jobId) throw new Error("Upload-Post job_id is required for cancellation.");
  return uploadPostRequest<{ success: boolean; message?: string }>(`/uploadposts/schedule/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}

export async function reschedulePost(jobId: string, scheduledAt: string, timezone: string) {
  if (!jobId) throw new Error("Upload-Post job_id is required for rescheduling.");
  return uploadPostRequest<{ success: boolean; job_id: string; scheduled_date: string }>(`/uploadposts/schedule/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduled_date: scheduledAt, timezone })
  });
}
