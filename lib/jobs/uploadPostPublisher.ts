import { logAction } from "@/lib/logger";
import { nextRetryAt, shouldPauseAccount } from "@/lib/scheduling";
import { downloadDriveFile } from "@/lib/services/googleDrive";
import { notifyPublication, retryPendingTelegramNotifications } from "@/lib/services/telegram";
import { aggregatePlatformRows, enabledPlatforms } from "@/lib/services/social/publisher";
import {
  getPostStatus,
  getUploadPostProfile,
  publishVideo,
  retryPost,
  UploadPostApiError,
  uploadPostSocialAccount,
  uploadPostRequestId,
  type UploadPostResult
} from "@/lib/services/uploadPost";
import { createServiceClient } from "@/lib/supabase/server";
import type { AccountGroup, PlatformPublicationStatus, Publication, PublicationPlatform, Video } from "@/lib/types/domain";

type Db = ReturnType<typeof createServiceClient>;
type PublicationWithRelations = Publication & { videos: Video; account_groups: AccountGroup };

function rowsSnapshot(rows: PublicationPlatform[]) {
  return Object.fromEntries(
    rows.map((row) => [
      row.platform,
      {
        status: row.status,
        external_post_id: row.external_post_id,
        post_url: row.post_url,
        error: row.error_message,
        attempt_count: row.attempt_count,
        raw_status: row.raw_status
      }
    ])
  );
}

async function loadPlatformRows(db: Db, publicationId: string) {
  const { data, error } = await db
    .from("publication_platforms")
    .select("*")
    .eq("publication_id", publicationId)
    .order("platform")
    .returns<PublicationPlatform[]>();
  if (error) throw error;
  return data ?? [];
}

async function preparePlatformRows(db: Db, publication: PublicationWithRelations) {
  const platforms = enabledPlatforms(publication.account_groups);
  if (!platforms.length) throw new Error(`${publication.account_groups.name} has no enabled platform.`);
  if (!publication.account_groups.upload_post_profile) throw new Error(`${publication.account_groups.name} has no Upload-Post profile username.`);
  const profile = (await getUploadPostProfile(publication.account_groups.upload_post_profile)).profile;
  const missing = platforms.filter((platform) => !uploadPostSocialAccount(profile, platform));
  if (missing.length) {
    throw new Error(`${publication.account_groups.name} is not connected to ${missing.join(", ")} in Upload-Post.`);
  }
  const { error } = await db.from("publication_platforms").upsert(
    platforms.map((platform) => ({ publication_id: publication.id, platform, status: "pending" })),
    { onConflict: "publication_id,platform", ignoreDuplicates: true }
  );
  if (error) throw error;
  return loadPlatformRows(db, publication.id);
}

function providerError(result: UploadPostResult, fallback: string) {
  return String(result.error || result.message || result.skip_reason || fallback);
}

export function mapUploadPostResult(result: UploadPostResult, providerStatus: string) {
  const rawStatus = String(result.status || "").toLowerCase();
  const normalizedProviderStatus = providerStatus.toLowerCase();
  const fallbackToInbox = result.fallback_to_inbox === true;
  const skipped = result.skipped === true || rawStatus === "skipped";
  const providerIsTerminal = ["completed", "failed", "not_found"].includes(normalizedProviderStatus);
  const providerFailed = ["failed", "not_found"].includes(normalizedProviderStatus);
  let status: PlatformPublicationStatus = "processing";
  let errorMessage: string | null = null;

  if (fallbackToInbox) {
    status = "failed";
    errorMessage = "TikTok received an inbox draft instead of a live post.";
  } else if (skipped) {
    status = "failed";
    errorMessage = providerError(result, "Platform is not connected to this Upload-Post profile.");
  } else if (rawStatus === "completed" || (normalizedProviderStatus === "completed" && result.success === true)) {
    status = "published";
  } else if (rawStatus === "retryable") {
    status = providerFailed ? "failed" : "processing";
    errorMessage = status === "failed" ? providerError(result, "Upload-Post retryable failure was not recovered.") : null;
  } else if (rawStatus === "failed" || providerFailed || (providerIsTerminal && result.success === false)) {
    status = "failed";
    errorMessage = providerError(result, "Upload-Post reported a publishing failure.");
  }

  return {
    status,
    externalPostId: String(
      result.platform_post_id || result.post_id || result.publish_id || result.container_id || result.video_id || result.video_reel_id || result.id || ""
    ) || null,
    postUrl: typeof result.post_url === "string" ? result.post_url : typeof result.url === "string" ? result.url : null,
    errorMessage,
    rawStatus: result
  };
}

