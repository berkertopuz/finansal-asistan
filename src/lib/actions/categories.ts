"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Category } from "@/lib/categories-data";

export type CategoryActionState = { error?: string; success?: boolean; category?: Category };

// Called directly from client components (not a <form action>) — same
// pattern as deleteEntry in src/lib/actions/entries.ts. No revalidatePath:
// this data is never rendered by a server component, only ever read via
// SWR (/api/categories), so the caller mutate()s that key itself.
export async function addCategory(name: string): Promise<CategoryActionState> {
  const t = await getTranslations("ledger.categories.errors");
  const parsed = z
    .string()
    .trim()
    .min(1, { message: t("nameRequired") })
    .max(50, { message: t("nameTooLong") })
    .safeParse(name);

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

  const { data, error } = await supabase
    .from("categories")
    .insert({ user_id: user.id, name: parsed.data })
    .select("id, name")
    .single();

  if (error) {
    // unique (user_id, name) — the user already has this exact tag.
    if (error.code === "23505") {
      return { error: t("duplicate") };
    }
    return { error: t("saveFailed") };
  }

  return { success: true, category: data as Category };
}

export async function deleteCategory(id: string): Promise<void> {
  const supabase = await createClient();
  // No explicit user_id check needed — RLS (categories_delete_own) already
  // scopes this to the caller's own rows. Deleting a tag never touches
  // entries.category on any existing row (free text, no FK — see the
  // migration comment in
  // supabase/migrations/20260721130000_installments_and_categories.sql).
  await supabase.from("categories").delete().eq("id", id);
}
