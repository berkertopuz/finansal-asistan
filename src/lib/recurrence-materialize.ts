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
>;

// A "template" is just an entries row with recurrence <> 'none' — this
// generates the real, independent per-period rows it's due for (kind='kira'
// this month, next month, etc.), each stamped with template_id so a later
// edit or delete of the template never reaches back into rows it already
// generated (see the migration's ON DELETE SET NULL + the bug this whole
// model replaces: a single eternal row that any edit/delete changed
// retroactively for every past month too).
//
// Horizon stops at the end of *this* month, not further ahead. If next
// month were pre-generated, editing the template today would leave that
// already-materialized future row silently stuck on the old amount —
// capping at "this month" means an edit to the template always lands on a
// period that doesn't exist as a row yet.
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
      "id, kind, amount, currency, category, description, recurrence, next_due_date, occurred_at",
    )
    .neq("recurrence", "none");

  if (!templates || templates.length === 0) return;

  const today = new Date();
  const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const rows: Record<string, unknown>[] = [];
  for (const tpl of templates as TemplateRow[]) {
    if (!tpl.next_due_date) continue;
    // The lower bound is always the *start* of the month the template was
    // added in, never the exact day — occurrencesInRange's first candidate
    // is computed relative to rangeStart, and nextOccurrenceOnOrAfter treats
    // any anchor day-of-month before that reference day as "already passed"
    // and rolls it to the following month. Using the literal occurred_at
    // (e.g. the 21st) as rangeStart meant a bill due on the 15th — already
    // paid this month, which is exactly why the user is recording it —
    // silently skipped straight to next month. Truncating to the 1st keeps
    // this working the same way even after a gap: if occurred_at is from
    // three months ago and the user only opens the app again today,
    // rangeStart still lands on THAT month's 1st, not "the 21st of three
    // months ago", so the very first catch-up month isn't skipped either.
    const occurredAt = new Date(`${tpl.occurred_at}T00:00:00`);
    const rangeStart = new Date(occurredAt.getFullYear(), occurredAt.getMonth(), 1);
    const occurrences = occurrencesInRange(tpl.next_due_date, tpl.recurrence, rangeStart, rangeEnd);
    for (const occurrence of occurrences) {
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
