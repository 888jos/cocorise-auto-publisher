import { addDays, subDays, subHours } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { AlertTriangle, BarChart3, PauseCircle, PlayCircle, RefreshCw, Send, Wand2 } from "lucide-react";
import { ConfigurationWarning, EmptyState } from "@/components/empty-state";
import { ActionButton, Metric, PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardData } from "@/lib/data";
import type { PublicationPlatform, SocialPlatform } from "@/lib/types/domain";

type DashboardSearchParams = {
  range?: string;
  start?: string;
  end?: string;
};

type AnalyticsRangeKey = "last24" | "today" | "yesterday" | "last7" | "last30" | "custom";

const rangeOptions: Array<{ key: AnalyticsRangeKey; label: string }> = [
  { key: "last24", label: "Last 24 hours" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "custom", label: "Custom" }
];

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function localDayStart(date: Date, timezone: string) {
  return fromZonedTime(`${formatInTimeZone(date, timezone, "yyyy-MM-dd")}T00:00:00`, timezone);
}

function parseLocalDate(value: string | undefined, timezone: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? fromZonedTime(`${value}T00:00:00`, timezone) : null;
}

function resolveAnalyticsRange(searchParams: DashboardSearchParams | undefined, timezone: string, now = new Date()) {
  const requested = one(searchParams?.range) as AnalyticsRangeKey | undefined;
  const range = rangeOptions.some((option) => option.key === requested) ? requested! : "today";
  const todayStart = localDayStart(now, timezone);
  const tomorrowStart = fromZonedTime(`${formatInTimeZone(addDays(todayStart, 1), timezone, "yyyy-MM-dd")}T00:00:00`, timezone);
  const startParam = one(searchParams?.start);
  const endParam = one(searchParams?.end);

  if (range === "last24") {
    return { range, start: subHours(now, 24), end: now, label: "Last 24 hours", startInput: startParam, endInput: endParam };
  }
  if (range === "yesterday") {
    const start = fromZonedTime(`${formatInTimeZone(subDays(todayStart, 1), timezone, "yyyy-MM-dd")}T00:00:00`, timezone);
    return { range, start, end: todayStart, label: "Yesterday", startInput: startParam, endInput: endParam };
  }
  if (range === "last7") {
    const start = fromZonedTime(`${formatInTimeZone(subDays(todayStart, 6), timezone, "yyyy-MM-dd")}T00:00:00`, timezone);
    return { range, start, end: tomorrowStart, label: "Last 7 days", startInput: startParam, endInput: endParam };
  }
  if (range === "last30") {
    const start = fromZonedTime(`${formatInTimeZone(subDays(todayStart, 29), timezone, "yyyy-MM-dd")}T00:00:00`, timezone);
    return { range, start, end: tomorrowStart, label: "Last 30 days", startInput: startParam, endInput: endParam };
  }
  if (range === "custom") {
    const fallbackStart = todayStart;
    const fallbackEnd = tomorrowStart;
    const start = parseLocalDate(startParam, timezone) ?? fallbackStart;
    const endStart = parseLocalDate(endParam, timezone);
    const end = endStart && endStart >= start ? fromZonedTime(`${formatInTimeZone(addDays(endStart, 1), timezone, "yyyy-MM-dd")}T00:00:00`, timezone) : fallbackEnd;
    return {
      range,
      start,
      end,
      label: `${formatInTimeZone(start, timezone, "MMM d")} - ${formatInTimeZone(subDays(end, 1), timezone, "MMM d")}`,
      startInput: startParam ?? formatInTimeZone(start, timezone, "yyyy-MM-dd"),
      endInput: endParam ?? formatInTimeZone(subDays(end, 1), timezone, "yyyy-MM-dd")
    };
  }

  return { range: "today" as const, start: todayStart, end: tomorrowStart, label: "Today", startInput: startParam, endInput: endParam };
}

function within(value: string | null | undefined, start: Date, end: Date) {
  if (!value) return false;
  const date = new Date(value);
  return date >= start && date < end;
}

