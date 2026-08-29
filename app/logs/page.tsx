import { formatDistanceToNow } from "date-fns";
import { ConfigurationWarning, EmptyState } from "@/components/empty-state";
import { PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardData } from "@/lib/data";

export default async function LogsPage() {
  const { logs, configured, error } = await getDashboardData();
  return (
    <>
      <PageHeader title="Logs" subtitle="Structured server events for imports, scheduling, publishing requests, retries, failures, and automatic pauses." />
      {!configured ? <ConfigurationWarning error={error} /> : null}
      <Panel className="overflow-hidden">
        <div className="grid gap-3 border-b border-line px-4 py-3 text-xs uppercase tracking-[0.12em] text-muted md:grid-cols-[150px_1fr_160px_120px_1.5fr]">
          <span>Timestamp</span><span>Video</span><span>Account</span><span>Status</span><span>Error</span>
        </div>
        <div className="divide-y divide-line">
          {logs.length ? logs.map((row: any) => (
            <div key={row.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[150px_1fr_160px_120px_1.5fr]">
              <span className="text-muted">{formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}</span>
              <span>{row.videos?.filename ?? "System"}</span>
              <span>{row.account_groups?.name ?? "-"}</span>
              <StatusPill status={row.status} />
              <span className="text-muted">{row.error ?? row.action}</span>
            </div>
          )) : (
            <div className="px-4 py-5">
              <EmptyState title="Aucun log" body="Les événements apparaîtront ici dès que Drive Sync, Scheduler ou Publisher exécuteront une action réelle." />
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
