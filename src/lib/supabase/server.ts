import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// One client per request — never share across requests (Supabase SSR guide).
// Use in Server Components, Server Actions and Route Handlers.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render, which can't set cookies.
            // Harmless as long as src/proxy.ts is refreshing the session on
            // every request — see that file for why it must not be removed.
          }
        },
      },
    },
  );
}

// getUser() is network-validated (revalidates the JWT against Supabase Auth,
// unlike the spoofable cookie-only getSession() — CLAUDE.md rule 3), so each
// call is a real round trip. The (app) layout, every page under it, and
// getEntries()/materializeDueOccurrences all used to call it independently —
// up to 4 serial round trips for a single navigation. react's cache()
// memoizes this per request/render pass, so all of those collapse into one
// actual network call; it does NOT persist across separate navigations or
// requests, so the security guarantee (every request re-validated) is
// unchanged.
export const getUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});
