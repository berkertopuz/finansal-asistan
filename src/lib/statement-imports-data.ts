import type { SupabaseClient } from "@supabase/supabase-js";

export type StatementImport = {
  id: string;
  credit_card_id: string;
  statement_date: string;
  payment_due_date: string | null;
  imported_count: number;
  imported_total: number;
  created_at: string;
};

// RLS (statement_imports_select_own) zaten çağıranın kendi kayıtlarına
// scope ediyor — cardId verilirse tek bir kartın geçmişine daraltır
// (StatementUploadSheet.tsx'in mükerrer kontrolü hep tüm listeye bakar,
// CreditCardsManager.tsx'in geçmiş dialoğu client-side aynı listeyi
// credit_card_id'ye göre filtreler — ikisi de aynı SWR key'i paylaşıyor,
// bu yüzden burada opsiyonel bir filtre yeterli, ayrı bir endpoint gerekmiyor).
export async function getStatementImports(
  supabase: SupabaseClient,
  cardId?: string,
): Promise<StatementImport[]> {
  let query = supabase
    .from("statement_imports")
    .select("id, credit_card_id, statement_date, payment_due_date, imported_count, imported_total, created_at")
    .order("statement_date", { ascending: false });
  if (cardId) query = query.eq("credit_card_id", cardId);

  const { data } = await query;
  return (data as StatementImport[]) ?? [];
}
