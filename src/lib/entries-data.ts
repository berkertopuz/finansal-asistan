import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry } from "@/lib/ledger";
import { materializeDueOccurrences } from "@/lib/recurrence-materialize";
import { getUser } from "@/lib/supabase/server";

// Shared by the /api/entries route (client SWR refetches) and every
// server-rendered Defter page (initial SWR fallbackData, so first paint
// skips the loading skeleton entirely). No explicit user_id filter — RLS
// (entries_select_own) already scopes this to the caller's own rows.
//
// materializeDueOccurrences runs first so this month's rows from any
// recurring template always exist before they're read — it's also called
// from the (app) layout (src/app/(app)/layout.tsx) so pages that read
// v_monthly_surplus directly (Ana Sayfa) without ever calling getEntries
// still see fresh data; both are cache()-wrapped per request (getUser in
// src/lib/supabase/server.ts, materializeDueOccurrences itself), so calling
// them again here within the same request/render pass is free, not a second
// round trip.
export async function getEntries(supabase: SupabaseClient): Promise<Entry[]> {
  const {
    data: { user },
  } = await getUser();
  if (user) {
    await materializeDueOccurrences(user.id);
  }

  const { data, error } = await supabase
    .from("entries")
    .select(
      "id, kind, amount, currency, category, description, recurrence, next_due_date, occurred_at, purchased_at, credit_card_id, group_id, created_at, template_id, portfolio_position_id, installment_group_id, installment_index, installment_count, skip_dates, original_amount, original_currency, fx_rate, fx_rate_date",
    )
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  // Hata SESSİZCE yutulmuyordu ve bu tehlikeliydi: select listesi ile şemanın
  // uyuşmadığı her durumda (ör. bir migration henüz uygulanmamışsa —
  // purchased_at eklenirken gerçekten yaşandı, "column entries.purchased_at
  // does not exist") bu fonksiyon boş dizi döndürüyor ve uygulama kullanıcıya
  // "hiç kaydın yok" gösteriyordu. Bir finans uygulamasında verinin
  // silinmiş görünmesi, hata görünmesinden çok daha kötü. Davranışı
  // (boş diziye düşmek) koruyoruz ki tek bir okuma hatası tüm sayfayı
  // çökertmesin, ama artık sunucu logunda gürültülü bir iz bırakıyor.
  if (error) {
    console.error("getEntries: entries select failed — kayıtlar BOŞ döndü", error);
  }

  return (data as Entry[]) ?? [];
}
