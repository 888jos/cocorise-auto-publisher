import { addDays, differenceInCalendarDays, isAfter, parseISO, set } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import type { AccountGroup, CaptionTemplate, Publication, SchedulerSettings, Video } from "@/lib/types/domain";

export function stableHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateWithMinutes(date: Date, minutes: number) {
  return set(date, { hours: Math.floor(minutes / 60), minutes: minutes % 60, seconds: 0, milliseconds: 0 });
}

export function slotForAccount(account: AccountGroup, day: Date, windowIndex: number, settings: SchedulerSettings) {
  const window = settings.windows[windowIndex];
  const start = minutesFromTime(window.start);
  const end = minutesFromTime(window.end);
  const span = Math.max(1, end - start);
  const spread = Math.max(0, settings.maxStaggerMinutes - settings.minStaggerMinutes);
  const timezone = account.timezone || settings.timezone;
  const seed = stableHash(`${account.id}:${formatInTimeZone(day, timezone, "yyyy-MM-dd")}:${window.name}`);
  const offset = settings.minStaggerMinutes + (seed % Math.max(1, Math.min(span, spread + 1)));
  return fromZonedTime(dateWithMinutes(toZonedTime(day, timezone), Math.min(end - 1, start + offset)), timezone);
}

export function generateAccountSlots(account: AccountGroup, start: Date, days: number, settings: SchedulerSettings) {
  const postsPerDay = account.posts_per_day || settings.postsPerDay;
  const windows = settings.windows.slice(0, postsPerDay);
  const slots: Date[] = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const day = addDays(start, dayOffset);
    for (let index = 0; index < windows.length; index += 1) {
      const slot = slotForAccount(account, day, index, settings);
      const previous = slots.at(-1);
      if (!previous || slot.getTime() - previous.getTime() >= settings.minMinutesBetweenPosts * 60_000) {
        slots.push(slot);
      }
    }
  }

  return slots;
}

export function selectNextVideo(
  account: AccountGroup,
  scheduledAt: Date,
  videos: Video[],
  publications: Publication[],
  settings: SchedulerSettings
) {
  const usedOnAccount = new Set(
    publications
      .filter((publication) => publication.account_group_id === account.id && publication.status !== "cancelled")
      .map((publication) => publication.video_id)
  );

  const sameDayScheduled = new Set(
    publications
      .filter((publication) => Math.abs(differenceInCalendarDays(parseISO(publication.scheduled_at), scheduledAt)) === 0)
      .map((publication) => publication.video_id)
  );

  const candidates = videos
    .filter((video) => video.status === "available")
    .filter((video) => !usedOnAccount.has(video.id))
    .filter((video) => {
      if (!video.last_used_at) return true;
      const nextAllowed = parseISO(video.last_used_at).getTime() + settings.reuseCooldownHours * 60 * 60 * 1000;
      return scheduledAt.getTime() >= nextAllowed;
    })
    .map((video) => {
      const lastUsed = video.last_used_at ? parseISO(video.last_used_at).getTime() : 0;
      const jitter = stableHash(`${account.id}:${video.id}:${scheduledAt.toISOString()}`) % 17;
      const sameDayPenalty = sameDayScheduled.has(video.id) ? 10_000 : 0;
      return {
        video,
        score: video.times_used * 1000 + sameDayPenalty + (lastUsed ? lastUsed / 100_000_000 : -1000) + jitter
      };
    })
    .sort((a, b) => a.score - b.score);

  return candidates[0]?.video ?? null;
}

export function chooseCaptionTemplate(
  account: AccountGroup,
  templates: CaptionTemplate[],
  publications: Publication[],
  platform: "all" | "tiktok" | "instagram" | "youtube" = "all"
) {
  const recentTemplateIds = publications
    .filter((publication) => publication.account_group_id === account.id)
    .slice(-3)
    .map((publication) => publication.caption_template_id)
    .filter(Boolean);

  const eligible = templates.filter((template) => template.active && (template.platform === "all" || template.platform === platform));
  const expanded = eligible.flatMap((template) => Array.from({ length: template.weight }, () => template));
  const filtered = expanded.filter((template) => !recentTemplateIds.includes(template.id));
  const pool = filtered.length ? filtered : expanded;
  if (!pool.length) return null;
  return pool[stableHash(`${account.id}:${recentTemplateIds.join("|")}:${platform}`) % pool.length];
}

export function renderCaption(template: CaptionTemplate, variables: Record<string, string>) {
  return template.template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .trim();
}

export function nextRetryAt(now: Date, _retryCount: number) {
  return new Date(now.getTime() + 5 * 60_000);
}

export function shouldPauseAccount(consecutiveFailures: number, threshold = 3) {
  return consecutiveFailures >= threshold;
}

export function hasFutureBuffer(account: AccountGroup, publications: Publication[], now: Date, settings: SchedulerSettings) {
  const needed = (account.posts_per_day || settings.postsPerDay) * settings.scheduleHorizonDays;
  const future = publications.filter(
    (publication) =>
      publication.account_group_id === account.id &&
      ["queued", "scheduled", "sending", "processing"].includes(publication.status) &&
      isAfter(parseISO(publication.scheduled_at), now)
  ).length;
  return { needed, future, missing: Math.max(0, needed - future) };
}