async function reconcilePublication(db: Db, publicationId: string, now: Date) {
  const [{ data: publication, error: publicationError }, rows] = await Promise.all([
    db.from("publications").select("*").eq("id", publicationId).single<Publication>(),
    loadPlatformRows(db, publicationId)
  ]);
  if (publicationError) throw publicationError;

  const aggregate = aggregatePlatformRows(rows);
  const hasPublishedPlatform = rows.some((row) => row.status === "published");
  let usageRecorded = publication.usage_recorded;
  if (hasPublishedPlatform && !usageRecorded) {
    await db.rpc("increment_video_usage", { target_video_id: publication.video_id }).throwOnError();
    usageRecorded = true;
  }

  if (aggregate.status === "published") {
    await db
      .from("publications")
      .update({
        status: "published",
        provider_status: "completed",
        published_at: publication.published_at || now.toISOString(),
        failed_at: null,
        next_retry_at: null,
        error_message: null,
        usage_recorded: usageRecorded,
        platform_results: rowsSnapshot(rows)
      })
      .eq("id", publicationId);
    await db.from("account_groups").update({ consecutive_failures: 0, paused_reason: null }).eq("id", publication.account_group_id);
    await logAction(db, { action: "upload_post_success", status: "published", publicationId });
    await notifyPublication(db, publicationId, "publication_published");
    return aggregate;
  }

  if (aggregate.status === "processing") {
    await db
      .from("publications")
      .update({ status: "processing", error_message: null, usage_recorded: usageRecorded, platform_results: rowsSnapshot(rows) })
      .eq("id", publicationId);
    return aggregate;
  }

  const canRetry = publication.retry_count < 3 && rows.some((row) => row.status === "failed");
  const retryAt = canRetry ? nextRetryAt(now, publication.retry_count) : null;
  await db
    .from("publications")
    .update({
      status: "failed",
      next_retry_at: retryAt?.toISOString() ?? null,
      failed_at: now.toISOString(),
      error_message: aggregate.error,
      usage_recorded: usageRecorded,
      platform_results: rowsSnapshot(rows)
    })
    .eq("id", publicationId);

  if (hasPublishedPlatform) {
    await db.from("videos").update({ status: "partially_published" }).eq("id", publication.video_id);
  }

  if (!canRetry && publication.status !== "failed") {
    const { data: account } = await db.from("account_groups").select("active,consecutive_failures").eq("id", publication.account_group_id).single();
    const failures = Number(account?.consecutive_failures ?? 0) + 1;
    const { data: settings } = await db.from("app_settings").select("failure_pause_threshold").eq("id", true).maybeSingle();
    const pause = shouldPauseAccount(failures, settings?.failure_pause_threshold ?? 3);
    await db
      .from("account_groups")
      .update({
        consecutive_failures: failures,
        active: pause ? false : Boolean(account?.active),
        paused_reason: pause ? "Automatic pause after consecutive Upload-Post failures." : null
      })
      .eq("id", publication.account_group_id);
  }
  await logAction(db, { action: "upload_post_failure", status: "failed", error: aggregate.error || undefined, publicationId });
  if (!canRetry) await notifyPublication(db, publicationId, "publication_failed");
  return aggregate;
}

async function markPreparationFailure(db: Db, item: PublicationWithRelations, now: Date, error: unknown) {
  const message = error instanceof Error ? error.message : "Upload-Post preparation failed.";
  const retryAt = nextRetryAt(now, item.retry_count);
  await db
    .from("publications")
    .update({ status: "failed", failed_at: now.toISOString(), next_retry_at: retryAt?.toISOString() ?? null, error_message: message })
    .eq("id", item.id);
  await logAction(db, { action: "upload_post_prepare", status: "failed", error: message, publicationId: item.id });
  if (!retryAt) await notifyPublication(db, item.id, "publication_failed");
}

