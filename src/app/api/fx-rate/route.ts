import { createClient } from "@/lib/supabase/server";
import { fetchFxRate } from "@/lib/providers/tcmb-fx";

// Bir işlem tarihinin TCMB kuru. Form, kullanıcı para birimi/tarih
// değiştirdiğinde buraya soruyor ve gelen kuru DÜZENLENEBİLİR bir alana
// yazıyor — bankanın kestiği gerçek kur TCMB'den farklı (üstüne komisyon
// biniyor), o yüzden otomatik değer bir başlangıç noktası, son söz değil.
//
// Kur bulunamazsa null dönüyor; form o zaman kullanıcıdan TL tutarını
// istiyor. Tahmini kur üretilmiyor (CLAUDE.md kural 5).
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Kur verisi kullanıcıya özel değil ama endpoint'i açık bırakmanın da bir
  // gerekçesi yok — oturum kontrolü diğer /api rotalarıyla aynı.
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const currency = searchParams.get("currency") ?? "";
  const date = searchParams.get("date") ?? "";

  const rate = await fetchFxRate(currency, date);
  return Response.json({ rate });
}
