import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { logAction } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  NotificationDelivery,
  NotificationEvent,
  Publication,
  PublicationPlatform,
  SocialPlatform
} from "@/lib/types/domain";

type Db = ReturnType<typeof createServiceClient>;

type TelegramApiResponse = {
  ok: boolean;
  description?: string;
  result?: { message_id?: number };
};

type PublicationContext = {
  publication: Publication;
  accountName: string;
  timezone: string;
  filename: string;
  platforms: PublicationPlatform[];
};

type TelegramButton = { text: string; url: string };

const platformLabels: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube"
};

function env(name: string) {
  return process.env[name]?.trim() || null;
}

export function getTelegramConfig() {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chatId = env("TELEGRAM_CHAT_ID");
  const webhookSecret = env("TELEGRAM_WEBHOOK_SECRET");
  return { token, chatId, webhookSecret, configured: Boolean(token && chatId) };
}

export function escapeTelegramHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function safePostUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function captionPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
}

export function buildPublicationTelegramMessage(
  context: PublicationContext,
  event: Exclude<NotificationEvent, "daily_summary" | "test">
) {
  const { publication, accountName, timezone, filename, platforms } = context;
  const when = publication.published_at || publication.failed_at || new Date().toISOString();
  const title = event === "publication_published" ? "✅ <b>Vidéo publiée</b>" : "❌ <b>Publication échouée</b>";
  const lines = [
    title,
    "",
    `Compte : <b>${escapeTelegramHtml(accountName)}</b>`,
    `Vidéo : <code>${escapeTelegramHtml(filename)}</code>`,
    `Heure : ${escapeTelegramHtml(formatInTimeZone(when, timezone, "dd/MM/yyyy HH:mm"))}`,
    "",
    "<b>Plateformes</b>"
  ];

  for (const row of platforms) {
    const label = platformLabels[row.platform];
    const url = safePostUrl(row.post_url);
    if (row.status === "published") {
      lines.push(`• ${label} : ${url ? `<a href="${escapeTelegramHtml(url)}">voir le post</a>` : "publiée"}`);
    } else if (row.status === "failed") {
      lines.push(`• ${label} : échec${row.error_message ? ` — ${escapeTelegramHtml(row.error_message)}` : ""}`);
    } else {
      lines.push(`• ${label} : ${escapeTelegramHtml(row.status)}`);
    }
  }

  if (event === "publication_published" && publication.caption) {
    lines.push("", "<b>Caption</b>", escapeTelegramHtml(captionPreview(publication.caption)));
  }
  if (event === "publication_failed" && publication.error_message) {
    lines.push("", `<b>Erreur</b> : ${escapeTelegramHtml(publication.error_message)}`);
  }

  return lines.join("\n");
}

function postButtons(platforms: PublicationPlatform[]) {
  return platforms.flatMap<TelegramButton>((row) => {
    const url = safePostUrl(row.post_url);
    return row.status === "published" && url ? [{ text: platformLabels[row.platform], url }] : [];
  });
}

