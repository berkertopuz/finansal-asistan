import { cache } from "react";
import type { Entry } from "@/lib/ledger";
import { toDateString } from "@/lib/ledger";
import { occurrencesInRange } from "@/lib/cashflow";
import { createClient } from "@/lib/supabase/server";

type TemplateRow = Pick<
  Entry,
  | "id"
  | "kind"
  | "amount"
  | "currency"
  | "category"
  | "description"
  | "recurrence"
  | "next_due_date"
  | "occurred_at"
> & { skip_dates: string[] };

// How far ahead a template's occurrences get pre-generated as real rows —
// far enough that a user planning a couple years out already sees them,
// without generating an unbounded/"sonsuz" number of rows per template.
// updateEntry's edit-scope cascade and deleteEntry's "stop future
// generation" path both key off "today" for exactly this reason: with a
// multi-year horizon, "future" rows already exist as concrete entries the
// moment the template does, so editing/stopping "only going forward" has
// to actively touch/remove already-materialized rows dated today or later
// (src/lib/actions/entries.ts), not just skip generating new ones.
const FUTURE_HORIZON_YEARS = 2;

// A "template" is just an entries row with recurrence <> 'none' — this
// generates the real, independent per-period rows it's due for (kind='kira'
// this month, next month, etc.), each stamped with template_id so a later
// edit or delete of the template never reaches back into rows it already
// generated (see the migration's ON DELETE SET NULL + the bug this whole
// model replaces: a single eternal row that any edit/delete changed
// retroactively for every past month too).
//
// Wrapped in cache() and creates its own client rather than taking one as a
// param — it's called once from the (app) layout on every navigation and
// again from getEntries() on Defter; within a single request those used to
// run twice serially. Keying cache() on the (object) supabase client a
// caller happened to construct wouldn't dedupe (different instances break
// memoization), so this takes only the primitive userId and makes its own
// client — any client built from the same request's cookies sees the same
// session, so which instance runs the query doesn't matter.
export const materializeDueOccurrences = cache(async (userId: string): Promise<void> => {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("entries")
    .select(
      "id, kind, amount, currency, category, description, recurrence, next_due_date, occurred_at, skip_dates",
    )
    .neq("recurrence", "none");

  if (!templates || templates.length === 0) return;

  const today = new Date();
  // The lower bound is always the *start of the current* month, never the
  // template's own occurred_at — no backfilling. A template added (or
  // converted) today only ever generates from today's month forward; it
  // doesn't reconstruct months that already passed before it existed as a
  // rule. occurrencesInRange's first candidate is computed relative to
  // rangeStart, and nextOccurrenceOnOrAfter treats any anchor day-of-month
  // before that reference day as "already passed" and rolls it to the
  // following month — truncating to the 1st (not today's exact day) is what
  // keeps a bill due on, say, the 15th from being skipped straight to next
  // month when today is the 20th.
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const rangeEnd = new Date(today.getFullYear() + FUTURE_HORIZON_YEARS, today.getMonth() + 1, 0);

  const rows: Record<string, unknown>[] = [];
  for (const tpl of templates as TemplateRow[]) {
    if (!tpl.next_due_date) continue;
    const occurrences = occurrencesInRange(tpl.next_due_date, tpl.recurrence, rangeStart, rangeEnd);
    const skipDates = new Set(tpl.skip_dates ?? []);
    for (const occurrence of occurrences) {
      // The user explicitly deleted this occurrence before (deleteEntry
      // records it here) — without this check, the next materialize pass
      // would see the (template_id, occurred_at) slot empty again and
      // silently recreate the very row they deleted.
      if (skipDates.has(toDateString(occurrence))) continue;
      rows.push({
        user_id: userId,
        kind: tpl.kind,
        amount: tpl.amount,
        currency: tpl.currency,
        category: tpl.category,
        description: tpl.description,
        recurrence: "none",
        next_due_date: null,
        occurred_at: toDateString(occurrence),
        template_id: tpl.id,
      });
    }
  }

  if (rows.length === 0) return;

  // ignoreDuplicates relies on the unique index on (template_id,
  // occurred_at) — this runs on every entries fetch, so it must be a no-op
  // once a period's row already exists.
  const { error } = await supabase
    .from("entries")
    .upsert(rows, { onConflict: "template_id,occurred_at", ignoreDuplicates: true });

  // Best-effort background step, not something a page load should ever
  // fail on — but a silent failure here means a recurring item quietly
  // stops showing up, which is worth a server log to notice.
  if (error) {
    console.error("materializeDueOccurrences upsert failed", error);
  }
});
