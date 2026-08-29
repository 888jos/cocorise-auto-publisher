import type { Metadata } from "next";
import { redirect } from "next/navigation";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { createAuthClient } from "@/lib/supabase/auth";

export const metadata: Metadata = {
  title: "Cocorise Auto Publisher",
  description: "Internal automation dashboard for Cocorise short-form publishing."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  async function signOut() {
    "use server";

    const supabase = await createAuthClient();
    await supabase?.auth.signOut();
    redirect("/login");
  }

  return (
    <html lang="en">
      <body>
        <AppShell signOutAction={signOut}>{children}</AppShell>
      </body>
    </html>
  );
}
