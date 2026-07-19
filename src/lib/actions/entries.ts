"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CATEGORY } from "@/lib/ledger";

export type AddEntryState = { error?: string; success?: boolean };

async function buildEntrySchema() {
  const t = await getTranslations("ledger.form.errors");
  return z.object({
    kind: z.enum(["income", "expense", "subscription"]),
    // Absurd-magnitude guard (docs/phase1-plan.md E.d) — the DB CHECK (amount > 0)
    // is the real backstop; this just gives a friendlier error before it gets there.
    amount: z.coerce
      .number()
      .positive({ message: t("amountPositive") })
      .max(10_000_000, { message: t("amountTooHigh") }),
    category: z.string().trim().min(1).max(50).default(DEFAULT_CATEGORY),
    description: z
      .string()
      .trim()
      .max(200, { message: t("descriptionTooLong") })
      .optional()
      .transform((val) => (val ? val : undefined)),
    recurrence: z.enum(["none", "weekly", "monthly", "yearly"]).default("none"),
    // Only meaningful when recurrence !== "none" (DB check
    // entries_next_due_date_only_when_recurring) — cleared below regardless
    // of what's submitted for a one-off entry.
    next_due_date: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined)),
  });
}

function normalizeNextDueDate(
  recurrence: "none" | "weekly" | "monthly" | "yearly",
  nextDueDate: string | undefined,
): string | null {
  return recurrence === "none" ? null : (nextDueDate ?? null);
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

  const { error } = await supabase.from("entries").insert({
    user_id: user.id,
    kind: parsed.data.kind,
    amount: parsed.data.amount,
    category: parsed.data.category,
    description: parsed.data.description ?? null,
    recurrence: parsed.data.recurrence,
    next_due_date: normalizeNextDueDate(parsed.data.recurrence, parsed.data.next_due_date),
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

  // No explicit .eq("user_id", ...) needed beyond RLS (entries_update_own)
  // scoping the update to the caller's own rows — matching this codebase's
  // established pattern (see deleteEntry below).
  const { error } = await supabase
    .from("entries")
    .update({
      kind: parsed.data.kind,
      amount: parsed.data.amount,
      category: parsed.data.category,
      description: parsed.data.description ?? null,
      recurrence: parsed.data.recurrence,
      next_due_date: normalizeNextDueDate(parsed.data.recurrence, parsed.data.next_due_date),
    })
    .eq("id", id);

  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true };
}

export async function deleteEntry(id: string) {
  const supabase = await createClient();
  // No explicit user_id check needed — RLS already scopes deletes to the
  // caller's own rows (entries_delete_own policy).
  await supabase.from("entries").delete().eq("id", id);
  revalidatePath("/defter");
  revalidatePath("/");
}
