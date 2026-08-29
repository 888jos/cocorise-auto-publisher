import { format } from "date-fns";
import { AlertTriangle, PauseCircle, PlayCircle, RefreshCw, Send, Wand2 } from "lucide-react";
import { ConfigurationWarning, EmptyState } from "@/components/empty-state";
import { ActionButton, Metric, PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardData } from "@/lib/data";

export default async function DashboardPage() {
  const { videos, accounts, publications, configured, error } = await getDashboardData();
  const today = new Date().toISOString().slice(0, 10);
  const available = videos.filter((video) => video.status === "available").length;
  const activeAccounts = accounts.filter((account) => account.active).length;
  const scheduledToday = publications.filter((publication) => publication.scheduled_at.startsWith(today)).length;
  const publishedToday = publications.filter((publication) => publication.published_at?.startsWith(today)).length;
  const failed = publications.filter((publication) => publication.status === "failed").length;
  const postsPerDay = accounts.reduce((sum, account) => sum + (account.active ? account.posts_per_day : 0), 0) || 1;
  const runway = postsPerDay === 0 || available === 0 ? 0 : Math.floor((available * Math.max(1, activeAccounts)) / postsPerDay);
  const next = publications.filter((publication) => ["queued", "scheduled", "processing"].includes(publication.status)).slice(0, 8);

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
                <span className="text-white">{format(new Date(publication.scheduled_at), "MMM d, HH:mm")}</span>
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
