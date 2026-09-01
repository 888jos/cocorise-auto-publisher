import { addDays, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { escapeTelegramHtml } from "@/lib/services/telegram";
import { getPostAnalytics, type UploadPostPostAnalytics } from "@/lib/services/uploadPost";
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

type PlatformStatusRow = {
  platform: SocialPlatform;
  status: string;
};

type AnalyticsTotals = {
  posts: number;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
};

const socialPlatforms: SocialPlatform[] = ["tiktok", "instagram", "youtube"];
const emptyAnalyticsTotals = (): AnalyticsTotals => ({ posts: 0, views: 0, likes: 0, comments: 0, saves: 0, shares: 0 });

export const telegramCommands = [
  { command: "status", description: "État de l’auto-publication" },
  { command: "stats", description: "Statistiques sur 7 jours" },
  { command: "today", description: "Résultats du jour" },
  { command: "analytics", description: "Vues et engagement par jour" },
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

export function telegramAnalyticsDays(text: string) {
  const value = Number.parseInt(text.trim().split(/\s+/)[1] || "7", 10);
  return Number.isFinite(value) ? Math.min(30, Math.max(1, value)) : 7;
}

export function platformStatusCounts(rows: PlatformStatusRow[]) {
  return rows.reduce<Record<SocialPlatform, number>>((counts, row) => {
    counts[row.platform] += 1;
    return counts;
  }, { tiktok: 0, instagram: 0, youtube: 0 });
}

function metric(metrics: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(metrics[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

export function analyticsTotals(response: UploadPostPostAnalytics) {
  const totals = Object.fromEntries(socialPlatforms.map((platform) => [platform, emptyAnalyticsTotals()])) as Record<SocialPlatform, AnalyticsTotals>;
  for (const platform of socialPlatforms) {
    const result = response.platforms?.[platform];
    if (!result?.success || !result.post_metrics) continue;
    const metrics = result.post_metrics;
    totals[platform] = {
      posts: 1,
      views: metric(metrics, "views", "impressions", "reach"),
      likes: metric(metrics, "likes"),
      comments: metric(metrics, "comments"),
      saves: metric(metrics, "saves", "favorites"),
      shares: metric(metrics, "shares")
    };
  }
  return totals;
}

function addAnalytics(target: AnalyticsTotals, source: AnalyticsTotals) {
  for (const key of Object.keys(target) as Array<keyof AnalyticsTotals>) target[key] += source[key];
}

function analyticsLine(label: string, totals: AnalyticsTotals) {
  return `${label} : <b>${totals.posts}</b> post${totals.posts > 1 ? "s" : ""} · ${totals.views} vues · ${totals.likes} likes · ${totals.comments} com. · ${totals.saves} sauv. · ${totals.shares} part.`;
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
    "/analytics — engagement des 7 derniers jours",
    "/analytics 1 — vues, likes et commentaires du jour",
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
    const [published, failed, publishedPlatforms, failedPlatforms] = await Promise.all([
      db.from("publications").select("id", { count: "exact", head: true }).gte("published_at", start.toISOString()).lt("published_at", end.toISOString()),
      db.from("publications").select("id", { count: "exact", head: true }).gte("failed_at", start.toISOString()).lt("failed_at", end.toISOString()),
      db.from("publication_platforms").select("platform,status").eq("status", "published").gte("published_at", start.toISOString()).lt("published_at", end.toISOString()).returns<PlatformStatusRow[]>(),
      db.from("publication_platforms").select("platform,status").eq("status", "failed").gte("updated_at", start.toISOString()).lt("updated_at", end.toISOString()).returns<PlatformStatusRow[]>()
    ]);
    if (publishedPlatforms.error) throw publishedPlatforms.error;
    if (failedPlatforms.error) throw failedPlatforms.error;
    const posts = platformStatusCounts(publishedPlatforms.data ?? []);
    const postFailures = platformStatusCounts(failedPlatforms.data ?? []);
    const confirmedPosts = posts.tiktok + posts.instagram + posts.youtube;
    const failedPosts = postFailures.tiktok + postFailures.instagram + postFailures.youtube;
    return [
      `📊 <b>Aujourd’hui — ${escapeTelegramHtml(formatInTimeZone(now, timezone, "dd/MM/yyyy"))}</b>`,
      "",
      `<b>Jobs vidéo</b>`,
      `✅ Terminés : <b>${published.count ?? 0}</b>`,
      `❌ Échoués : <b>${failed.count ?? 0}</b>`,
      "",
      `<b>Posts sociaux confirmés : ${confirmedPosts}</b>`,
      `• TikTok : <b>${posts.tiktok}</b>`,
      `• Instagram : <b>${posts.instagram}</b>`,
      `• YouTube : <b>${posts.youtube}</b>`,
      failedPosts ? `\nPosts sociaux en échec : <b>${failedPosts}</b> (TT ${postFailures.tiktok} · IG ${postFailures.instagram} · YT ${postFailures.youtube})` : ""
    ].join("\n");
  }

  if (command === "/analytics") {
    if (process.env.PUBLISHING_PROVIDER === "direct") {
      return "Les analytics Telegram nécessitent actuellement le fournisseur Upload-Post.";
    }
    const days = telegramAnalyticsDays(text);
    const localDate = formatInTimeZone(now, timezone, "yyyy-MM-dd");
    const startDate = formatInTimeZone(subDays(fromZonedTime(`${localDate}T00:00:00`, timezone), days - 1), timezone, "yyyy-MM-dd");
    const start = fromZonedTime(`${startDate}T00:00:00`, timezone);
    const nextDate = formatInTimeZone(addDays(fromZonedTime(`${localDate}T00:00:00`, timezone), 1), timezone, "yyyy-MM-dd");
    const end = fromZonedTime(`${nextDate}T00:00:00`, timezone);
    const { data, error } = await db
      .from("publications")
      .select("provider_request_id,published_at")
      .eq("status", "published")
      .not("provider_request_id", "is", null)
      .gte("published_at", start.toISOString())
      .lt("published_at", end.toISOString())
      .order("published_at")
      .limit(75)
      .returns<Array<{ provider_request_id: string; published_at: string }>>();
    if (error) throw error;
    if (!data?.length) return `Aucun post publié pendant les ${days} dernier${days > 1 ? "s" : ""} jour${days > 1 ? "s" : ""}.`;

    const daily = new Map<string, Record<SocialPlatform, AnalyticsTotals>>();
    let unavailable = 0;
    for (let index = 0; index < data.length; index += 5) {
      const batch = data.slice(index, index + 5);
      const results = await Promise.all(batch.map(async (publication) => {
        try {
          return { publication, response: await getPostAnalytics(publication.provider_request_id) };
        } catch {
          unavailable += 1;
          return null;
        }
      }));
      for (const result of results) {
        if (!result) continue;
        const day = formatInTimeZone(result.publication.published_at, timezone, "dd/MM/yyyy");
        const totals = daily.get(day) ?? Object.fromEntries(socialPlatforms.map((platform) => [platform, emptyAnalyticsTotals()])) as Record<SocialPlatform, AnalyticsTotals>;
        const postTotals = analyticsTotals(result.response);
        for (const platform of socialPlatforms) addAnalytics(totals[platform], postTotals[platform]);
        daily.set(day, totals);
      }
    }

    const rows = [...daily.entries()].reverse().flatMap(([day, totals]) => {
      const all = emptyAnalyticsTotals();
      for (const platform of socialPlatforms) addAnalytics(all, totals[platform]);
      return [
        `<b>${escapeTelegramHtml(day)}</b> — ${all.posts} posts · <b>${all.views} vues</b> · ${all.likes} likes · ${all.comments} com. · ${all.saves} sauv. · ${all.shares} part.`,
        analyticsLine("TikTok", totals.tiktok),
        analyticsLine("Instagram", totals.instagram),
        analyticsLine("YouTube", totals.youtube),
        ""
      ];
    });
    return [
      `📈 <b>Performance live — ${days} jour${days > 1 ? "s" : ""}</b>`,
      "Mesures cumulées à maintenant, regroupées selon le jour de publication.",
      "",
      ...rows,
      unavailable ? `Données indisponibles pour ${unavailable} job${unavailable > 1 ? "s" : ""}.` : ""
    ].join("\n").trim();
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
