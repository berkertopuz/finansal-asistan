import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/categories-data";
import { getCreditCards } from "@/lib/credit-cards-data";
import { ENTRY_CATEGORIES } from "@/lib/ledger";
import { fromIntlTag } from "@/lib/locale";

// Gemini'nin kabul ettiği ses türleri. Client kaydı göndermeden önce WAV'a
// çeviriyor (Android Chrome MediaRecorder'ı audio/webm, iOS Safari audio/mp4
// üretiyor — ikisi de Gemini'nin listesinde YOK), bu whitelist o dönüşümün
// sessizce bozulmasına karşı bir ağ.
const ALLOWED_MIME_TYPES = new Set([
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

// ~30 sn'lik 16 kHz mono WAV yaklaşık 1 MB. 6 MB, client'taki süre sınırı
// bozulsa bile faturaya çarpmadan önce duran bir üst sınır (edge function'da
// da base64 sonrası ikinci bir sınır var).
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

// Model "dün"ü çözebilmek için bugünün tarihini bilmek zorunda ve bu tarih
// KULLANICININ saat diliminde olmalı — sunucu UTC'de koşuyor, gece yarısı
// civarında bir gün kayardı. Bu yüzden tarihi client gönderiyor; burada
// sunucu tarihine ±2 gün uzaklıkta olduğu doğrulanıyor, böylece manipüle
// edilmiş bir tarih modele geçmiyor.
const MAX_DATE_DRIFT_DAYS = 2;

function isPlausibleToday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const supplied = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(supplied)) return false;
  const driftDays = Math.abs(supplied - Date.now()) / 86_400_000;
  return driftDays <= MAX_DATE_DRIFT_DAYS;
}

// Prompt Türkçe olduğu için haftanın günü de her zaman Türkçe — modelin
// "geçen cuma"yı çözerken bugünün hangi gün olduğunu bilmesi gerekiyor.
function turkishWeekday(dateString: string): string {
  return new Intl.DateTimeFormat("tr-TR", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${dateString}T00:00:00Z`),
  );
}

// src/app/api/statements/parse/route.ts ile aynı köprü deseni: burada oturum +
// rıza kontrolü + bağlam toplama (kategoriler, locale — client'a
// güvenilmiyor), sonra kullanıcı JWT'siyle edge function'a tek bir istek. Ses
// kaydı hiçbir zaman diske/Storage'a yazılmıyor, bellekte işlenip atılıyor
// (KVKK veri minimizasyonu).
export async function POST(request: Request) {
  const t = await getTranslations("ledger.voice.errors");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: t("noSession") }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("voice_llm_consent_at, locale")
    .eq("id", user.id)
    .maybeSingle();

  const profileRow = profile as { voice_llm_consent_at: string | null; locale: string | null } | null;

  if (!profileRow?.voice_llm_consent_at) {
    return Response.json({ error: t("consentRequired"), consentRequired: true }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("audio");
  const todayDate = formData.get("todayDate");

  if (!(file instanceof File) || !ALLOWED_MIME_TYPES.has(file.type)) {
    return Response.json({ error: t("invalidAudio") }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: t("emptyAudio") }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: t("audioTooLong") }, { status: 400 });
  }
  if (typeof todayDate !== "string" || !isPlausibleToday(todayDate)) {
    return Response.json({ error: t("invalidAudio") }, { status: 400 });
  }

  // Kategori listesi client'tan DEĞİL sunucudan okunuyor: model bu listenin
  // dışına çıkamıyor (responseSchema enum'u bundan kuruluyor), dolayısıyla
  // liste kullanıcının gerçekten sahip olduğu etiketler olmak zorunda.
  const [custom, cards] = await Promise.all([getCategories(supabase), getCreditCards(supabase)]);
  const categories = [
    ...ENTRY_CATEGORIES,
    ...custom
      .map((c) => c.name)
      .filter((name) => !(ENTRY_CATEGORIES as readonly string[]).includes(name)),
  ];

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return Response.json({ error: t("sessionInvalid") }, { status: 401 });
  }

  const audioBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const edgeRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/voice-entry`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      audioMimeType: file.type,
      todayDate,
      todayWeekday: turkishWeekday(todayDate),
      categories,
      // Kart adları da sunucudan — model bu listenin dışında bir kart adı
      // uyduramıyor (responseSchema enum'u bundan kuruluyor).
      cardNames: cards.map((c) => c.name),
      locale: fromIntlTag(profileRow.locale),
    }),
  });

  // JSON'a KÖRLEMESİNE gitme. Edge function her zaman JSON döndürmüyor:
  // platform seviyesindeki hatalar (fonksiyon boot hatası, wall-clock/CPU
  // limiti, gateway zaman aşımı) HTML ya da düz metin bir hata sayfası
  // döndürüyor. Eskiden buradaki edgeRes.json() o durumda fırlatıyor, route
  // çöküyor, Next HTML bir 500 basıyor ve client'taki res.json() de aynı
  // hatayı veriyordu: 'Unexpected token "<", "<!DOCTYPE"... is not valid JSON'.
  // Yani gerçek sebep tamamen kayboluyordu.
  const rawBody = await edgeRes.text();
  let result: Record<string, unknown> | null = null;
  try {
    result = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.error(
      "[/api/voice] edge function JSON DEĞİL bir yanıt döndürdü:",
      JSON.stringify({
        status: edgeRes.status,
        contentType: edgeRes.headers.get("content-type"),
        bodyPreview: rawBody.slice(0, 500),
      }),
    );
    return Response.json(
      { error: t("transcribeFailed"), code: "nonJsonUpstream", reason: `non_json_upstream http_${edgeRes.status}` },
      { status: 502 },
    );
  }

  if (!edgeRes.ok) {
    // `next dev` terminaline tam döküm — hatanın nereden geldiğini tahmin
    // etmek zorunda kalmamak için (kullanıcı isteği).
    console.error(
      "[/api/voice] edge function başarısız:",
      JSON.stringify({ status: edgeRes.status, body: result }),
    );
    // Edge function başarısız bir Gemini çağrısında ham sağlayıcı metnini
    // değil sabit bir kod döndürüyor; kullanıcıya görünen metin burada,
    // mesaj kataloğundan üretiliyor (CLAUDE.md kural 1).
    const code = result?.code;
    const key =
      code === "quotaExceeded" || code === "llmFailed" || code === "overloaded"
        ? code
        : "transcribeFailed";
    // reason yalnızca teşhis için; arayüz onu göstermiyor, konsola yazıyor.
    return Response.json(
      { error: t(key), code, reason: result?.reason },
      { status: edgeRes.status },
    );
  }

  return Response.json({ ...result, cards });
}