async function submitPublication(db: Db, item: PublicationWithRelations, now: Date) {
  const { data: claimed, error: claimError } = await db
    .from("publications")
    .update({ status: "sending", provider_request_id: uploadPostRequestId(item.id), provider_status: "submitting" })
    .eq("id", item.id)
    .eq("status", item.status)
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return false;

  const { data: duplicate } = await db
    .from("publications")
    .select("id")
    .eq("video_id", item.video_id)
    .eq("account_group_id", item.account_group_id)
    .eq("status", "published")
    .neq("id", item.id)
    .maybeSingle();
  if (duplicate) {
    await db.from("publications").update({ status: "cancelled", error_message: "Duplicate prevention: video already published to account." }).eq("id", item.id);
    return false;
  }

  let rows: PublicationPlatform[];
  try {
    if (!process.env.UPLOAD_POST_API_KEY) throw new Error("UPLOAD_POST_API_KEY is not configured.");
    if (!item.account_groups.upload_post_profile) throw new Error(`${item.account_groups.name} has no Upload-Post profile username.`);
    rows = await preparePlatformRows(db, item);
  } catch (error) {
    await markPreparationFailure(db, item, now, error);
    return false;
  }

  const startable = rows.filter((row) => ["pending", "failed"].includes(row.status));
  await db
    .from("publication_platforms")
    .update({ status: "uploading", error_message: null, updated_at: now.toISOString() })
    .eq("publication_id", item.id)
    .in("status", ["pending", "failed"]);
  for (const row of startable) {
    await db.from("publication_platforms").update({ attempt_count: row.attempt_count + 1 }).eq("id", row.id);
  }

  try {
    const binary = await downloadDriveFile(item.videos.drive_file_id);
    const request = {
      profile: item.account_groups.upload_post_profile!,
      platforms: enabledPlatforms(item.account_groups),
      caption: item.caption,
      publicationId: item.id,
      filename: binary.filename,
      mimeType: binary.mimeType,
      buffer: binary.buffer,
      timezone: item.account_groups.timezone
    };
    const response = await publishVideo(request);
    const providerStatus = String(response.status || (response.job_id ? "pending" : "queued"));
    await db
      .from("publication_platforms")
      .update({ status: "processing", raw_status: response, updated_at: new Date().toISOString() })
      .eq("publication_id", item.id);
    await db
      .from("publications")
      .update({
        status: "processing",
        provider_job_id: response.job_id ?? null,
        provider_request_id: response.request_id ?? uploadPostRequestId(item.id),
        provider_status: providerStatus,
        error_message: null,
        platform_results: { upload_post_submission: response }
      })
      .eq("id", item.id);
    await logAction(db, {
      action: "upload_post_submitted",
      status: providerStatus,
      videoId: item.video_id,
      accountGroupId: item.account_group_id,
      publicationId: item.id
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload-Post submission failed.";
    await db
      .from("publication_platforms")
      .update({ status: "failed", error_message: message, raw_status: { error: message }, updated_at: new Date().toISOString() })
      .eq("publication_id", item.id);
    await db.from("publications").update({ provider_status: "submission_failed" }).eq("id", item.id);
    await reconcilePublication(db, item.id, now);
    return false;
  }
}

async function applyProviderStatus(db: Db, publication: Publication, providerStatus: Awaited<ReturnType<typeof getPostStatus>>, now: Date) {
  const rows = await loadPlatformRows(db, publication.id);
  const results = providerStatus.results ?? [];
  const resultByPlatform = new Map(results.map((result) => [result.platform.toLowerCase(), result]));
  const terminal = ["completed", "failed", "not_found"].includes(providerStatus.status);

  for (const row of rows) {
    const result = resultByPlatform.get(row.platform);
    if (result) {
      const mapped = mapUploadPostResult(result, providerStatus.status);
      await db
        .from("publication_platforms")
        .update({
          status: mapped.status,
          external_post_id: mapped.externalPostId || row.external_post_id,
          post_url: mapped.postUrl || row.post_url,
          raw_status: mapped.rawStatus,
          error_message: mapped.errorMessage,
          published_at: mapped.status === "published" ? now.toISOString() : row.published_at,
          updated_at: now.toISOString()
        })
        .eq("id", row.id);
    } else if (terminal) {
      const message = providerStatus.status === "completed"
        ? `Upload-Post completed without a ${row.platform} result.`
        : providerStatus.message || `Upload-Post status: ${providerStatus.status}.`;
      await db
        .from("publication_platforms")
        .update({ status: "failed", error_message: message, raw_status: providerStatus, updated_at: now.toISOString() })
        .eq("id", row.id);
    }
  }

  await db
    .from("publications")
    .update({ provider_status: providerStatus.status, platform_results: providerStatus })
    .eq("id", publication.id);
  await reconcilePublication(db, publication.id, now);
}

async function pollProcessingPublications(db: Db, now: Date) {
  const pollUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
  const { data, error } = await db
    .from("publications")
    .select("*")
    .eq("status", "processing")
    .lte("scheduled_at", pollUntil)
    .or("provider_request_id.not.is.null,provider_job_id.not.is.null")
    .order("scheduled_at")
    .limit(50)
    .returns<Publication[]>();
  if (error) throw error;

  let checked = 0;
  for (const publication of data ?? []) {
    try {
      const status = await getPostStatus({ requestId: publication.provider_job_id ? null : publication.provider_request_id, jobId: publication.provider_job_id });
      await applyProviderStatus(db, publication, status, now);
      checked += 1;
    } catch (error) {
      if (error instanceof UploadPostApiError && error.status === 404) {
        await applyProviderStatus(
          db,
          publication,
          { status: "not_found", message: error.message, request_id: publication.provider_request_id ?? undefined, job_id: publication.provider_job_id ?? undefined },
          now
        );
      } else {
        await logAction(db, {
          action: "upload_post_status_check",
          status: "error",
          error: error instanceof Error ? error.message : "Unknown Upload-Post status error.",
          publicationId: publication.id
        });
      }
    }
  }
  return checked;
}

export async function retryUploadPostPublication(publicationId: string) {
  const db = createServiceClient();
  const { data: publication, error } = await db.from("publications").select("*").eq("id", publicationId).single<Publication>();
  if (error) throw error;
  if (publication.status !== "failed") throw new Error("Only a failed publication can be retried.");
  if (publication.retry_count >= 3) throw new Error("This publication has already reached the maximum of 3 retries.");

  if (!publication.provider_request_id && !publication.provider_job_id) {
    await db
      .from("publications")
      .update({ status: "scheduled", retry_count: publication.retry_count + 1, next_retry_at: null, error_message: null, provider_status: null })
      .eq("id", publicationId);
    return;
  }

  try {
    await retryPost({ requestId: publication.provider_job_id ? null : publication.provider_request_id, jobId: publication.provider_job_id });
  } catch (retryError) {
    if (retryError instanceof UploadPostApiError && retryError.status === 404) {
      await db
        .from("publications")
        .update({
          status: "scheduled",
          provider_job_id: null,
          provider_request_id: null,
          provider_status: "not_found",
          retry_count: publication.retry_count + 1,
          next_retry_at: null,
          error_message: "Upload-Post no longer has the original upload; it will be submitted again with the same idempotency key."
        })
        .eq("id", publicationId);
      return;
    }
    if (!(retryError instanceof UploadPostApiError) || retryError.status !== 409) throw retryError;
  }

  const rows = await loadPlatformRows(db, publicationId);
  for (const row of rows.filter((candidate) => candidate.status === "failed")) {
    await db
      .from("publication_platforms")
      .update({ status: "processing", attempt_count: row.attempt_count + 1, error_message: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }
  await db
    .from("publications")
    .update({ status: "processing", retry_count: publication.retry_count + 1, next_retry_at: null, error_message: null, provider_status: "retrying" })
    .eq("id", publicationId);
}

export async function runUploadPostPublisher(now = new Date()) {
  const db = createServiceClient();
  const notificationsRetried = await retryPendingTelegramNotifications(db);
  const { data: settings } = await db.from("app_settings").select("pause_all_publishing").eq("id", true).maybeSingle();
  if (settings?.pause_all_publishing) return { sent: 0, checked: 0, notificationsRetried, paused: true, provider: "upload_post" as const };

  const [scheduledQuery, failedQuery] = await Promise.all([
    db
      .from("publications")
      .select("*, videos(*), account_groups!inner(*)")
      .eq("status", "scheduled")
      .eq("account_groups.active", true)
      .lte("scheduled_at", now.toISOString())
      .order("scheduled_at")
      .limit(20),
    db
      .from("publications")
      .select("*")
      .eq("status", "failed")
      .lte("next_retry_at", now.toISOString())
      .order("next_retry_at")
      .limit(20)
      .returns<Publication[]>()
  ]);
  if (scheduledQuery.error) throw scheduledQuery.error;
  if (failedQuery.error) throw failedQuery.error;

  let sent = 0;
  for (const publication of failedQuery.data ?? []) {
    if (publication.retry_count >= 3) continue;
    await retryUploadPostPublication(publication.id);
    sent += 1;
  }
  for (const item of (scheduledQuery.data ?? []) as PublicationWithRelations[]) {
    if (await submitPublication(db, item, now)) sent += 1;
  }

  const checked = await pollProcessingPublications(db, now);
  return { sent, checked, notificationsRetried, paused: false, provider: "upload_post" as const };
}
