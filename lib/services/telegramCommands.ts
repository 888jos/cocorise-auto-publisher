import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { escapeTelegramHtml } from "@/lib/services/telegram";
import { createServiceClient } from "@/lib/supabase/server";

export function normalizeTelegramCommand(text: string) {
  return text.trim().split(/\s+/)[0].toLowerCase().replace(/@[^\s]+$/, "");
}

export async function telegramCommandReply(text: string, now = new Date()) {
  const command = normalizeTelegramCommand(text);
  if (["/start", "/help"].includes(command)) {
    return [
      "<b>Cocorise Auto Publisher</b>",
      "",
      "Je confirme les publications réelles et surveille la file automatiquement.",
      "",
      "/status — état global",
      "/today — résultats du jour",
      "/next — prochaine publication"
    ].join("\n");
  }

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

  if (command === "/next") {
    const { data: publication, error } = await db
      .from("publications")
      .select("scheduled_at,account_group_id,video_id")
      .in("status", ["queued", "scheduled", "sending", "processing"])
      .gte("scheduled_at", now.toISOString())
      .order("scheduled_at")
      .limit(1)
      .maybeSingle<{ scheduled_at: string; account_group_id: string; video_id: string }>();
    if (error) throw error;
    if (!publication) return "La file ne contient aucune prochaine publication.";
    const [account, video] = await Promise.all([
      db.from("account_groups").select("name").eq("id", publication.account_group_id).single<{ name: string }>(),
      db.from("videos").select("filename").eq("id", publication.video_id).single<{ filename: string }>()
    ]);
    if (account.error) throw account.error;
    if (video.error) throw video.error;
    return [
      "🕒 <b>Prochaine publication</b>",
      "",
      `Compte : <b>${escapeTelegramHtml(account.data.name)}</b>`,
      `Vidéo : <code>${escapeTelegramHtml(video.data.filename)}</code>`,
      `Heure : ${escapeTelegramHtml(formatInTimeZone(publication.scheduled_at, timezone, "dd/MM/yyyy HH:mm"))}`
    ].join("\n");
  }

  return "Commande inconnue. Utilise /help pour afficher les commandes disponibles.";
}
