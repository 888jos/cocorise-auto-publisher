"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Captions, FileVideo, ListChecks, LogOut, Settings, TerminalSquare, Users } from "lucide-react";

const nav: Array<{ href: Route; label: string; icon: typeof BarChart3 }> = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/content", label: "Content", icon: FileVideo },
  { href: "/queue", label: "Queue", icon: ListChecks },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/captions", label: "Captions", icon: Captions },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/logs", label: "Logs", icon: TerminalSquare }
];

export function AppShell({ children, signOutAction }: { children: React.ReactNode; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  if (pathname === "/login") return children;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-ink/80 px-4 py-4 backdrop-blur lg:min-h-screen lg:border-b-0 lg:border-r">
        <Link href="/" className="flex items-center gap-3 px-2 py-2">
          <span className="grid h-9 w-9 place-items-center rounded-md border border-line bg-panel2 text-sm font-semibold text-mint">C</span>
          <span>
            <span className="block text-sm font-semibold">Cocorise</span>
            <span className="block text-xs text-muted">Auto Publisher</span>
          </span>
        </Link>
        <nav className="mt-6 flex gap-1 overflow-x-auto lg:block lg:space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-max items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                pathname === item.href ? "bg-panel2 text-white" : "text-muted hover:bg-panel2 hover:text-white"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={signOutAction} className="mt-6">
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-panel2 hover:text-white" type="submit">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </aside>
      <main className="px-5 py-6 sm:px-8 lg:px-10">{children}</main>
    </div>
  );
}
