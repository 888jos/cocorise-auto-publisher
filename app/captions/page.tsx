import { Pencil, Plus, Power, Save } from "lucide-react";
import { ConfigurationWarning, EmptyState } from "@/components/empty-state";
import { PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardData } from "@/lib/data";

export default async function CaptionsPage() {
  const { captions, configured, error } = await getDashboardData();
  return (
    <>
      <PageHeader title="Captions" subtitle="Manual caption templates with weighted rotation and platform targeting. AI can be added later behind the same service boundary." />
      {!configured ? <ConfigurationWarning error={error} /> : null}
      <Panel className="mb-5 p-4">
        <form action="/api/actions" method="post" className="grid gap-3 lg:grid-cols-[180px_1fr_120px_120px_auto]">
          <input type="hidden" name="action" value="caption-create" />
          <input className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" name="name" placeholder="Style name" required />
          <input className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" name="template" placeholder="{{hook}} {{body}} {{cta}} {{hashtags}}" required />
          <select className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" name="platform" defaultValue="all">
            <option value="all">all</option>
            <option value="tiktok">tiktok</option>
            <option value="instagram">instagram</option>
            <option value="youtube">youtube</option>
          </select>
          <input className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" name="weight" type="number" min="1" defaultValue="1" />
          <button className="rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-white hover:border-mint/40" type="submit">
            <Plus className="mr-2 inline h-4 w-4" />Create
          </button>
        </form>
      </Panel>
      {!captions.length ? (
        <EmptyState title="Aucun template actif" body="Ajoute un template basé uniquement sur tes textes réels. Tant qu'il n'y en a aucun, le scheduler ne crée aucune publication." />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {captions.map((caption) => (
          <Panel key={caption.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{caption.name}</h2>
                <p className="mt-1 text-xs text-muted">Weight {caption.weight} · Platform {caption.platform}</p>
              </div>
              <StatusPill status={caption.active ? "active" : "disabled"} />
            </div>
            <pre className="mt-4 whitespace-pre-wrap rounded-md border border-line bg-ink p-3 text-sm leading-6 text-muted">{caption.template}</pre>
            <div className="mt-4 flex flex-wrap items-start gap-2">
              <details className="group flex-1">
                <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-white hover:border-mint/40">
                  <Pencil className="h-4 w-4" /> Edit
                </summary>
                <form action="/api/actions" method="post" className="mt-3 grid gap-3 rounded-md border border-line bg-ink p-3">
                  <input type="hidden" name="action" value="caption-update" />
                  <input type="hidden" name="id" value={caption.id} />
                  <label className="grid gap-1.5 text-xs text-muted">
                    Name
                    <input className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-white outline-none focus:border-mint/60" name="name" defaultValue={caption.name} required />
                  </label>
                  <label className="grid gap-1.5 text-xs text-muted">
                    Caption
                    <textarea className="min-h-28 resize-y rounded-md border border-line bg-panel px-3 py-2 text-sm leading-6 text-white outline-none focus:border-mint/60" name="template" defaultValue={caption.template} required />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs text-muted">
                      Platform
                      <select className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-white outline-none focus:border-mint/60" name="platform" defaultValue={caption.platform}>
                        <option value="all">all</option>
                        <option value="tiktok">tiktok</option>
                        <option value="instagram">instagram</option>
                        <option value="youtube">youtube</option>
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs text-muted">
                      Weight
                      <input className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-white outline-none focus:border-mint/60" name="weight" type="number" min="1" defaultValue={caption.weight} required />
                    </label>
                  </div>
                  <button className="inline-flex w-fit items-center gap-2 rounded-md border border-mint/30 bg-mint/5 px-3 py-2 text-sm font-medium text-mint hover:bg-mint/10" type="submit">
                    <Save className="h-4 w-4" /> Save
                  </button>
                </form>
              </details>
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="caption-active" />
                <input type="hidden" name="id" value={caption.id} />
                <input type="hidden" name="active" value={caption.active ? "false" : "true"} />
                <button className="rounded border border-line p-2 text-muted hover:text-white" title={caption.active ? "Disable" : "Enable"} type="submit"><Power className="h-4 w-4" /></button>
              </form>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
