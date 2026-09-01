import { addDays, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { escapeTelegramHtml } from "@/lib/services/telegram";
import { createServiceClient } from "@/lib/supabase/server";
import type { AccountGroup, PublicationStatus, SocialPlatform, VideoStatus } from "@/lib/types/domain";

type Db = ReturnType<typeof createServiceClient>;

type QueueRow = {
  id: string;
  scheduled_at: string;
  account_group_id: string;
  video_id: string;
  status: PublicationStatus;
  error_message?: string | null;
  failed_at?: string | null;
};

export const telegramCommands = [
  { command: "status", description: "État de l’auto-publication" },
  { command: "stats", description: "Statistiques sur 7 jours" },
  { command: "today", description: "Résultats du jour" },
  { command: "content", description: "Stock de vidéos Drive" },
  { command: "accounts", description: "État des comptes" },
  { command: "queue", description: "5 prochaines publications" },
  { command: "next", description: "Prochaine publication" },
  { command: "failures", description: "5 derniers échecs" },
  { command: "help", description: "Commandes disponibles" }
] as const;

export function normalizeTelegramCommand(text: string) {
  return text.trim().split(/\s+/)[0].toLowerCase().replace(/@[^\s]+$/, "");
}

export function telegramStatsDays(text: string) {
  const value = Number.parseInt(text.trim().split(/\s+/)[1] || "7", 10);
  return Number.isFinite(value) ? Math.min(90, Math.max(1, value)) : 7;
}

function helpMessage() {
  return [
    "<b>Cocorise Auto Publisher</b>",
    "",
    "Je confirme les publications réelles et surveille la file automatiquement.",
    "",
    "/status — état global",
    "/stats — stats des 7 derniers jours",
    "/stats 30 — stats des 30 derniers jours",
    "/today — résultats du jour",
    "/content — stock de vidéos Drive",
    "/accounts — état des comptes",
    "/queue — 5 prochaines publications",
    "/next — prochaine publication",
    "/failures — 5 derniers échecs"
  ].join("\n");
}

function countBy<T extends string>(rows: Array<{ status: T }> | null | undefined, statuses: readonly T[]) {
  return Object.fromEntries(statuses.map((status) => [status, rows?.filter((row) => row.status === status).length ?? 0])) as Record<T, number>;
}

async function namesForRows(db: Db, rows: QueueRow[]) {
  const accountIds = [...new Set(rows.map((row) => row.account_group_id))];
  const videoIds = [...new Set(rows.map((row) => row.video_id))];
  const [accounts, videos] = await Promise.all([
    accountIds.length
      ? db.from("account_groups").select("id,name").in("id", accountIds).returns<Array<{ id: string; name: string }>>()
      : Promise.resolve({ data: [], error: null }),
    videoIds.length
      ? db.from("videos").select("id,filename").in("id", videoIds).returns<Array<{ id: string; filename: string }>>()
      : Promise.resolve({ data: [], error: null })
  ]);
  if (accounts.error) throw accounts.error;
  if (videos.error) throw videos.error;
  return {
    accounts: new Map((accounts.data ?? []).map((row) => [row.id, row.name])),
    videos: new Map((videos.data ?? []).map((row) => [row.id, row.filename]))
  };
}

function shortText(value: string) {
  return value.length > 46 ? `${value.slice(0, 43)}...` : value;
}

export async function telegramCommandReply(text: string, now = new Date()) {
  const command = normalizeTelegramCommand(text);
  if (["/start", "/help"].includes(command)) return helpMessage();

  const db = createServiceClient();
  const { data: settings, error: settingsError } = await db
    .from("app_settings")
    .select("timezone,pause_all_publishing")
    .eq("id", true)
    .single<{ timezone: string; pause_all_publishing: boolean }>();
  if (settingsError) throw settingsError;
  const timezone = settings.timezone || "Europe/Paris";

  if (command === "/status") {
    const [activeAccounts, queued, failed] = await Promise.all([
      db.from("account_groups").select("id", { count: "exact", head: true }).eq("active", true),
      db.from("publications").select("id", { count: "exact", head: true }).in("status", ["queued", "scheduled", "sending", "processing"]),
      db.from("publications").select("id", { count: "exact", head: true }).eq("status", "failed")
    ]);
    return [
      "📡 <b>État Cocorise</b>",
      "",
      `Publication : <b>${settings.pause_all_publishing ? "en pause" : "active"}</b>`,
      `Comptes actifs : <b>${activeAccounts.count ?? 0}</b>`,
      `Dans la file : <b>${queued.count ?? 0}</b>`,
      `Échecs à vérifier : <b>${failed.count ?? 0}</b>`
    ].join("\n");
  }

  if (command === "/stats") {
    const days = telegramStatsDays(text);
    const since = subDays(now, days).toISOString();
    const [publications, platforms, allPublished] = await Promise.all([
      db.from("publications").select("status").gte("scheduled_at", since).returns<Array<{ status: PublicationStatus }>>(),
      db.from("publication_platforms").select("platform,status,published_at").gte("published_at", since).eq("status", "published").returns<Array<{ platform: SocialPlatform; status: string; published_at: string }>>(),
      db.from("publications").select("id", { count: "exact", head: true }).eq("status", "published")
    ]);
    if (publications.error) throw publications.error;
    if (platforms.error) throw platforms.error;
    const publicationCounts = countBy(publications.data, ["published", "failed", "cancelled"] as const);
    const total = publications.data?.length ?? 0;
    const completed = publicationCounts.published + publicationCounts.failed;
    const successRate = completed ? Math.round((publicationCounts.published / completed) * 100) : 0;
    const platformCounts = (platforms.data ?? []).reduce<Record<SocialPlatform, number>>((counts, row) => {
      counts[row.platform] += 1;
      return counts;
    }, { tiktok: 0, instagram: 0, youtube: 0 });
    return [
      `📈 <b>Statistiques — ${days} jour${days > 1 ? "s" : ""}</b>`,
      "",
      `✅ Publications réussies : <b>${publicationCounts.published}</b>`,
      `❌ Publications échouées : <b>${publicationCounts.failed}</b>`,
      `🎯 Taux de réussite : <b>${successRate} %</b>`,
      `📋 Éléments traités/planifiés : <b>${total}</b>`,
      "",
      "<b>Posts confirmés par plateforme</b>",
      `• TikTok : <b>${platformCounts.tiktok}</b>`,
      `• Instagram : <b>${platformCounts.instagram}</b>`,
      `• YouTube : <b>${platformCounts.youtube}</b>`,
      "",
      `Total historique publié : <b>${allPublished.count ?? 0}</b>`
    ].join("\n");
  }

  if (command === "/today") {
    const localDate = formatInTimeZone(now, timezone, "yyyy-MM-dd");
    const start = fromZonedTime(`${localDate}T00:00:00`, timezone);
    const nextDate = formatInTimeZone(addDays(start, 1), timezone, "yyyy-MM-dd");
    const end = fromZonedTime(`${nextDate}T00:00:00`, timezone);
    const [published, failed] = await Promise.all([
      db.from("publications").select("id", { count: "exact", head: true }).gte("published_at", start.toISOString()).lt("published_at", end.toISOString()),
      db.from("publications").select("id", { count: "exact", head: true }).gte("failed_at", start.toISOString()).lt("failed_at", end.toISOString())
    ]);
    return [
      `📊 <b>Aujourd’hui — ${escapeTelegramHtml(formatInTimeZone(now, timezone, "dd/MM/yyyy"))}</b>`,
      "",
      `✅ Publiées : <b>${published.count ?? 0}</b>`,
      `❌ Échouées : <b>${failed.count ?? 0}</b>`
    ].join("\n");
  }

  if (["/content", "/videos"].includes(command)) {
    const { data, error } = await db.from("videos").select("status").returns<Array<{ status: VideoStatus }>>();
    if (error) throw error;
    const counts = countBy(data, ["available", "scheduled", "partially_published", "published", "failed", "disabled"] as const);
    return [
      "🎬 <b>Contenu Google Drive</b>",
      "",
      `Disponible : <b>${counts.available}</b>`,
      `Planifié : <b>${counts.scheduled}</b>`,
      `Partiellement publié : <b>${counts.partially_published}</b>`,
      `Publié : <b>${counts.published}</b>`,
      `En échec : <b>${counts.failed}</b>`,
      `Désactivé : <b>${counts.disabled}</b>`,
      "",
      `Total indexé : <b>${data?.length ?? 0}</b>`
    ].join("\n");
  }

  if (command === "/accounts") {
    const { data, error } = await db.from("account_groups").select("*").order("name").returns<AccountGroup[]>();
    if (error) throw error;
    const rows = (data ?? []).map((account) => {
      const platforms = [account.tiktok_enabled ? "TT" : null, account.instagram_enabled ? "IG" : null, account.youtube_enabled ? "YT" : null].filter(Boolean).join("/");
      const state = !account.active ? "⏸" : account.paused_reason || account.consecutive_failures > 0 ? "⚠️" : "✅";
      const detail = account.paused_reason
        ? ` — ${escapeTelegramHtml(account.paused_reason)}`
        : account.consecutive_failures > 0
          ? ` — ${account.consecutive_failures} échec(s)`
          : "";
      return `${state} <b>${escapeTelegramHtml(account.name)}</b> · ${platforms || "aucune plateforme"}${detail}`;
    });
    return ["👥 <b>Comptes Cocorise</b>", "", ...rows, "", `Actifs : <b>${(data ?? []).filter((row) => row.active).length}/${data?.length ?? 0}</b>`].join("\n");
  }

  if (["/queue", "/next"].includes(command)) {
    const limit = command === "/next" ? 1 : 5;
    const { data, error } = await db
      .from("publications")
      .select("id,scheduled_at,account_group_id,video_id,status")
      .in("status", ["queued", "scheduled", "sending", "processing"])
      .gte("scheduled_at", now.toISOString())
      .order("scheduled_at")
      .limit(limit)
      .returns<QueueRow[]>();
    if (error) throw error;
    if (!data?.length) return "La file ne contient aucune prochaine publication.";
    const names = await namesForRows(db, data);
    const rows = data.map((publication, index) => [
      `<b>${index + 1}. ${escapeTelegramHtml(formatInTimeZone(publication.scheduled_at, timezone, "dd/MM HH:mm"))}</b> · ${escapeTelegramHtml(names.accounts.get(publication.account_group_id) || "Compte inconnu")}`,
      `<code>${escapeTelegramHtml(shortText(names.videos.get(publication.video_id) || "Vidéo inconnue"))}</code>`
    ].join("\n"));
    return [command === "/next" ? "🕒 <b>Prochaine publication</b>" : "📋 <b>Prochaines publications</b>", "", ...rows].join("\n\n");
  }

  if (command === "/failures") {
    const { data, error } = await db
      .from("publications")
      .select("id,scheduled_at,account_group_id,video_id,status,error_message,failed_at")
      .eq("status", "failed")
      .order("failed_at", { ascending: false })
      .limit(5)
      .returns<QueueRow[]>();
    if (error) throw error;
    if (!data?.length) return "✅ Aucun échec de publication à afficher.";
    const names = await namesForRows(db, data);
    const rows = data.map((publication) => {
      const when = publication.failed_at || publication.scheduled_at;
      const errorText = publication.error_message ? shortText(publication.error_message.replace(/\s+/g, " ")) : "Erreur inconnue";
      return [
        `❌ <b>${escapeTelegramHtml(names.accounts.get(publication.account_group_id) || "Compte inconnu")}</b> · ${escapeTelegramHtml(formatInTimeZone(when, timezone, "dd/MM HH:mm"))}`,
        `<code>${escapeTelegramHtml(shortText(names.videos.get(publication.video_id) || "Vidéo inconnue"))}</code>`,
        escapeTelegramHtml(errorText)
      ].join("\n");
    });
    return ["🚨 <b>Derniers échecs</b>", "", ...rows].join("\n\n");
  }

  return "Commande inconnue. Utilise /help pour afficher les commandes disponibles.";
}
