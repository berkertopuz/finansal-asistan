import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  transcribeEntry,
  VoiceQuotaError,
  VoiceOverloadedError,
  VoiceUpstreamError,
} from "../_shared/voice/gemini-client.ts";
import { localeFromProfile } from "../_shared/locale.ts";

// src/app/api/voice/route.ts'in ucu — parse-statement ile birebir aynı desen:
// auth:["user"] çağıranın kendi oturum JWT'sini sunmasını zorunlu kılar, ama
// bu fonksiyon da hiçbir kullanıcıya özel veriyi okumuyor/yazmıyor. Kendisine
// verilen ses kaydını Gemini'ye gönderip yapılandırılmış taslağı döndürüyor,
// o kadar. Auth'un asıl amacı bu ücretli çağrının anonim/scriptli isteklere
// açık kalmaması. Rıza kontrolü ve bağlam toplama (kategoriler, tarih, locale)
// güven sınırının Next tarafında — parse-statement'ta PII temizliğinin orada
// olmasıyla aynı gerekçe.
//
// Ses kaydı hiçbir zaman diske/Storage'a yazılmıyor: bellekte işlenip atılıyor
// (KVKK veri minimizasyonu, ekstre hattıyla aynı kural).

// Gemini'nin kabul ettiği ses türleri. webm KASITLI olarak listede yok —
// Gemini onu reddediyor, bu yüzden client kaydı göndermeden önce WAV'a
// çeviriyor (bkz. src/components/ledger/useVoiceRecorder.ts). Buradaki
// whitelist o dönüşümün sessizce bozulmasına karşı bir ağ.
const ALLOWED_MIME_TYPES = new Set([
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

// ~30 sn'lik 16 kHz mono WAV yaklaşık 1 MB; base64 ile ~1.3 MB. 8 MB, uzun
// bir kaydın bile rahat sığdığı ama Gemini'nin 20 MB istek sınırına ve
// faturaya çarpmadan önce duran bir üst sınır.
const MAX_AUDIO_BASE64_BYTES = 8 * 1024 * 1024;

export default {
  fetch: withSupabase({ auth: ["user"], cors: "disabled" }, async (req, ctx) => {
    if (!ctx.userClaims?.id) {
      return Response.json({ error: "Oturum doğrulanamadı." }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
    }

    const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    const audioMimeType = typeof body.audioMimeType === "string" ? body.audioMimeType : "";
    const todayDate = typeof body.todayDate === "string" ? body.todayDate : "";
    const todayWeekday = typeof body.todayWeekday === "string" ? body.todayWeekday : "";
    const locale = localeFromProfile(typeof body.locale === "string" ? body.locale : null);
    const categories = Array.isArray(body.categories)
      ? body.categories.filter((c): c is string => typeof c === "string" && c.length > 0)
      : [];
    // Kullanıcının kart adları — kategoriler gibi istek anında enjekte
    // ediliyor, model "kredi kartı" duyduğunda bu listeden seçiyor.
    const cardNames = Array.isArray(body.cardNames)
      ? body.cardNames.filter((c): c is string => typeof c === "string" && c.length > 0)
      : [];

    if (!audioBase64) {
      return Response.json({ error: "Ses kaydı boş." }, { status: 400 });
    }
    if (audioBase64.length > MAX_AUDIO_BASE64_BYTES) {
      return Response.json({ error: "Ses kaydı çok büyük." }, { status: 413 });
    }
    if (!ALLOWED_MIME_TYPES.has(audioMimeType)) {
      return Response.json({ error: "Desteklenmeyen ses biçimi." }, { status: 400 });
    }
    // Tarih ve kategori listesi modelin uydurmasını engelleyen iki bağlam
    // parçası; ikisi de eksikse çağrı yapmanın anlamı yok (tarih olmadan
    // "dün" çözülemez, liste olmadan kategori uydurulur).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayDate) || categories.length === 0) {
      return Response.json({ error: "Eksik bağlam." }, { status: 400 });
    }

    try {
      const draft = await transcribeEntry({
        apiKey: Deno.env.get("GEMINI_API_KEY")!,
        model: Deno.env.get("GEMINI_VOICE_MODEL") ?? undefined,
        fallbackModel: Deno.env.get("GEMINI_VOICE_FALLBACK_MODEL") ?? undefined,
        audioBase64,
        audioMimeType,
        todayDate,
        todayWeekday,
        categories,
        cardNames,
        locale,
      });
      return Response.json(draft);
    } catch (err) {
      // parse-statement'ta öğrenilen ders: ham sağlayıcı hata metni ASLA
      // kullanıcıya gitmiyor (orada kullanıcı Türkçe arayüzde İngilizce bir
      // OpenAI kota hatası görmüştü). Yalnızca sabit bir kod dönüyor,
      // ayrıntı fonksiyon loguna yazılıyor.
      const known =
        err instanceof VoiceQuotaError ||
        err instanceof VoiceOverloadedError ||
        err instanceof VoiceUpstreamError;
      const reason = known ? (err as { reason: string }).reason : "unexpected_error";
      // TAM ayrıntı yalnızca fonksiyon loguna (supabase functions logs
      // voice-entry). Yanıta sadece kısa reason kodu gidiyor — kullanıcıya
      // görünen metin hâlâ mesaj kataloğundan üretiliyor, ama artık tarayıcı
      // konsolunda "neden" yazıyor.
      console.error("[voice-entry] BAŞARISIZ reason=" + reason, err);
      const code = err instanceof VoiceQuotaError
        ? "quotaExceeded"
        : err instanceof VoiceOverloadedError
          ? "overloaded"
          : "llmFailed";
      return Response.json({ code, reason }, { status: 502 });
    }
  }),
};
