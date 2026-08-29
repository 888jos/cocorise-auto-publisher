import { formatDistanceToNow } from "date-fns";
import { Power, RotateCcw } from "lucide-react";
import { ConfigurationWarning, EmptyState } from "@/components/empty-state";
import { PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardData } from "@/lib/data";

export default async function ContentPage() {
  const { videos, configured, error } = await getDashboardData();
  return (
    <>
      <PageHeader title="Content" subtitle="Imported Google Drive videos with usage history and eligibility controls." />
      {!configured ? <ConfigurationWarning error={error} /> : null}
      <Panel className="overflow-hidden">
        <div className="table-grid border-b border-line px-4 py-3 text-xs uppercase tracking-[0.12em] text-muted">
          <span>Video</span><span>Status</span><span>Times used</span><span>Last used</span><span>Imported</span><span>Controls</span>
        </div>
        <div className="divide-y divide-line">
          {videos.length ? videos.map((video) => (
            <div key={video.id} className="table-grid gap-3 px-4 py-3 text-sm">
              <span className="font-medium text-white">{video.filename}</span>
              <StatusPill status={video.status} />
              <span>{video.times_used}</span>
              <span className="text-muted">{video.last_used_at ? formatDistanceToNow(new Date(video.last_used_at), { addSuffix: true }) : "Never"}</span>
              <span className="text-muted">{formatDistanceToNow(new Date(video.imported_at), { addSuffix: true })}</span>
              <span className="flex gap-2">
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="video-status" />
                  <input type="hidden" name="id" value={video.id} />
                  <input type="hidden" name="status" value="disabled" />
                  <button className="rounded border border-line p-2 text-muted hover:text-white" title="Disable video" type="submit"><Power className="h-4 w-4" /></button>
                </form>
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="video-status" />
                  <input type="hidden" name="id" value={video.id} />
                  <input type="hidden" name="status" value="available" />
                  <button className="rounded border border-line p-2 text-muted hover:text-white" title="Enable video" type="submit"><RotateCcw className="h-4 w-4" /></button>
                </form>
              </span>
            </div>
          )) : (
            <div className="px-4 py-5">
              <EmptyState title="Aucune vidéo importée" body="Quand Drive Sync détecte des vidéos dans READY, elles apparaissent ici avec leur empreinte de fichier et leur statut réel." />
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
