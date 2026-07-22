import type { SupabaseClient } from "@supabase/supabase-js";

export type Category = { id: string; name: string };

// Shared by the /api/categories route (client SWR refetches) and the entry
// form's initial fallback fetch — mirrors src/lib/entries-data.ts's pattern.
// No explicit user_id filter — RLS (categories_select_own) already scopes
// this to the caller's own rows.
export async function getCategories(supabase: SupabaseClient): Promise<Category[]> {
  const { data } = await supabase
    .from("categories")
    .select("id, name")
    .order("created_at", { ascending: true });

  return (data as Category[]) ?? [];
}
