import { clsx } from "clsx";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-mint">Internal automation</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{subtitle}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx("rounded-md border border-line bg-panel/86 shadow-glow", className)}>{children}</section>;
}

export function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail?: string; tone?: "neutral" | "good" | "warn" | "danger" }) {
  const tones = {
    neutral: "text-white",
    good: "text-mint",
    warn: "text-amber",
    danger: "text-danger"
  };
  return (
    <Panel className="p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={clsx("mt-3 text-3xl font-semibold", tones[tone])}>{value}</p>
      {detail ? <p className="mt-2 text-sm text-muted">{detail}</p> : null}
    </Panel>
  );
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const color = ["failed", "error", "not connected", "missing", "expired", "revoked", "not found"].some((value) => normalized.includes(value))
    ? "border-danger/30 bg-danger/10 text-danger"
    : normalized.includes("published") || normalized.includes("active") || normalized.includes("available") || normalized === "connected" || normalized.includes("configured")
      ? "border-mint/30 bg-mint/10 text-mint"
      : "border-amber/30 bg-amber/10 text-amber";
  return <span className={clsx("inline-flex rounded px-2 py-1 text-xs font-medium", color)}>{status.replace("_", " ")}</span>;
}

export function ActionButton({ children, action, danger = false }: { children: React.ReactNode; action: string; danger?: boolean }) {
  return (
    <form action="/api/actions" method="post">
      <input type="hidden" name="action" value={action} />
      <button
        className={clsx(
          "rounded-md border px-3 py-2 text-sm font-medium transition",
          danger ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20" : "border-line bg-panel2 text-white hover:border-mint/40"
        )}
        type="submit"
      >
        {children}
      </button>
    </form>
  );
}
