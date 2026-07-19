import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry } from "@/lib/ledger";

// Shared by the /api/entries route (client SWR refetches) and every
// server-rendered Defter page (initial SWR fallbackData, so first paint
// skips the loading skeleton entirely). No explicit user_id filter — RLS
// (entries_select_own) already scopes this to the caller's own rows.
export async function getEntries(supabase: SupabaseClient): Promise<Entry[]> {
  const { data } = await supabase
    .from("entries")
    .select(
      "id, kind, amount, currency, category, description, recurrence, next_due_date, occurred_at, created_at",
    )
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  return (data as Entry[]) ?? [];
}
