import { logAction } from "@/lib/logger";
import { retryUploadPostPublication, runUploadPostPublisher } from "@/lib/jobs/uploadPostPublisher";
import { nextRetryAt, shouldPauseAccount } from "@/lib/scheduling";
import { downloadDriveFile } from "@/lib/services/googleDrive";
import { notifyPublication, retryPendingTelegramNotifications } from "@/lib/services/telegram";
import { getValidSocialConnection } from "@/lib/services/social/connections";
import {
  aggregatePlatformRows,
  checkPlatformPublication,
  enabledPlatforms,
  startPlatformPublication
} from "@/lib/services/social/publisher";
import { createServiceClient } from "@/lib/supabase/server";
import type { AccountGroup, Publication, PublicationPlatform, Video } from "@/lib/types/domain";

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
        published_at: publication.published_at || now.toISOString(),
        failed_at: null,
        next_retry_at: null,
        error_message: null,
        usage_recorded: usageRecorded,
        platform_results: rowsSnapshot(rows)
      })
      .eq("id", publicationId);
    await db.from("account_groups").update({ consecutive_failures: 0, paused_reason: null }).eq("id", publication.account_group_id);
    await logAction(db, { action: "publishing_success", status: "published", publicationId });
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

  const retryCount = publication.retry_count + 1;
  const canRetry = rows.some(
    (row) => row.status === "failed" && row.attempt_count < 3 && !(row.platform === "youtube" && row.external_post_id)
  );
  const retryAt = canRetry ? nextRetryAt(now, publication.retry_count) : null;
  await db
    .from("publications")
    .update({
      status: "failed",
      retry_count: retryCount,
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

  if (publication.status !== "failed") {
    const { data: account } = await db.from("account_groups").select("active,consecutive_failures").eq("id", publication.account_group_id).single();
    const failures = Number(account?.consecutive_failures ?? 0) + 1;
    const { data: settings } = await db.from("app_settings").select("failure_pause_threshold").eq("id", true).maybeSingle();
    const pause = shouldPauseAccount(failures, settings?.failure_pause_threshold ?? 3);
    await db
      .from("account_groups")
      .update({
        consecutive_failures: failures,
        active: pause ? false : Boolean(account?.active),
        paused_reason: pause ? "Automatic pause after consecutive direct publishing failures." : null
      })
      .eq("id", publication.account_group_id);
  }
  await logAction(db, { action: "publishing_failure", status: "failed", error: aggregate.error || undefined, publicationId });
  if (!canRetry) await notifyPublication(db, publicationId, "publication_failed");
  return aggregate;
}

async function preparePlatformRows(db: Db, publication: PublicationWithRelations) {
  const platforms = enabledPlatforms(publication.account_groups);
  if (!platforms.length) throw new Error(`${publication.account_groups.name} has no enabled platform.`);
  const { error } = await db.from("publication_platforms").upsert(
    platforms.map((platform) => ({ publication_id: publication.id, platform, status: "pending" })),
    { onConflict: "publication_id,platform", ignoreDuplicates: true }
  );
  if (error) throw error;
  return loadPlatformRows(db, publication.id);
}

async function startDuePublication(db: Db, item: PublicationWithRelations, now: Date) {
  const { data: claimed, error: claimError } = await db
    .from("publications")
    .update({ status: "sending" })
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
    rows = await preparePlatformRows(db, item);
  } catch (error) {
    await db
      .from("publications")
      .update({ status: "failed", failed_at: now.toISOString(), error_message: error instanceof Error ? error.message : "Platform preparation failed." })
      .eq("id", item.id);
    return false;
  }

  const startable = rows.filter(
    (row) => ["pending", "failed"].includes(row.status) && !row.external_post_id && !row.upload_session_id && row.attempt_count < 3
  );
  const binary = startable.length ? await downloadDriveFile(item.videos.drive_file_id) : null;

  for (const row of startable) {
    await db
      .from("publication_platforms")
      .update({ status: "uploading", attempt_count: row.attempt_count + 1, error_message: null, updated_at: now.toISOString() })
      .eq("id", row.id)
      .in("status", ["pending", "failed"]);

    try {
      const auth = await getValidSocialConnection(item.account_group_id, row.platform);
      const result = await startPlatformPublication({
        platform: row.platform,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        externalAccountId: auth.connection.external_account_id,
        video: item.videos,
        binary: binary!,
        publication: item
      });
      await db
        .from("publication_platforms")
        .update({
          status: result.status,
          upload_session_id: result.uploadSessionId,
          external_post_id: result.externalPostId,
          post_url: result.postUrl,
          raw_status: result.rawStatus,
          error_message: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);
      await logAction(db, {
        action: `publishing_request_${row.platform}`,
        status: result.status,
        videoId: item.video_id,
        accountGroupId: item.account_group_id,
        publicationId: item.id
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown platform publishing failure.";
      await db
        .from("publication_platforms")
        .update({ status: "failed", error_message: message, raw_status: { error: message }, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      await logAction(db, { action: `publishing_failure_${row.platform}`, status: "failed", error: message, publicationId: item.id });
    }
  }

  await reconcilePublication(db, item.id, now);
  return true;
}

async function pollProcessingPlatforms(db: Db, now: Date) {
  const { data, error } = await db
    .from("publication_platforms")
    .select("*")
    .in("status", ["uploading", "processing"])
    .order("updated_at")
    .limit(50)
    .returns<PublicationPlatform[]>();
  if (error) throw error;

  const affected = new Set<string>();
  let checked = 0;
  for (const row of data ?? []) {
    affected.add(row.publication_id);
    if (!row.upload_session_id && !row.external_post_id) {
      await db
        .from("publication_platforms")
        .update({
          status: "failed",
          error_message: "Upload was interrupted before an external ID was persisted. Review before retrying to avoid a duplicate.",
          updated_at: now.toISOString()
        })
        .eq("id", row.id);
      continue;
    }

    try {
      const { data: publication, error: publicationError } = await db
        .from("publications")
        .select("account_group_id")
        .eq("id", row.publication_id)
        .single();
      if (publicationError) throw publicationError;
      const auth = await getValidSocialConnection(publication.account_group_id, row.platform);
      const result = await checkPlatformPublication({
        row,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        externalAccountId: auth.connection.external_account_id
      });
      checked += 1;
      await db
        .from("publication_platforms")
        .update({
          status: result.status,
          upload_session_id: result.status === "failed" && row.platform !== "youtube" ? null : row.upload_session_id,
          external_post_id: result.externalPostId || row.external_post_id,
          post_url: result.postUrl || row.post_url,
          raw_status: result.rawStatus,
          error_message: result.errorMessage,
          published_at: result.status === "published" ? now.toISOString() : row.published_at,
          updated_at: now.toISOString()
        })
        .eq("id", row.id);
    } catch (error) {
      await logAction(db, {
        action: `status_check_${row.platform}`,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown status error.",
        publicationId: row.publication_id
      });
    }
  }

  for (const publicationId of affected) {
    await reconcilePublication(db, publicationId, now);
  }
  return checked;
}

export async function runDirectPublisher(now = new Date()) {
  const db = createServiceClient();
  const notificationsRetried = await retryPendingTelegramNotifications(db);
  const { data: settings } = await db.from("app_settings").select("pause_all_publishing").eq("id", true).maybeSingle();
  if (settings?.pause_all_publishing) return { sent: 0, checked: 0, notificationsRetried, paused: true, provider: "direct" as const };

  const [scheduledQuery, failedQuery] = await Promise.all([
    db
      .from("publications")
      .select("*, videos(*), account_groups(*)")
      .eq("status", "scheduled")
      .lte("scheduled_at", now.toISOString())
      .order("scheduled_at")
      .limit(20),
    db
      .from("publications")
      .select("*, videos(*), account_groups(*)")
      .eq("status", "failed")
      .lte("next_retry_at", now.toISOString())
      .order("next_retry_at")
      .limit(20)
  ]);
  if (scheduledQuery.error) throw scheduledQuery.error;
  if (failedQuery.error) throw failedQuery.error;

  const due = [...(scheduledQuery.data ?? []), ...(failedQuery.data ?? [])] as PublicationWithRelations[];
  let sent = 0;
  for (const item of due) {
    if (item.status === "failed" && item.retry_count >= 3) continue;
    if (await startDuePublication(db, item, now)) sent += 1;
  }

  const checked = await pollProcessingPlatforms(db, now);
  return { sent, checked, notificationsRetried, paused: false, provider: "direct" as const };
}

export async function retryDirectPublication(publicationId: string) {
  const db = createServiceClient();
  const rows = await loadPlatformRows(db, publicationId);
  for (const row of rows.filter((candidate) => candidate.status === "failed" && candidate.attempt_count < 3)) {
    const preserveYouTubeUpload = row.platform === "youtube" && Boolean(row.external_post_id);
    await db
      .from("publication_platforms")
      .update({
        status: preserveYouTubeUpload ? "processing" : "pending",
        upload_session_id: preserveYouTubeUpload ? row.upload_session_id : null,
        external_post_id: preserveYouTubeUpload ? row.external_post_id : null,
        post_url: preserveYouTubeUpload ? row.post_url : null,
        error_message: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", row.id);
  }
  const { error } = await db
    .from("publications")
    .update({ status: "failed", next_retry_at: new Date().toISOString(), error_message: null })
    .eq("id", publicationId)
    .eq("status", "failed");
  if (error) throw error;
}

export function publishingProvider() {
  return process.env.PUBLISHING_PROVIDER === "direct" ? "direct" : "upload_post";
}

export async function runPublisher(now = new Date()) {
  return publishingProvider() === "direct" ? runDirectPublisher(now) : runUploadPostPublisher(now);
}

export async function retryPublication(publicationId: string) {
  return publishingProvider() === "direct"
    ? retryDirectPublication(publicationId)
    : retryUploadPostPublication(publicationId);
}
