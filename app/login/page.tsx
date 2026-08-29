import { LogIn } from "lucide-react";
import { redirect } from "next/navigation";
import { createAuthClient, getCurrentUser } from "@/lib/supabase/auth";

async function signIn(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const supabase = await createAuthClient();
  if (!supabase) redirect("/login?error=missing-config");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect(next.startsWith("/") ? next : "/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(params.next ?? "/");

  return (
    <main className="grid min-h-screen place-items-center px-5">
      <form action={signIn} className="w-full max-w-sm rounded-md border border-line bg-panel p-5 shadow-glow">
        <div className="mb-5">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-line bg-panel2 text-mint">
            <LogIn className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-white">Cocorise Auto Publisher</h1>
          <p className="mt-2 text-sm text-muted">Sign in with your Supabase Auth user.</p>
        </div>
        {params.error ? <p className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{decodeURIComponent(params.error)}</p> : null}
        <input type="hidden" name="next" value={params.next ?? "/"} />
        <label className="block text-sm text-muted">
          Email
          <input className="mt-2 w-full rounded-md border border-line bg-ink px-3 py-2 text-white outline-none focus:border-mint/60" name="email" type="email" required />
        </label>
        <label className="mt-4 block text-sm text-muted">
          Password
          <input className="mt-2 w-full rounded-md border border-line bg-ink px-3 py-2 text-white outline-none focus:border-mint/60" name="password" type="password" required />
        </label>
        <button className="mt-5 w-full rounded-md border border-line bg-panel2 px-3 py-2 text-sm font-medium text-white hover:border-mint/40" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}
