import type { SupabaseClient } from "@supabase/supabase-js";

export type CreditCard = {
  id: string;
  name: string;
  statement_day: number;
  payment_day: number;
  reminders_enabled: boolean;
};

// RLS (credit_cards_select_own) zaten çağıranın kendi kartlarına scope ediyor.
export async function getCreditCards(supabase: SupabaseClient): Promise<CreditCard[]> {
  const { data } = await supabase
    .from("credit_cards")
    .select("id, name, statement_day, payment_day, reminders_enabled")
    .order("created_at", { ascending: true });

  return (data as CreditCard[]) ?? [];
}
