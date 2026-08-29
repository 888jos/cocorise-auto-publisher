import { Database } from "lucide-react";
import { Panel } from "@/components/ui";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Panel className="p-6 text-center">
      <Database className="mx-auto h-8 w-8 text-muted" />
      <h2 className="mt-4 text-sm font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{body}</p>
    </Panel>
  );
}

export function ConfigurationWarning({ error }: { error: string | null }) {
  return (
    <Panel className="mb-5 border-amber/30 bg-amber/10 p-4 text-sm text-amber">
      Supabase n'est pas encore connecté. Renseigne `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, puis applique la migration.
      {error ? <span className="mt-2 block text-amber/80">{error}</span> : null}
    </Panel>
  );
}
