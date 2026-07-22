import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { parseStatementTransactions } from "../_shared/statements/openai-client.ts";

// src/app/api/statements/parse/route.ts'in ucu — refresh-recommendations ile
// aynı desen: auth:["user"] çağıranın kendi oturum JWT'sini sunmasını
// zorunlu kılar, ama bu fonksiyon zaten hiçbir kullanıcıya özel veriyi
// (entries, credit_cards) okumuyor/yazmıyor — sadece kendisine verilen
// (zaten PII'siz) işlem metnini OpenAI'a gönderip yapılandırılmış JSON
// olarak döndürüyor. Auth'un asıl amacı: bu fonksiyonun anonim/scriptli
// çağrılara açık kalmaması (OpenAI çağrısı ücretli).
export default {
  fetch: withSupabase({ auth: ["user"], cors: "disabled" }, async (req, ctx) => {
    if (!ctx.userClaims?.id) {
      return Response.json({ error: "Oturum doğrulanamadı." }, { status: 401 });
    }

    let transactionText: string;
    try {
      const body = await req.json();
      transactionText = typeof body.transactionText === "string" ? body.transactionText : "";
    } catch {
      return Response.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
    }

    if (!transactionText.trim()) {
      return Response.json({ error: "İşlem metni boş." }, { status: 400 });
    }

    try {
      const rows = await parseStatementTransactions({
        apiKey: Deno.env.get("OPENAI_API_KEY")!,
        transactionText,
      });
      return Response.json({ islemler: rows });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }),
};
