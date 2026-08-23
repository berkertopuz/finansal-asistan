import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { parseStatement } from "../_shared/statements/openai-client.ts";

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

    let statementMarkdown: string;
    try {
      const body = await req.json();
      statementMarkdown = typeof body.statementMarkdown === "string" ? body.statementMarkdown : "";
    } catch {
      return Response.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
    }

    if (!statementMarkdown.trim()) {
      return Response.json({ error: "Ekstre metni boş." }, { status: 400 });
    }

    try {
      const parsed = await parseStatement({
        apiKey: Deno.env.get("OPENAI_API_KEY")!,
        statementMarkdown,
      });
      return Response.json(parsed);
    } catch (err) {
      // Ham sağlayıcı hata metnini KULLANICIYA göndermiyoruz. Eskiden
      // `err.message` doğrudan döndürülüyor ve Next tarafı onu olduğu gibi
      // ekrana basıyordu — gerçek bir denemede kullanıcı Türkçe arayüzde
      // "429 You have no credits remaining. Add credits to continue using
      // the API at..." metnini gördü. Bu iki kuralı birden bozuyor:
      // CLAUDE.md kural 1 (kullanıcıya görünen metinler mesaj kataloğundan
      // gelir) ve sağlayıcı iç detayının arayüze sızmaması. Artık yalnızca
      // sabit bir kod dönüyor, ayrıntı fonksiyon loguna yazılıyor.
      console.error("parse-statement OpenAI çağrısı başarısız:", err);
      const status = (err as { status?: unknown })?.status;
      // 429 = kota/hız limiti. Ayrım kullanıcı için DEĞİL (anahtar bizim,
      // kullanıcının yapabileceği bir şey yok — CLAUDE.md kural 8) log ve
      // alarm için korunuyor: 429 bizim kapasite sorunumuz, llmFailed başka
      // bir arıza. Kullanıcıya iki durumda da sadece "birazdan tekrar dene"
      // deniyor.
      const code = status === 429 ? "quotaExceeded" : "llmFailed";
      return Response.json({ code }, { status: 502 });
    }
  }),
};
