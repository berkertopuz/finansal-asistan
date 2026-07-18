import { createBrowserClient } from "@supabase/ssr";

// For Client Components. Cookie sync with the server is handled automatically.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
