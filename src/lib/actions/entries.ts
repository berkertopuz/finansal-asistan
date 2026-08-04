"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CATEGORY } from "@/lib/ledger";
import { buildInstallmentRows } from "@/lib/installments";

export type AddEntryState = { error?: string; success?: boolean };

// Local date, not toISOString().slice(0,10) — that reads UTC parts, which
// drifts a day off around midnight depending on the server's timezone.
function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function buildEntrySchema() {
  const t = await getTranslations("ledger.form.errors");
  return z
    .object({
      kind: z.enum(["income", "expense", "subscription"]),
      // Absurd-magnitude guard (docs/phase1-plan.md E.d) — the DB CHECK (amount > 0)
      // is the real backstop; this just gives a friendlier error before it gets there.
      amount: z.coerce
        .number()
        .positive({ message: t("amountPositive") })
        .max(10_000_000, { message: t("amountTooHigh") }),
      category: z.string().trim().min(1).max(50).default(DEFAULT_CATEGORY),
      // Only asked for one-off entries (the form hides this field entirely
      // for a recurring one — see next_due_date below) — required there via
      // superRefine, since it's the only date the user can set at all.
      occurred_at: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined)),
      description: z
        .string()
        .trim()
        .max(200, { message: t("descriptionTooLong") })
        .optional()
        .transform((val) => (val ? val : undefined)),
      recurrence: z.enum(["none", "weekly", "monthly", "yearly"]).default("none"),
      // The one date a recurring entry has — both the anchor every future
      // occurrence projects from (src/lib/recurrence.ts, src/lib/cashflow.ts)
      // and what's shown as "the" date for that row (src/lib/ledger.ts's
      // entryDisplayDate). Required via superRefine when recurring, since a
      // recurring entry with no anchor can't be projected forward at all.
      next_due_date: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined)),
      // Taksit sayısı — isInstallment kendisi zod'un dışında, ham FormData'dan
      // okunuyor (updateEntry'deki applyToAllOccurrences ile aynı desen),
      // çünkü z.coerce.boolean() "false" string'ini de truthy sayar. Bu alan
      // sadece isInstallment true iken addEntry içinde elle doğrulanır.
      installmentCount: z.coerce.number().int().min(2).max(36).optional(),
      // Ödeme yöntemi — boş değer "Nakit/Banka" demek (nakit çıkışı hemen
      // olur, bugünkü davranış); bir kart id'si ise o karta borç yazılır
      // (src/lib/cashflow.ts bunu nakitten hemen düşmez, bkz. isCardDebt).
      // "income" için formda hiç gösterilmiyor, boş geçilir.
      credit_card_id: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined)),
    })
    .superRefine((data, ctx) => {
      if (data.recurrence === "none" && !data.occurred_at) {
        ctx.addIssue({ code: "custom", path: ["occurred_at"], message: t("dateRequired") });
      }
      if (data.recurrence !== "none" && !data.next_due_date) {
        ctx.addIssue({ code: "custom", path: ["next_due_date"], message: t("dateRequired") });
      }
      // Abonelikler, bu alanı satırın başlığı olarak gösteriyor
      // (EntryTable titleField="description") — boş bir "abonelik" satırı
      // orada isimsiz görünürdü. Client zaten <input required> ile bunu
      // engelliyor, bu sunucu tarafındaki backstop.
      if (data.kind === "subscription" && !data.description) {
        ctx.addIssue({ code: "custom", path: ["description"], message: t("descriptionRequired") });
      }
    });
}

