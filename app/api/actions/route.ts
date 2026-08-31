import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { runDriveSync } from "@/lib/jobs/driveSync";
import { publishingProvider, retryPublication, runPublisher } from "@/lib/jobs/publisher";
import { runQueueScheduler } from "@/lib/jobs/scheduler";
import { logAction } from "@/lib/logger";
import { listReadyVideos } from "@/lib/services/googleDrive";
import { deleteSocialConnection, getValidSocialConnection } from "@/lib/services/social/connections";
import {
  cancelScheduledPost,
  createUploadPostConnectUrl,
  getUploadPostProfile,
  listUploadPostProfiles,
  reschedulePost
} from "@/lib/services/uploadPost";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { SocialPlatform } from "@/lib/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(request: Request) {
  return NextResponse.redirect(request.headers.get("referer") ?? new URL("/", request.url));
}

function numberField(form: FormData, key: string) {
  const value = Number(form.get(key));
  return Number.isFinite(value) ? value : undefined;
}

function platformField(form: FormData): SocialPlatform {
  const platform = String(form.get("platform") ?? "");
  if (!["tiktok", "instagram", "youtube"].includes(platform)) throw new Error("Invalid social platform.");
  return platform as SocialPlatform;
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await request.formData();
    const action = String(form.get("action") ?? "");
    const db = createServiceClient();

    if (action === "sync-drive") {
      await runDriveSync();
      return back(request);
    }
    if (action === "generate-schedule") {
      await runQueueScheduler();
      return back(request);
    }
    if (action === "publish-now") {
      await runPublisher();
      return back(request);
    }
    if (action === "test-google-drive") {
      const files = await listReadyVideos();
      await logAction(db, { action: "integration_test_google_drive", status: "ok", error: `${files.length} video file(s) visible in READY.` });
      return back(request);
    }
    if (action === "test-upload-post") {
      const result = await listUploadPostProfiles();
      await logAction(db, {
        action: "integration_test_upload_post",
        status: "ok",
        error: `${result.profiles?.length ?? 0}/${result.limit ?? "?"} profile(s), plan ${result.plan ?? "unknown"}.`
      });
      return back(request);
    }
    if (action === "pause-all") {
      await db.from("app_settings").update({ pause_all_publishing: true }).eq("id", true);
      return back(request);
    }
    if (action === "resume-all") {
      await db.from("app_settings").update({ pause_all_publishing: false }).eq("id", true);
      return back(request);
    }
    if (action === "video-status") {
      const id = String(form.get("id"));
      const status = String(form.get("status"));
      if (!["available", "disabled"].includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      await db.from("videos").update({ status }).eq("id", id);
      return back(request);
    }
    if (action === "account-active") {
      const id = String(form.get("id"));
      const active = String(form.get("active")) === "true";
      await db.from("account_groups").update({ active, paused_reason: active ? null : "Paused manually." }).eq("id", id);
      return back(request);
    }
    if (action === "account-create") {
      await db.from("account_groups").insert({
        name: String(form.get("name") ?? ""),
        upload_post_profile: String(form.get("upload_post_profile") ?? "").trim() || null,
        posts_per_day: numberField(form, "posts_per_day") ?? 3,
        timezone: String(form.get("timezone") ?? "Europe/Paris"),
        tiktok_enabled: form.get("tiktok_enabled") === "on",
        instagram_enabled: form.get("instagram_enabled") === "on",
        youtube_enabled: form.get("youtube_enabled") === "on",
        active: true
      }).throwOnError();
      return back(request);
    }
    if (action === "account-upload-post-profile") {
      const accountGroupId = String(form.get("account_group_id") ?? "");
      const profile = String(form.get("upload_post_profile") ?? "").trim();
      await db.from("account_groups").update({ upload_post_profile: profile || null }).eq("id", accountGroupId).throwOnError();
      return back(request);
    }
    if (action === "upload-post-connect") {
      const accountGroupId = String(form.get("account_group_id") ?? "");
      const platform = platformField(form);
      const { data: account, error } = await db
        .from("account_groups")
        .select("upload_post_profile")
        .eq("id", accountGroupId)
        .single<{ upload_post_profile: string | null }>();
      if (error) throw error;
      if (!account.upload_post_profile) throw new Error("Configure an Upload-Post profile username first.");
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
      const redirectUrl = `${appUrl}/accounts?upload_post_connected=${encodeURIComponent(account.upload_post_profile)}&platform=${platform}`;
      const accessUrl = await createUploadPostConnectUrl(account.upload_post_profile, redirectUrl, platform);
      return NextResponse.redirect(accessUrl, 303);
    }
    if (action === "upload-post-profile-test") {
      const accountGroupId = String(form.get("account_group_id") ?? "");
      const { data: account, error } = await db
        .from("account_groups")
        .select("upload_post_profile")
        .eq("id", accountGroupId)
        .single<{ upload_post_profile: string | null }>();
      if (error) throw error;
      if (!account.upload_post_profile) throw new Error("Configure an Upload-Post profile username first.");
      const profile = (await getUploadPostProfile(account.upload_post_profile)).profile;
      const connected = Object.entries(profile.social_accounts ?? {}).filter(([, value]) => Boolean(value)).map(([platform]) => platform);
      await logAction(db, {
        action: "integration_test_upload_post_profile",
        status: "ok",
        accountGroupId,
        error: connected.length ? `Connected: ${connected.join(", ")}.` : "Profile exists but no social platform is connected."
      });
      return back(request);
    }
    if (action === "social-disconnect") {
      const accountGroupId = String(form.get("account_group_id") ?? "");
      const platform = platformField(form);
      await deleteSocialConnection(accountGroupId, platform);
      await logAction(db, { action: `oauth_disconnect_${platform}`, status: "disconnected", accountGroupId });
      return back(request);
    }
    if (action === "social-test") {
      const accountGroupId = String(form.get("account_group_id") ?? "");
      const platform = platformField(form);
      const connection = await getValidSocialConnection(accountGroupId, platform);
      await logAction(db, {
        action: `integration_test_${platform}`,
        status: "ok",
        accountGroupId,
        error: connection.connection.external_username || connection.connection.external_account_id
      });
      return back(request);
    }
    if (action === "cancel-publication") {
      const id = String(form.get("id"));
      const { data: publication, error } = await db
        .from("publications")
        .select("status,provider_job_id,provider_request_id")
        .eq("id", id)
        .single<{ status: string; provider_job_id: string | null; provider_request_id: string | null }>();
      if (error) throw error;
      if (publishingProvider() === "upload_post" && publication.provider_job_id) {
        await cancelScheduledPost(publication.provider_job_id);
      } else if (publishingProvider() === "upload_post" && publication.status === "processing" && publication.provider_request_id) {
        throw new Error("An immediate Upload-Post upload is already running and cannot be cancelled safely.");
      }
      await db.from("publications").update({ status: "cancelled", provider_status: "cancelled" }).eq("id", id).in("status", ["queued", "scheduled", "processing", "failed"]);
      return back(request);
    }
    if (action === "retry-publication") {
      await retryPublication(String(form.get("id")));
      return back(request);
    }
    if (action === "reschedule-publication") {
      const scheduledAt = String(form.get("scheduled_at"));
      if (!scheduledAt) return NextResponse.json({ error: "Missing scheduled_at" }, { status: 400 });
      const id = String(form.get("id"));
      const iso = new Date(scheduledAt).toISOString();
      const { data: publication, error } = await db
        .from("publications")
        .select("provider_job_id,account_groups(timezone)")
        .eq("id", id)
        .single<{ provider_job_id: string | null; account_groups: { timezone: string } }>();
      if (error) throw error;
      if (publishingProvider() === "upload_post" && publication.provider_job_id) {
        await reschedulePost(publication.provider_job_id, iso, publication.account_groups.timezone);
        await db.from("publications").update({ scheduled_at: iso, status: "processing", provider_status: "pending" }).eq("id", id);
      } else {
        await db.from("publications").update({ scheduled_at: iso, status: "scheduled", provider_status: null }).eq("id", id);
      }
      return back(request);
    }
    if (action === "caption-create") {
      await db.from("caption_templates").insert({
        name: String(form.get("name") ?? "Untitled"),
        template: String(form.get("template") ?? ""),
        platform: String(form.get("platform") ?? "all"),
        weight: numberField(form, "weight") ?? 1,
        active: true
      });
      return back(request);
    }
    if (action === "caption-update") {
      const id = String(form.get("id") ?? "");
      const name = String(form.get("name") ?? "").trim();
      const template = String(form.get("template") ?? "").trim();
      const platform = String(form.get("platform") ?? "all");
      const weight = numberField(form, "weight") ?? 1;
      if (!id || !name || !template) return NextResponse.json({ error: "Missing caption fields" }, { status: 400 });
      if (!["all", "tiktok", "instagram", "youtube"].includes(platform)) {
        return NextResponse.json({ error: "Invalid caption platform" }, { status: 400 });
      }
      if (weight < 1) return NextResponse.json({ error: "Caption weight must be at least 1" }, { status: 400 });
      await db.from("caption_templates").update({ name, template, platform, weight }).eq("id", id).throwOnError();
      return back(request);
    }
    if (action === "caption-active") {
      await db.from("caption_templates").update({ active: String(form.get("active")) === "true" }).eq("id", String(form.get("id")));
      return back(request);
    }
    if (action === "settings-save") {
      await db.from("app_settings").upsert({
        id: true,
        posts_per_day: numberField(form, "posts_per_day") ?? 3,
        reuse_cooldown_hours: numberField(form, "reuse_cooldown_hours") ?? 96,
        schedule_horizon_days: numberField(form, "schedule_horizon_days") ?? 7,
        morning_start: String(form.get("morning_start") ?? "09:00"),
        morning_end: String(form.get("morning_end") ?? "11:00"),
        afternoon_start: String(form.get("afternoon_start") ?? "14:00"),
        afternoon_end: String(form.get("afternoon_end") ?? "17:00"),
        evening_start: String(form.get("evening_start") ?? "19:00"),
        evening_end: String(form.get("evening_end") ?? "22:00"),
        min_stagger_minutes: numberField(form, "min_stagger_minutes") ?? 7,
        max_stagger_minutes: numberField(form, "max_stagger_minutes") ?? 53,
        min_minutes_between_posts: numberField(form, "min_minutes_between_posts") ?? 150,
        timezone: String(form.get("timezone") ?? "Europe/Paris"),
        failure_pause_threshold: numberField(form, "failure_pause_threshold") ?? 3,
        caption_hook: String(form.get("caption_hook") ?? ""),
        caption_body: String(form.get("caption_body") ?? ""),
        caption_cta: String(form.get("caption_cta") ?? ""),
        caption_hashtags: String(form.get("caption_hashtags") ?? ""),
        updated_at: new Date().toISOString()
      });
      return back(request);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
