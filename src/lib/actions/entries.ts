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
    })
    .eq("id", id);

  if (error) {
    return { error: t("saveFailed") };
  }

  // Propagate to every row this template already generated (each keeps its
  // own occurred_at — only what the user actually edited here changes).
  // Not part of the same request's error path: the template itself already
  // saved successfully, so a failure here shouldn't read to the user as
  // "the edit failed".
  if (isRecurring && applyToAllOccurrences) {
    const { error: cascadeError } = await supabase
      .from("entries")
      .update({
        kind: parsed.data.kind,
        amount: parsed.data.amount,
        category: parsed.data.category,
        description: parsed.data.description ?? null,
      })
      .eq("template_id", id);
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
  // future generation (the default: template_id on already-generated rows
  // just goes null via ON DELETE SET NULL, history untouched) or wiping
  // every row this template ever produced too.
  if (deleteGeneratedRows) {
    await supabase.from("entries").delete().eq("template_id", id);
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