export async function addEntry(
  _prevState: AddEntryState,
  formData: FormData,
): Promise<AddEntryState> {
  const t = await getTranslations("ledger.form.errors");
  const schema = await buildEntrySchema();
  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    amount: formData.get("amount"),
    category: formData.get("category") || DEFAULT_CATEGORY,
    occurred_at: formData.get("occurred_at") || undefined,
    description: formData.get("description") || undefined,
    recurrence: formData.get("recurrence") || "none",
    next_due_date: formData.get("next_due_date") || undefined,
    installmentCount: formData.get("installmentCount") || undefined,
    credit_card_id: formData.get("credit_card_id") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const isRecurring = parsed.data.recurrence !== "none";
  const isInstallment = formData.get("isInstallment") === "true";
  // income can never carry a card (DB CHECK) — the form never shows the
  // selector for it, this is just the same server-side backstop pattern
  // already used elsewhere in this file.
  const creditCardId = parsed.data.kind === "income" ? null : (parsed.data.credit_card_id ?? null);

  // Taksit: bir şablon değil, toplamı ve sayısı baştan belli sabit bir seri —
  // tüm satırlar kayıt anında toplu insert edilir (src/lib/installments.ts),
  // recurrence-materialize.ts'in ay-ay üretimiyle karıştırılmamalı. QuickEntryForm
  // bu checkbox'ı sadece kind=expense && recurrence=none iken gösteriyor, ama
  // form dışından (elle FormData) gelebilecek tutarsız bir kombinasyona karşı
  // burada da doğrulanıyor.
  if (isInstallment) {
    if (parsed.data.kind !== "expense" || isRecurring || !parsed.data.installmentCount) {
      return { error: t("genericInvalid") };
    }

    const rows = buildInstallmentRows(
      parsed.data.amount,
      parsed.data.installmentCount,
      parsed.data.occurred_at!,
    );
    const installmentGroupId = crypto.randomUUID();

    const { error: installmentError } = await supabase.from("entries").insert(
      rows.map((row) => ({
        user_id: user.id,
        kind: "expense" as const,
        amount: row.amount,
        category: parsed.data.category,
        occurred_at: row.occurred_at,
        description: parsed.data.description ?? null,
        recurrence: "none" as const,
        installment_group_id: installmentGroupId,
        installment_index: row.index,
        installment_count: row.count,
        credit_card_id: creditCardId,
      })),
    );

    if (installmentError) {
      return { error: t("saveFailed") };
    }

    revalidatePath("/defter");
    revalidatePath("/");
    return { success: true };
  }

  const { error } = await supabase.from("entries").insert({
    user_id: user.id,
    kind: parsed.data.kind,
    amount: parsed.data.amount,
    category: parsed.data.category,
    // A brand-new recurring row has no user-chosen occurred_at (the field
    // isn't shown) — "today" just means "added to the ledger today", which
    // is true and doesn't affect anything: currentBalance() sums every row
    // once regardless of its date, and next_due_date alone drives every
    // future projection.
    occurred_at: isRecurring ? todayDateString() : parsed.data.occurred_at!,
    description: parsed.data.description ?? null,
    recurrence: parsed.data.recurrence,
    next_due_date: isRecurring ? parsed.data.next_due_date! : null,
    credit_card_id: creditCardId,
  });

  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true };
}

