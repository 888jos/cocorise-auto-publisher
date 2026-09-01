import { Save } from "lucide-react";
import { ConfigurationWarning } from "@/components/empty-state";
import { ActionButton, PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardData } from "@/lib/data";
import { getIntegrationReadiness } from "@/lib/integrations/status";

const defaults = {
  posts_per_day: 3,
  reuse_cooldown_hours: 96,
  schedule_horizon_days: 7,
  morning_start: "09:00",
  morning_end: "11:00",
  afternoon_start: "14:00",
  afternoon_end: "17:00",
  evening_start: "19:00",
  evening_end: "22:00",
  min_stagger_minutes: 7,
  max_stagger_minutes: 53,
  min_minutes_between_posts: 150,
  timezone: "Europe/Paris",
  failure_pause_threshold: 3,
  caption_hook: "",
  caption_body: "",
  caption_cta: "",
  caption_hashtags: "",
  telegram_notify_published: true,
  telegram_notify_failed: true,
  telegram_daily_summary: true
};

export default async function SettingsPage() {
  const { settings, configured, error } = await getDashboardData();
  const values = settings ?? defaults;
  const readiness = getIntegrationReadiness();
  const integrationRows: Array<[string, boolean]> = readiness.provider === "upload_post"
    ? [
        ["Supabase", readiness.supabase],
        ["Google Drive", readiness.googleDrive],
        ["Upload-Post", readiness.uploadPost],
        ["Public app URL", readiness.appUrl],
        ["Cron Secret", readiness.cron]
      ]
    : [
        ["Supabase", readiness.supabase],
        ["Google Drive", readiness.googleDrive],
        ["TikTok app", readiness.tiktok],
        ["Instagram app", readiness.instagram],
        ["YouTube app", readiness.youtube],
        ["Token encryption", readiness.tokenSecurity],
        ["Public app URL", readiness.appUrl],
        ["Cron Secret", readiness.cron]
      ];
  integrationRows.push(["Telegram", readiness.telegram]);

  return (
    <>
      <PageHeader title="Settings" subtitle="Global publishing cadence, reuse policy, scheduling windows, Drive folders, and emergency publishing controls." />
      {!configured ? <ConfigurationWarning error={error} /> : null}
      <Panel className="mb-5 p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Integrations readiness</h2>
            <p className="mt-1 text-sm text-muted">
              Publishing provider: <span className="text-white">{readiness.provider === "upload_post" ? "Upload-Post" : "Direct APIs"}</span>. Account connections are managed on Accounts.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton action="test-google-drive">Test Google Drive</ActionButton>
            {readiness.provider === "upload_post" ? <ActionButton action="test-upload-post">Test Upload-Post</ActionButton> : null}
            {readiness.telegram ? <ActionButton action="test-telegram">Test Telegram</ActionButton> : null}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {integrationRows.map(([label, ready]) => (
            <div key={String(label)} className="rounded-md border border-line bg-ink p-3">
              <p className="mb-2 text-sm text-muted">{label}</p>
              <StatusPill status={ready ? "configured" : "missing"} />
            </div>
          ))}
        </div>
      </Panel>
      <Panel className="p-4">
        <form action="/api/actions" method="post">
          <input type="hidden" name="action" value="settings-save" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              ["Posts per day", "posts_per_day", values.posts_per_day, "number"],
              ["Reuse cooldown hours", "reuse_cooldown_hours", values.reuse_cooldown_hours, "number"],
              ["Schedule horizon days", "schedule_horizon_days", values.schedule_horizon_days, "number"],
              ["Morning start", "morning_start", values.morning_start, "time"],
              ["Morning end", "morning_end", values.morning_end, "time"],
              ["Afternoon start", "afternoon_start", values.afternoon_start, "time"],
              ["Afternoon end", "afternoon_end", values.afternoon_end, "time"],
              ["Evening start", "evening_start", values.evening_start, "time"],
              ["Evening end", "evening_end", values.evening_end, "time"],
              ["Min stagger minutes", "min_stagger_minutes", values.min_stagger_minutes, "number"],
              ["Max stagger minutes", "max_stagger_minutes", values.max_stagger_minutes, "number"],
              ["Min minutes between posts", "min_minutes_between_posts", values.min_minutes_between_posts, "number"],
              ["Timezone", "timezone", values.timezone, "text"],
              ["Failure pause threshold", "failure_pause_threshold", values.failure_pause_threshold, "number"]
            ].map(([label, name, value, type]) => (
              <label key={String(name)} className="block">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</span>
                <input className="mt-2 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-white outline-none focus:border-mint/60" name={String(name)} type={String(type)} defaultValue={String(value)} />
              </label>
            ))}
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <h2 className="text-sm font-semibold text-white">Telegram notifications</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                ["Successful publications", "telegram_notify_published", values.telegram_notify_published],
                ["Terminal failures", "telegram_notify_failed", values.telegram_notify_failed],
                ["Daily summary", "telegram_daily_summary", values.telegram_daily_summary]
              ].map(([label, name, checked]) => (
                <label key={String(name)} className="flex items-center gap-3 rounded-md border border-line bg-ink p-3 text-sm text-white">
                  <input name={String(name)} type="checkbox" defaultChecked={Boolean(checked)} />
                  {String(label)}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <h2 className="text-sm font-semibold text-white">Real caption variables</h2>
            <p className="mt-1 text-sm text-muted">The scheduler stays idle until at least one real value is configured. Templates can use hook, body, cta, hashtags, and filename variables.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                ["Hook", "caption_hook", values.caption_hook],
                ["Body", "caption_body", values.caption_body],
                ["CTA", "caption_cta", values.caption_cta],
                ["Hashtags", "caption_hashtags", values.caption_hashtags]
              ].map(([label, name, value]) => (
                <label key={String(name)} className="block">
                  <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</span>
                  <textarea
                    className="mt-2 min-h-24 w-full resize-y rounded-md border border-line bg-ink px-3 py-2 text-sm text-white outline-none focus:border-mint/60"
                    name={String(name)}
                    defaultValue={String(value)}
                  />
                </label>
              ))}
            </div>
          </div>
          <button className="mt-5 rounded-md border border-line bg-panel2 px-3 py-2 text-sm font-medium text-white hover:border-mint/40" type="submit">
            <Save className="mr-2 inline h-4 w-4" />Save settings
          </button>
        </form>
      </Panel>
    </>
  );
}
