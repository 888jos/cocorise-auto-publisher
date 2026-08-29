import { addDays, parseISO } from "date-fns";
import { schedulerSettingsFromRow } from "@/lib/config";
import { logAction } from "@/lib/logger";
import { chooseCaptionTemplate, generateAccountSlots, renderCaption, selectNextVideo } from "@/lib/scheduling";
import { createServiceClient } from "@/lib/supabase/server";
import type { AccountGroup, AppSettingsRow, CaptionTemplate, Publication, Video } from "@/lib/types/domain";

export async function runQueueScheduler(now = new Date()) {
  const db = createServiceClient();
  const [accountQuery, videoQuery, captionQuery, settingsQuery] = await Promise.all([
    db.from("account_groups").select("*").eq("active", true).returns<AccountGroup[]>(),
    db.from("videos").select("*").eq("status", "available").returns<Video[]>(),
    db.from("caption_templates").select("*").eq("active", true).returns<CaptionTemplate[]>(),
    db.from("app_settings").select("*").eq("id", true).maybeSingle<AppSettingsRow>()
  ]);
  if (accountQuery.error) throw accountQuery.error;
  if (videoQuery.error) throw videoQuery.error;
  if (captionQuery.error) throw captionQuery.error;
  if (settingsQuery.error) throw settingsQuery.error;

  const rowSettings = settingsQuery.data;
  const schedulerSettings = schedulerSettingsFromRow(rowSettings);
  const horizonEnd = addDays(now, schedulerSettings.scheduleHorizonDays);
  const { data: publicationData, error: publicationError } = await db
    .from("publications")
    .select("*")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", horizonEnd.toISOString())
    .returns<Publication[]>();
  if (publicationError) throw publicationError;

  let created = 0;
  const accounts = accountQuery.data ?? [];
  const videos = videoQuery.data ?? [];
  const captions = captionQuery.data ?? [];
  const publications = publicationData ?? [];
  const mutablePublications = [...publications];

  for (const account of accounts) {
    const existingSlots = new Set(
      mutablePublications
        .filter((publication) => publication.account_group_id === account.id && publication.status !== "cancelled")
        .map((publication) => publication.scheduled_at)
    );
    const slots = generateAccountSlots(account, now, schedulerSettings.scheduleHorizonDays, schedulerSettings);

    for (const slot of slots) {
      if (slot < now || existingSlots.has(slot.toISOString())) continue;
      const video = selectNextVideo(account, slot, videos, mutablePublications, schedulerSettings);
      const template = chooseCaptionTemplate(account, captions, mutablePublications);
      if (!video || !template) continue;

      const variables = {
        hook: rowSettings?.caption_hook?.trim() ?? "",
        body: video.caption_source?.trim() || rowSettings?.caption_body?.trim() || "",
        cta: rowSettings?.caption_cta?.trim() ?? "",
        hashtags: rowSettings?.caption_hashtags?.trim() ?? "",
        filename: video.filename.replace(/\.(mp4|mov|webm)$/i, "")
      };
      const caption = renderCaption(template, {
        ...variables
      });
      if (!caption) continue;

      const { data, error } = await db
        .from("publications")
        .insert({
          video_id: video.id,
          account_group_id: account.id,
          scheduled_at: slot.toISOString(),
          caption,
          caption_template_id: template.id,
          status: "scheduled",
          idempotency_key: `publication:${account.id}:${video.id}:${slot.toISOString()}`
        })
        .select("*")
        .single<Publication>();

      if (error) {
        await logAction(db, { action: "schedule_create", status: "skipped", error: error.message, videoId: video.id, accountGroupId: account.id });
        continue;
      }

      mutablePublications.push(data);
      existingSlots.add(data.scheduled_at);
      created += 1;
      await db.from("videos").update({ status: "scheduled" }).eq("id", video.id).eq("status", "available");
      await logAction(db, { action: "schedule_create", status: "scheduled", videoId: video.id, accountGroupId: account.id, publicationId: data.id });
    }
  }

  return { created, horizonEnd: horizonEnd.toISOString(), newestInput: publications.at(-1)?.scheduled_at ? parseISO(publications.at(-1)!.scheduled_at).toISOString() : null };
}
