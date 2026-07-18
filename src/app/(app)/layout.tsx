import { redirect } from "next/navigation";
import { SerwistProvider } from "@serwist/turbopack/react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

// ZERO financial data can render below this gate (CLAUDE.md rule 3).
// getUser() is used, not getSession() — it revalidates the JWT against
// Supabase Auth instead of trusting the (spoofable) cookie contents.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/giris");
  }

  return (
    // Scoped to the authenticated app, not the root layout — /giris,
    // /kayit etc. don't register a service worker (no offline data to
    // serve there) and skip its JS entirely (measured ~2s of simulated
    // mobile LCP delay from this alone on those pages).
    // Disabled in dev: defaultCache is NetworkOnly outside production
    // anyway, and registering a SW during `next dev` risks it
    // intercepting Turbopack's HMR requests.
    <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV === "development"}>
      <AppShell>{children}</AppShell>
    </SerwistProvider>
  );
}
