import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recommendation } from "@/lib/recommendations";

// Shared by the /api/recommendations route (client SWR refetches) and the
// server-rendered /oneriler and home dashboard (initial SWR fallbackData,
// so first paint skips the loading skeleton entirely).
// No explicit user_id filter — RLS (recommendations_select_own) already
// scopes this to the caller's own rows, matching the rest of the codebase's
// pattern of relying on RLS rather than double-filtering in application code.
export async function getRecommendations(supabase: SupabaseClient): Promise<Recommendation[]> {
  const { data } = await supabase
    .from("recommendations")
    .select(
      "id, kind, asset_class, symbol, signal, confidence, body, locale, cited_headline, cited_url, event_id, created_at, expires_at",
    )
    .order("created_at", { ascending: false });

  return (data as Recommendation[]) ?? [];
}
