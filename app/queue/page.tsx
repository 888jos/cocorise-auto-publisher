import { format } from "date-fns";
import { CalendarClock, Shuffle, XCircle } from "lucide-react";
import { ConfigurationWarning, EmptyState } from "@/components/empty-state";
import { PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardData } from "@/lib/data";

export default async function QueuePage() {
  const { publications, accounts, videos, configured, error } = await getDashboardData();
  return (
    <>
      <PageHeader title="Queue" subtitle="Upcoming and in-flight publications. Each row is locked to a final caption and idempotency key once scheduled." />
      {!configured ? <ConfigurationWarning error={error} /> : null}
      <Panel className="mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          {["Account", "Date", "Status", "Video"].map((label) => <input key={label} className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" placeholder={label} />)}
        </div>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="divide-y divide-line">
          {publications.length ? publications.map((publication) => (
            <div key={publication.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[150px_1fr_150px_120px_130px] lg:items-center">
              <span>{format(new Date(publication.scheduled_at), "MMM d, HH:mm")}</span>
              <span className="text-muted">{videos.find((video) => video.id === publication.video_id)?.filename}</span>
              <span>{accounts.find((account) => account.id === publication.account_group_id)?.name}</span>
              <span>
                <StatusPill status={publication.status} />
                {publication.provider_status ? <span className="mt-1 block text-[11px] text-muted">{publication.provider_status}</span> : null}
              </span>
              <span className="flex flex-wrap gap-2">
                {["queued", "scheduled", "failed"].includes(publication.status) || Boolean(publication.provider_job_id) ? (
                  <form action="/api/actions" method="post">
                    <input type="hidden" name="action" value="cancel-publication" />
                    <input type="hidden" name="id" value={publication.id} />
                    <button className="rounded border border-line p-2 text-muted hover:text-white" title="Cancel" type="submit"><XCircle className="h-4 w-4" /></button>
                  </form>
                ) : null}
                {["queued", "scheduled", "failed"].includes(publication.status) || Boolean(publication.provider_job_id) ? (
                  <form action="/api/actions" method="post" className="flex gap-2">
                    <input type="hidden" name="action" value="reschedule-publication" />
                    <input type="hidden" name="id" value={publication.id} />
                    <input className="w-36 rounded border border-line bg-ink px-2 py-1 text-xs text-muted" name="scheduled_at" type="datetime-local" title="New scheduled time" required />
                    <button className="rounded border border-line p-2 text-muted hover:text-white" title="Reschedule" type="submit"><CalendarClock className="h-4 w-4" /></button>
                  </form>
                ) : null}
                {publication.status === "failed" ? (
                  <form action="/api/actions" method="post">
                    <input type="hidden" name="action" value="retry-publication" />
                    <input type="hidden" name="id" value={publication.id} />
                    <button className="rounded border border-line p-2 text-muted hover:text-white" title="Retry failed publication" type="submit"><Shuffle className="h-4 w-4" /></button>
                  </form>
                ) : null}
              </span>
            </div>
          )) : (
            <div className="px-4 py-5">
              <EmptyState title="Queue vide" body="Aucune publication n'est planifiée tant que des comptes actifs, des vidéos disponibles et des templates de caption ne sont pas présents en base." />
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
