"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CATEGORY } from "@/lib/ledger";

const addEntrySchema = z.object({
  kind: z.enum(["income", "expense", "subscription"]),
  // Absurd-magnitude guard (docs/phase1-plan.md E.d) — the DB CHECK (amount > 0)
  // is the real backstop; this just gives a friendlier error before it gets there.
  amount: z.coerce
    .number()
    .positive({ message: "Tutar 0'dan büyük olmalı." })
    .max(10_000_000, { message: "Tutar çok yüksek görünüyor." }),
  category: z.string().trim().min(1).max(50).default(DEFAULT_CATEGORY),
  description: z
    .string()
    .trim()
    .max(200, { message: "Açıklama çok uzun." })
    .optional()
    .transform((val) => (val ? val : undefined)),
  recurrence: z.enum(["none", "weekly", "monthly", "yearly"]).default("none"),
});

export type AddEntryState = { error?: string; success?: boolean };

export async function addEntry(
  _prevState: AddEntryState,
  formData: FormData,
): Promise<AddEntryState> {
  const parsed = addEntrySchema.safeParse({
    kind: formData.get("kind"),
    amount: formData.get("amount"),
    category: formData.get("category") || DEFAULT_CATEGORY,
    description: formData.get("description") || undefined,
    recurrence: formData.get("recurrence") || "none",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Geçersiz bilgiler." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Oturum bulunamadı, tekrar giriş yap." };
  }

  const { error } = await supabase.from("entries").insert({
    user_id: user.id,
    kind: parsed.data.kind,
    amount: parsed.data.amount,
    category: parsed.data.category,
    description: parsed.data.description ?? null,
    recurrence: parsed.data.recurrence,
  });

  if (error) {
    return { error: "Kaydedilemedi, tekrar dene." };
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
