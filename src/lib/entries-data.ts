import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry } from "@/lib/ledger";
import { materializeDueOccurrences } from "@/lib/recurrence-materialize";
import { getUser } from "@/lib/supabase/server";

// Shared by the /api/entries route (client SWR refetches) and every
// server-rendered Defter page (initial SWR fallbackData, so first paint
// skips the loading skeleton entirely). No explicit user_id filter — RLS
// (entries_select_own) already scopes this to the caller's own rows.
//
// materializeDueOccurrences runs first so this month's rows from any
// recurring template always exist before they're read — it's also called
// from the (app) layout (src/app/(app)/layout.tsx) so pages that read
// v_monthly_surplus directly (Ana Sayfa) without ever calling getEntries
// still see fresh data; both are cache()-wrapped per request (getUser in
// src/lib/supabase/server.ts, materializeDueOccurrences itself), so calling
// them again here within the same request/render pass is free, not a second
// round trip.
export async function getEntries(supabase: SupabaseClient): Promise<Entry[]> {
  const {
    data: { user },
  } = await getUser();
  if (user) {
    await materializeDueOccurrences(user.id);
  }

  const { data } = await supabase
    .from("entries")
    .select(
      "id, kind, amount, currency, category, description, recurrence, next_due_date, occurred_at, credit_card_id, created_at, template_id, portfolio_position_id, installment_group_id, installment_index, installment_count",
    )
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  return (data as Entry[]) ?? [];
}
