import { redirect } from "next/navigation";
import { SerwistProvider } from "@serwist/turbopack/react";
import { getUser } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { materializeDueOccurrences } from "@/lib/recurrence-materialize";

// ZERO financial data can render below this gate (CLAUDE.md rule 3).
// getUser() is used, not getSession() — it revalidates the JWT against
// Supabase Auth instead of trusting the (spoofable) cookie contents. It's
// the cache()-wrapped helper (src/lib/supabase/server.ts) so this check and
// the page underneath it share one network round trip instead of two.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    data: { user },
  } = await getUser();

  if (!user) {
    redirect("/giris");
  }

  // Every authenticated page (not just Defter, which already triggers this
  // via getEntries) needs this month's recurring rows to exist before it
  // reads them — Ana Sayfa's SurplusCard queries v_monthly_surplus directly
  // without ever calling getEntries, so it would otherwise miss a template's
  // current-month row on a user who never visits Defter this month.
  await materializeDueOccurrences(user.id);

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