function platformCounts(rows: PublicationPlatform[]) {
  return rows.reduce<Record<SocialPlatform, number>>((counts, row) => {
    counts[row.platform] += 1;
    return counts;
  }, { tiktok: 0, instagram: 0, youtube: 0 });
}

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<DashboardSearchParams> }) {
  const params = await searchParams;
  const { videos, accounts, publications, publicationPlatforms, settings, configured, error } = await getDashboardData();
  const timezone = settings?.timezone || "Europe/Paris";
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const analyticsRange = resolveAnalyticsRange(params, timezone);
  const available = videos.filter((video) => video.status === "available").length;
  const activeAccounts = accounts.filter((account) => account.active).length;
  const scheduledToday = publications.filter((publication) => formatInTimeZone(publication.scheduled_at, timezone, "yyyy-MM-dd") === today).length;
  const publishedToday = publications.filter((publication) => publication.published_at && formatInTimeZone(publication.published_at, timezone, "yyyy-MM-dd") === today).length;
  const failed = publications.filter((publication) => publication.status === "failed").length;
  const postsPerDay = accounts.reduce((sum, account) => sum + (account.active ? account.posts_per_day : 0), 0) || 1;
  const runway = postsPerDay === 0 || available === 0 ? 0 : Math.floor((available * Math.max(1, activeAccounts)) / postsPerDay);
  const next = publications
    .filter((publication) => ["queued", "scheduled", "processing"].includes(publication.status))
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
    .slice(0, 8);
  const rangeScheduled = publications.filter((publication) => within(publication.scheduled_at, analyticsRange.start, analyticsRange.end));
  const rangePublished = publications.filter((publication) => within(publication.published_at, analyticsRange.start, analyticsRange.end));
  const rangeFailed = publications.filter((publication) => within(publication.failed_at, analyticsRange.start, analyticsRange.end));
  const rangePublishedPlatforms = publicationPlatforms.filter((publication) => publication.status === "published" && within(publication.published_at, analyticsRange.start, analyticsRange.end));
  const rangeFailedPlatforms = publicationPlatforms.filter((publication) => publication.status === "failed" && within(publication.updated_at, analyticsRange.start, analyticsRange.end));
  const publishedPlatforms = platformCounts(rangePublishedPlatforms);
  const failedPlatforms = platformCounts(rangeFailedPlatforms);
  const totalSocialPublished = publishedPlatforms.tiktok + publishedPlatforms.instagram + publishedPlatforms.youtube;
  const totalSocialFailed = failedPlatforms.tiktok + failedPlatforms.instagram + failedPlatforms.youtube;
  const completed = rangePublished.length + rangeFailed.length;
  const successRate = completed ? Math.round((rangePublished.length / completed) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Cocorise Auto Publisher"
        subtitle="Drop finished MP4s into Google Drive READY. This dashboard keeps imports, scheduling, publishing, retries, and account safety visible."
        actions={
          <>
            <ActionButton action="sync-drive"><RefreshCw className="mr-2 inline h-4 w-4" />Sync Drive Now</ActionButton>
            <ActionButton action="generate-schedule"><Wand2 className="mr-2 inline h-4 w-4" />Generate Schedule</ActionButton>
            <ActionButton action="publish-now"><Send className="mr-2 inline h-4 w-4" />Publish Now</ActionButton>
            <ActionButton action="pause-all" danger><PauseCircle className="mr-2 inline h-4 w-4" />Pause All</ActionButton>
          </>
        }
      />

      {!configured ? <ConfigurationWarning error={error} /> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Metric label="Videos available" value={String(available)} tone="good" />
        <Metric label="Content runway" value={`${runway}d`} detail="Approx. with reuse rules" tone={runway < 2 ? "danger" : runway < 12 ? "warn" : "neutral"} />
        <Metric label="Scheduled today" value={String(scheduledToday)} />
        <Metric label="Published today" value={String(publishedToday)} tone="good" />
        <Metric label="Failed" value={String(failed)} tone={failed ? "danger" : "neutral"} />
        <Metric label="Active accounts" value={String(activeAccounts)} />
      </div>

      <Panel className="mt-6 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="h-4 w-4 text-mint" />
              Analytics
            </h2>
            <p className="mt-1 text-xs text-muted">
              {analyticsRange.label} · {formatInTimeZone(analyticsRange.start, timezone, "dd/MM HH:mm")} - {formatInTimeZone(analyticsRange.end, timezone, "dd/MM HH:mm")}
            </p>
          </div>
          <form className="flex flex-col gap-2 lg:flex-row lg:items-end" method="get">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
              {rangeOptions.map((option) => (
                <button
                  key={option.key}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition ${analyticsRange.range === option.key ? "border-mint/50 bg-mint/10 text-mint" : "border-line bg-panel2 text-muted hover:text-white"}`}
                  name="range"
                  type="submit"
                  value={option.key}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input className="rounded-md border border-line bg-ink px-3 py-2 text-xs text-white outline-none" name="start" type="date" defaultValue={analyticsRange.startInput} />
            <input className="rounded-md border border-line bg-ink px-3 py-2 text-xs text-white outline-none" name="end" type="date" defaultValue={analyticsRange.endInput} />
            <button className="rounded-md border border-line bg-panel2 px-3 py-2 text-xs font-medium text-white hover:border-mint/40" name="range" type="submit" value="custom">
              Apply
            </button>
          </form>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
          <Metric label="Scheduled" value={String(rangeScheduled.length)} />
          <Metric label="Published jobs" value={String(rangePublished.length)} tone="good" />
          <Metric label="Failed jobs" value={String(rangeFailed.length)} tone={rangeFailed.length ? "danger" : "neutral"} />
          <Metric label="Social posts" value={String(totalSocialPublished)} detail={`TT ${publishedPlatforms.tiktok} · IG ${publishedPlatforms.instagram} · YT ${publishedPlatforms.youtube}`} tone="good" />
          <Metric label="Success rate" value={`${successRate}%`} detail={totalSocialFailed ? `${totalSocialFailed} platform failure(s)` : "No platform failures"} tone={successRate >= 95 || completed === 0 ? "good" : successRate >= 80 ? "warn" : "danger"} />
        </div>
        <div className="grid gap-3 border-t border-line p-4 md:grid-cols-3">
          {(["tiktok", "instagram", "youtube"] as SocialPlatform[]).map((platform) => (
            <div key={platform} className="rounded-md border border-line bg-panel2 p-3">
              <p className="text-xs font-medium uppercase text-muted">{platform}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{publishedPlatforms[platform]}</p>
              <p className={`mt-1 text-sm ${failedPlatforms[platform] ? "text-danger" : "text-muted"}`}>{failedPlatforms[platform]} failed</p>
            </div>
          ))}
        </div>
      </Panel>

      {configured && runway <= 12 ? (
        <Panel className="mt-5 flex items-center gap-3 border-amber/30 bg-amber/10 p-4 text-amber">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-sm">{runway < 2 ? "Less than 48 hours of content remaining." : `${runway} days of content remaining.`}</p>
        </Panel>
      ) : null}

      <Panel className="mt-6 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Next scheduled publications</h2>
        </div>
        <div className="divide-y divide-line">
          {next.length ? next.map((publication) => {
            const account = accounts.find((item) => item.id === publication.account_group_id);
            const video = videos.find((item) => item.id === publication.video_id);
            return (
              <div key={publication.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[160px_1fr_160px_120px] md:items-center">
                <span className="text-white">{formatInTimeZone(publication.scheduled_at, account?.timezone || "Europe/Paris", "MMM d, HH:mm")}</span>
                <span className="text-muted">{video?.filename ?? "Unknown video"}</span>
                <span>{account?.name ?? "Unknown account"}</span>
                <StatusPill status={publication.status} />
              </div>
            );
          }) : (
            <div className="px-4 py-5">
              <EmptyState title="Aucune publication planifiée" body="Lance Sync Drive Now après avoir configuré Google Drive, puis Generate Schedule quand des vidéos et comptes existent en base." />
            </div>
          )}
        </div>
      </Panel>

      <form action="/api/actions" method="post" className="mt-4">
        <input type="hidden" name="action" value="resume-all" />
        <button className="inline-flex items-center rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-muted hover:text-white" type="submit">
          <PlayCircle className="mr-2 h-4 w-4" />Resume publishing
        </button>
      </form>
    </>
  );
}