export async function sendTelegramMessage(text: string, options?: { chatId?: string; buttons?: TelegramButton[] }) {
  const { token, chatId: configuredChatId } = getTelegramConfig();
  const chatId = options?.chatId || configuredChatId;
  if (!token || !chatId) throw new Error("Telegram bot token and chat ID are not configured.");

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (options?.buttons?.length) {
    body.reply_markup = { inline_keyboard: options.buttons.map((button) => [button]) };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  const data = (await response.json().catch(() => null)) as TelegramApiResponse | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram sendMessage failed with HTTP ${response.status}.`);
  }
  return data.result?.message_id ?? null;
}

async function loadPublicationContext(db: Db, publicationId: string): Promise<PublicationContext> {
  const { data: publication, error } = await db.from("publications").select("*").eq("id", publicationId).single<Publication>();
  if (error) throw error;
  const [accountResult, videoResult, platformResult] = await Promise.all([
    db.from("account_groups").select("name,timezone").eq("id", publication.account_group_id).single<{ name: string; timezone: string }>(),
    db.from("videos").select("filename").eq("id", publication.video_id).single<{ filename: string }>(),
    db.from("publication_platforms").select("*").eq("publication_id", publicationId).order("platform").returns<PublicationPlatform[]>()
  ]);
  if (accountResult.error) throw accountResult.error;
  if (videoResult.error) throw videoResult.error;
  if (platformResult.error) throw platformResult.error;
  return {
    publication,
    accountName: accountResult.data.name,
    timezone: accountResult.data.timezone || "Europe/Paris",
    filename: videoResult.data.filename,
    platforms: platformResult.data ?? []
  };
}

function retryAt(attemptCount: number) {
  const delays = [1, 5, 30, 180];
  const minutes = delays[Math.min(attemptCount, delays.length - 1)];
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function getOrCreateDelivery(
  db: Db,
  publicationId: string,
  event: Exclude<NotificationEvent, "daily_summary" | "test">
) {
  const dedupeKey = `telegram:${event}:${publicationId}`;
  const { data, error } = await db
    .from("notification_deliveries")
    .upsert(
      { publication_id: publicationId, channel: "telegram", event, dedupe_key: dedupeKey },
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    )
    .select("*")
    .maybeSingle<NotificationDelivery>();
  if (error) throw error;
  if (data) return data;
  const existing = await db.from("notification_deliveries").select("*").eq("dedupe_key", dedupeKey).single<NotificationDelivery>();
  if (existing.error) throw existing.error;
  return existing.data;
}

async function deliverPublicationNotification(
  db: Db,
  delivery: NotificationDelivery,
  event: Exclude<NotificationEvent, "daily_summary" | "test">
) {
  if (delivery.status === "sent" || delivery.status === "sending") return { status: delivery.status };
  if (delivery.next_retry_at && new Date(delivery.next_retry_at) > new Date()) return { status: "waiting" as const };

  const context = await loadPublicationContext(db, delivery.publication_id!);
  const attempts = delivery.attempt_count + 1;
  const claimed = await db
    .from("notification_deliveries")
    .update({ status: "sending", attempt_count: attempts, updated_at: new Date().toISOString() })
    .eq("id", delivery.id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return { status: "claimed" as const };

  try {
    const text = buildPublicationTelegramMessage(context, event);
    const messageId = await sendTelegramMessage(text, { buttons: postButtons(context.platforms) });
    await db
      .from("notification_deliveries")
      .update({
        status: "sent",
        payload: { telegram_message_id: messageId },
        sent_at: new Date().toISOString(),
        next_retry_at: null,
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", delivery.id);
    await logAction(db, { action: `telegram_${event}`, status: "sent", publicationId: delivery.publication_id! });
    return { status: "sent" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram delivery error.";
    await db
      .from("notification_deliveries")
      .update({ status: "failed", next_retry_at: retryAt(attempts), last_error: message, updated_at: new Date().toISOString() })
      .eq("id", delivery.id);
    await logAction(db, { action: `telegram_${event}`, status: "failed", error: message, publicationId: delivery.publication_id! });
    return { status: "failed" as const, error: message };
  }
}

export async function notifyPublication(
  db: Db,
  publicationId: string,
  event: Exclude<NotificationEvent, "daily_summary" | "test">
) {
  try {
    if (!getTelegramConfig().configured) return { status: "not_configured" as const };
    const settingColumn = event === "publication_published" ? "telegram_notify_published" : "telegram_notify_failed";
    const settings = await db.from("app_settings").select(settingColumn).eq("id", true).maybeSingle<Record<string, boolean>>();
    if (settings.error) throw settings.error;
    if (settings.data?.[settingColumn] === false) return { status: "disabled" as const };
    const delivery = await getOrCreateDelivery(db, publicationId, event);
    return await deliverPublicationNotification(db, delivery, event);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram notification error.";
    await logAction(db, { action: `telegram_${event}`, status: "failed", error: message, publicationId });
    return { status: "failed" as const, error: message };
  }
}

export async function retryPendingTelegramNotifications(db: Db) {
  if (!getTelegramConfig().configured) return 0;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("notification_deliveries")
    .select("*")
    .eq("channel", "telegram")
    .in("event", ["publication_published", "publication_failed"])
    .in("status", ["pending", "failed"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order("created_at")
    .limit(20)
    .returns<NotificationDelivery[]>();
  if (error) return 0;
  let sent = 0;
  for (const delivery of data ?? []) {
    const result = await deliverPublicationNotification(
      db,
      delivery,
      delivery.event as "publication_published" | "publication_failed"
    );
    if (result.status === "sent") sent += 1;
  }
  return sent;
}

export async function sendTelegramTestNotification() {
  const messageId = await sendTelegramMessage(
    "✅ <b>Cocorise Auto Publisher</b>\n\nTelegram est correctement connecté. Les prochaines publications confirmées seront envoyées ici."
  );
  return { messageId };
}

export async function sendTelegramDailySummary(now = new Date()) {
  const db = createServiceClient();
  if (!getTelegramConfig().configured) return { status: "not_configured" as const };
  const settings = await db
    .from("app_settings")
    .select("timezone,telegram_daily_summary")
    .eq("id", true)
    .single<{ timezone: string; telegram_daily_summary: boolean }>();
  if (settings.error) throw settings.error;
  if (!settings.data.telegram_daily_summary) return { status: "disabled" as const };

  const timezone = settings.data.timezone || "Europe/Paris";
  const localDate = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const start = fromZonedTime(`${localDate}T00:00:00`, timezone);
  const endDate = formatInTimeZone(addDays(start, 1), timezone, "yyyy-MM-dd");
  const end = fromZonedTime(`${endDate}T00:00:00`, timezone);
  const dedupeKey = `telegram:daily_summary:${localDate}`;
  const existing = await db.from("notification_deliveries").select("status").eq("dedupe_key", dedupeKey).maybeSingle<{ status: string }>();
  if (existing.data?.status === "sent") return { status: "already_sent" as const };

  const [published, failed, scheduled] = await Promise.all([
    db.from("publications").select("id", { count: "exact", head: true }).gte("published_at", start.toISOString()).lt("published_at", end.toISOString()),
    db.from("publications").select("id", { count: "exact", head: true }).gte("failed_at", start.toISOString()).lt("failed_at", end.toISOString()),
    db.from("publications").select("id", { count: "exact", head: true }).in("status", ["queued", "scheduled", "sending", "processing"])
  ]);
  const text = [
    `📊 <b>Résumé Cocorise — ${escapeTelegramHtml(formatInTimeZone(now, timezone, "dd/MM/yyyy"))}</b>`,
    "",
    `✅ Publiées : <b>${published.count ?? 0}</b>`,
    `❌ Échouées : <b>${failed.count ?? 0}</b>`,
    `🕒 Encore dans la file : <b>${scheduled.count ?? 0}</b>`
  ].join("\n");

  const delivery = await db
    .from("notification_deliveries")
    .upsert(
      { channel: "telegram", event: "daily_summary", dedupe_key: dedupeKey, status: "sending", attempt_count: 1 },
      { onConflict: "dedupe_key" }
    )
    .select("id")
    .single<{ id: string }>();
  if (delivery.error) throw delivery.error;
  try {
    const messageId = await sendTelegramMessage(text);
    await db
      .from("notification_deliveries")
      .update({ status: "sent", payload: { telegram_message_id: messageId }, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", delivery.data.id);
    return { status: "sent" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram summary error.";
    await db
      .from("notification_deliveries")
      .update({ status: "failed", last_error: message, next_retry_at: retryAt(1), updated_at: new Date().toISOString() })
      .eq("id", delivery.data.id);
    throw error;
  }
}