export async function updateEntry(
  _prevState: AddEntryState,
  formData: FormData,
): Promise<AddEntryState> {
  const t = await getTranslations("ledger.form.errors");
  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    return { error: t("notFound") };
  }

  const schema = await buildEntrySchema();
  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    amount: formData.get("amount"),
    category: formData.get("category") || DEFAULT_CATEGORY,
    occurred_at: formData.get("occurred_at") || undefined,
    description: formData.get("description") || undefined,
    recurrence: formData.get("recurrence") || "none",
    next_due_date: formData.get("next_due_date") || undefined,
    credit_card_id: formData.get("credit_card_id") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const isRecurring = parsed.data.recurrence !== "none";
  // Only meaningful when editing a recurring rule (template) — the edit
  // sheet asks the user to choose this via a confirmation dialog rather
  // than silently picking one (src/components/ledger/QuickEntryForm.tsx).
  const applyToAllOccurrences = formData.get("applyToAllOccurrences") === "true";
  // Same backstop as addEntry — income can never carry a card (DB CHECK).
  const creditCardId = parsed.data.kind === "income" ? null : (parsed.data.credit_card_id ?? null);

  // Read before the update below, which nulls this row's own template_id
  // once it turns recurring — need the *previous* value to know whether
  // it's currently a materialized occurrence of some other template.
  // next_due_date/recurrence are read too, to detect a schedule change on
  // a template edit (see the cleanup after the update below).
  const { data: rowBeforeUpdate } = await supabase
    .from("entries")
    .select("template_id, next_due_date, recurrence")
    .eq("id", id)
    .maybeSingle();
  const previousTemplateId = rowBeforeUpdate?.template_id ?? null;
  const scheduleChanged =
    isRecurring &&
    rowBeforeUpdate !== null &&
    (rowBeforeUpdate.next_due_date !== (parsed.data.next_due_date ?? null) ||
      rowBeforeUpdate.recurrence !== parsed.data.recurrence);

  // No explicit .eq("user_id", ...) needed beyond RLS (entries_update_own)
  // scoping the update to the caller's own rows — matching this codebase's
  // established pattern (see deleteEntry below).
  const { error } = await supabase
    .from("entries")
    .update({
      kind: parsed.data.kind,
      amount: parsed.data.amount,
      category: parsed.data.category,
      // Recurring entries don't show the occurred_at field, so there's
      // nothing submitted to update it with — omitting the key here (rather
      // than defaulting to today, like a brand-new row) leaves whatever was
      // already stored untouched instead of quietly overwriting it on every
      // edit.
      ...(isRecurring ? {} : { occurred_at: parsed.data.occurred_at! }),
      description: parsed.data.description ?? null,
      recurrence: parsed.data.recurrence,
      next_due_date: isRecurring ? parsed.data.next_due_date! : null,
      credit_card_id: creditCardId,
      // A row turning recurring becomes a template in its own right, which
      // can't also be a generated occurrence of another template — the DB
      // enforces this (entries_template_id_only_when_concrete: recurrence
      // <> 'none' requires template_id null). Without this, converting e.g.
      // a materialized "abonelik"-category charge (template_id already set
      // from whatever recurring rule produced it) into a new subscription
      // rule fails outright.
      ...(isRecurring ? { template_id: null } : {}),
      // Same idea for entries_installment_requires_expense_and_concrete:
      // a taksit row must stay kind='expense' and recurrence='none' as long
      // as it carries installment_group_id — converting it to another kind
      // or into a recurring rule has to detach it from that series first,
      // or the same constraint rejects the update.
      ...(parsed.data.kind !== "expense" || isRecurring
        ? { installment_group_id: null, installment_index: null, installment_count: null }
        : {}),
    })
    .eq("id", id);

  if (error) {
    return { error: t("saveFailed") };
  }

  // This row was a materialized occurrence of some other template and just
  // turned into a recurring rule of its own (the "kart harcamalarından"
  // charge → real subscription conversion, src/components/ledger/QuickEntryForm.tsx) —
  // the original template must stop generating too, or the same real-world
  // charge stays tracked twice forever (once via the old rule, once via
  // this new one). Deleted outright rather than left running: past rows it
  // already produced keep their own data regardless (ON DELETE SET NULL on
  // template_id), only future generation stops — the same effect as the
  // delete dialog's "Sadece gelecekte durdur" option.
  if (isRecurring && previousTemplateId) {
    const { error: stopError } = await supabase
      .from("entries")
      .delete()
      .eq("id", previousTemplateId);
    if (stopError) {
      console.error("updateEntry: failed to stop original template after conversion", stopError);
    }
  }

  // Bug: editing a template's own schedule (next_due_date and/or recurrence)
  // used to leave every already-materialized future row exactly where it
  // was — materializeDueOccurrences (src/lib/recurrence-materialize.ts)
  // then computed the NEW occurrence dates from the changed anchor and
  // inserted those too (its (template_id, occurred_at) unique constraint
  // only blocks re-inserting the *same* date, not the old ones), so the
  // rule ended up with two full sets of future rows — the stale old-pattern
  // ones and the fresh new-pattern ones. A schedule change is inherently
  // forward-looking (past rows already happened on their real dates, that
  // shouldn't get rewritten), so this always deletes future rows regardless
  // of applyToAllOccurrences — materializeDueOccurrences regenerates them
  // on the next fetch, already carrying this request's new field values too.
  if (scheduleChanged) {
    const { error: rescheduleError } = await supabase
      .from("entries")
      .delete()
      .eq("template_id", id)
      .gte("occurred_at", todayDateString());
    if (rescheduleError) {
      console.error("updateEntry: failed to clear stale occurrences after schedule change", rescheduleError);
    }
  }

  // Propagate to rows this template already generated (each keeps its own
  // occurred_at — only what the user actually edited here changes). Not
  // part of the same request's error path: the template itself already
  // saved successfully, so a failure here shouldn't read to the user as
  // "the edit failed".
  //
  // materializeDueOccurrences pre-generates FUTURE_HORIZON_YEARS of
  // occurrences as real rows (src/lib/recurrence-materialize.ts), so
  // "gelecek kayıtlar" (future records) already exist as concrete rows the
  // moment the template does — "Sadece gelecek kayıtlar" has to actively
  // update the not-yet-occurred ones (occurred_at >= today) rather than
  // leaving them stuck on the old value, while "Tüm kayıtlar (geçmiş
  // dahil)" still reaches every row regardless of date.
  if (isRecurring) {
    let cascadeQuery = supabase
      .from("entries")
      .update({
        kind: parsed.data.kind,
        amount: parsed.data.amount,
        category: parsed.data.category,
        description: parsed.data.description ?? null,
        // A card-tagged subscription's already-materialized future rows
        // need to follow if the user changes which card it's charged to
        // (or clears it back to nakit/banka) — otherwise src/lib/cashflow.ts's
        // creditCardDebtBalance and future-cycle projection would keep
        // reading the old card for months already generated before the edit.
        credit_card_id: creditCardId,
      })
      .eq("template_id", id);
    if (!applyToAllOccurrences) {
      cascadeQuery = cascadeQuery.gte("occurred_at", todayDateString());
    }
    const { error: cascadeError } = await cascadeQuery;
    if (cascadeError) {
      console.error("updateEntry: failed to propagate to generated rows", cascadeError);
    }
  }

  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true };
}

export async function deleteEntry(
  id: string,
  deleteGeneratedRows = false,
  deleteFutureInstallments = false,
) {
  const supabase = await createClient();
  // No explicit user_id check needed — RLS already scopes deletes to the
  // caller's own rows (entries_delete_own policy).
  //
  // deleteGeneratedRows is only meaningful when `id` is a recurring
  // template — the delete dialog asks the user to choose between stopping
  // future generation or wiping every row this template ever produced too.
  //
  // "Stopping future generation" used to be a no-op here (nothing had been
  // generated past the current month yet) — materializeDueOccurrences now
  // pre-generates FUTURE_HORIZON_YEARS ahead as real rows
  // (src/lib/recurrence-materialize.ts), so those not-yet-occurred rows
  // already exist and have to be actively removed, or they'd keep counting
  // as real future expenses/income even though the rule that produced them
  // no longer exists. Past rows are untouched either way — their
  // template_id just goes null via ON DELETE SET NULL below.
  if (deleteGeneratedRows) {
    await supabase.from("entries").delete().eq("template_id", id);
  } else {
    await supabase.from("entries").delete().eq("template_id", id).gte("occurred_at", todayDateString());
  }
  // deleteFutureInstallments is only meaningful when `id` is one row of a
  // taksit series — unlike deleteGeneratedRows above, this deliberately
  // never touches PAST installments (occurred_at <= this row's own date):
  // those months' money is already spent, deleting them would retroactively
  // rewrite history that already happened. Only this row and whatever's
  // still ahead of it get removed.
  if (deleteFutureInstallments) {
    const { data: row } = await supabase
      .from("entries")
      .select("installment_group_id, occurred_at")
      .eq("id", id)
      .maybeSingle();
    if (row?.installment_group_id) {
      await supabase
        .from("entries")
        .delete()
        .eq("installment_group_id", row.installment_group_id)
        .gt("occurred_at", row.occurred_at);
    }
  }

  // Deleting a single materialized occurrence (template_id set, this isn't
  // the deleteGeneratedRows path) would otherwise come back on the next
  // page load: materializeDueOccurrences (src/lib/recurrence-materialize.ts)
  // just sees an empty (template_id, occurred_at) slot and regenerates it.
  // Recording the date on the template's skip_dates is what makes a single
  // delete actually stick.
  if (!deleteGeneratedRows) {
    const { data: row } = await supabase
      .from("entries")
      .select("template_id, occurred_at")
      .eq("id", id)
      .maybeSingle();
    if (row?.template_id) {
      const { data: template } = await supabase
        .from("entries")
        .select("skip_dates")
        .eq("id", row.template_id)
        .maybeSingle();
      const skipDates = (template as { skip_dates: string[] } | null)?.skip_dates ?? [];
      if (!skipDates.includes(row.occurred_at)) {
        await supabase
          .from("entries")
          .update({ skip_dates: [...skipDates, row.occurred_at] })
          .eq("id", row.template_id);
      }
    }
  }

  await supabase.from("entries").delete().eq("id", id);
  revalidatePath("/defter");
  revalidatePath("/");
}
