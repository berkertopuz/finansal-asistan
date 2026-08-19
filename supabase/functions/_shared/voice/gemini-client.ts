import { voiceResponseSchema, buildVoiceResponseSchema, type VoiceResponse } from "./schema.ts";
import { buildVoiceSystemPrompt, buildVoiceUserPrompt } from "./prompts.ts";
import type { PromptLocale } from "../locale.ts";

// Projedeki TEK Gemini çağrısı. Öneri motoru ve ekstre ayrıştırma gpt-4o'da
// kalıyor (bkz. _shared/statements/openai-client.ts) — buraya Gemini
// girmesinin tek sebebi ses girişi: kullanıcı Gemini'nin Türkçe
// transkripsiyonunu bizzat deneyip tercih etti, ve Flash'ın ses girdisi
// fiyatlandırması OpenAI'ın ses modellerine göre belirgin ucuz.
//
// SDK yok, düz fetch: @google/genai paketini Deno'ya sokmanın tek kazancı
// birkaç satır tasarruf olurdu, karşılığında yeni bir bağımlılık ve npm:
// çözümleme yüzeyi gelirdi.
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// Birincil model. Seçim SES gecikmesi ölçülerek yapıldı (2026-08, 4 sn'lik
// WAV, 3'er deneme) — ve bu ölçüm METİN girdisiyle yapılan ilk ölçümü
// çürüttü, çünkü ses işleme çok daha ağır:
//
//   gemini-3.5-flash-lite   1,3 sn ortalama   3/3
//   gemini-3.5-flash       11,5 sn ortalama   3/3   (metinde ~2 sn'ydi!)
//   gemini-3.7-flash        8,6 sn ortalama   2/3   (kalanı 503)
//
// Sesli girişin TEK gerekçesi hız: 10+ saniye bekleyen kullanıcı için elle
// yazmak zaten daha hızlı, yani yavaş bir model özelliği anlamsız kılıyor.
// Yanlış duyulan bir tutar ise zaten düzeltilebilir (inceleme listesi
// tamamen düzenlenebilir + transcript alanı ne duyulduğunu gösteriyor), o
// yüzden denge hızdan yana kuruldu.
//
// Türkçe duyma kalitesini daha iyi bulursan başka bir modele geçebilirsin:
//   supabase secrets set GEMINI_VOICE_MODEL=gemini-3.5-flash
// (transcript alanı iki modeli kulakla karşılaştırmayı mümkün kılıyor)
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

// Birincil model retry'lerden sonra hâlâ 5xx veriyorsa son bir şans: farklı
// bir modelin kapasitesi bağımsız, aynı anda ikisinin birden dolu olması
// nadir. Kullanıcının az önce söylediği cümleyi çöpe atmaktan iyi.
const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash";

// Gemini 3.x Flash VARSAYILAN OLARAK "medium" seviyede düşünüyor ve düşünme
// çıktı token bütçesinden yiyor. Gerçek kullanımda bu şöyle patladı: "3 ekmek
// 10 tl 2 su 20 tl" ya da "gofret 80 tl kredi kartı" gibi biraz daha fazla
// akıl yürütme gerektiren cümlelerde bütçe düşünmeye gidiyor, model cevabı
// yazmaya sıra gelmeden duruyor ve API finishReason=MAX_TOKENS ile BOŞ bir
// parts dizisi döndürüyor — kullanıcıya "yapay zekâ servisine ulaşılamadı"
// olarak yansıyordu. Bu iş mekanik bir çıkarım (Google'ın kendi dokümanı da
// "fact retrieval" için minimal/low öneriyor), o yüzden düşünme kısılıyor ve
// çıktıya cömert bir tavan veriliyor.
const THINKING_LEVEL = "low";
const MAX_OUTPUT_TOKENS = 4096;

// GEÇİCİ hatalar. Gemini yoğun saatlerde 503 UNAVAILABLE ("This model is
// currently experiencing high demand") döndürebiliyor ve bu tek bir denemede
// tamamen rastgele: gerçek bir teşhiste aynı istek 1. denemede 503, 2.
// denemede STOP + kusursuz sonuç verdi. Retry OLMADAN tek bir 503 kullanıcının
// az önce söylediği cümleyi çöpe atıp onu baştan konuşturuyordu — sesli
// girişte en can sıkıcı hata bu. Ses zaten bellekte, yeniden göndermek bedava.
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [600, 1800];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Hatalar artık kısa, makine okunur bir `reason` taşıyor. Kullanıcıya
// gösterilen metin hâlâ mesaj kataloğundan geliyor (CLAUDE.md kural 1), ama
// bu kod zincirin sonuna kadar taşınıp tarayıcı konsoluna ve sunucu loguna
// yazılıyor — "yapay zekâ servisine ulaşılamadı" mesajının ARKASINDA ne
// olduğunu tahmin etmek zorunda kalmamak için.
export class VoiceQuotaError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
  }
}
// Sağlayıcı geçici olarak müsait değil (retry'ler de tükendi). Kullanıcıya
// "bir şeyler bozuk" değil "şu anda yoğun, tekrar dene" demek için ayrı.
export class VoiceOverloadedError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
  }
}
export class VoiceUpstreamError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
  }
}

// Yanıt parçalarından SADECE cevap metnini toplar. parts[0]'ı körlemesine
// okumak yanlış: düşünen modellerde dizinin başında `thought: true` işaretli
// düşünce özetleri gelebiliyor ve o zaman JSON.parse anlamsız bir metne
// çarpıyor.
function extractAnswerText(candidate: unknown): string {
  const parts = (candidate as { content?: { parts?: unknown[] } })?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => (part as { thought?: boolean })?.thought !== true)
    .map((part) => (part as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

export async function transcribeEntry(params: {
  apiKey: string;
  model?: string;
  fallbackModel?: string;
  audioBase64: string;
  audioMimeType: string;
  todayDate: string;
  todayWeekday: string;
  categories: readonly string[];
  cardNames: readonly string[];
  locale: PromptLocale;
}): Promise<VoiceResponse> {
  const primary = params.model ?? DEFAULT_MODEL;
  const fallback = params.fallbackModel ?? DEFAULT_FALLBACK_MODEL;

  try {
    return await callModel(params, primary);
  } catch (err) {
    if (!(err instanceof VoiceOverloadedError) || fallback === primary) throw err;
    console.warn(`[voice] ${primary} yoğun, ${fallback} ile deneniyor`);
    return await callModel(params, fallback);
  }
}

async function callModel(
  params: Parameters<typeof transcribeEntry>[0],
  model: string,
): Promise<VoiceResponse> {

  const body = {
    systemInstruction: {
      parts: [
        {
          text: buildVoiceSystemPrompt({
            todayDate: params.todayDate,
            todayWeekday: params.todayWeekday,
            categories: params.categories,
            cardNames: params.cardNames,
            locale: params.locale,
          }),
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: buildVoiceUserPrompt() },
          { inline_data: { mime_type: params.audioMimeType, data: params.audioBase64 } },
        ],
      },
    ],
    generationConfig: {
      // İkisi birlikte gerekiyor: responseMimeType yalnızca "JSON döndür"
      // der, alan adlarını ve enum değerlerini asıl bağlayan responseSchema.
      responseMimeType: "application/json",
      responseSchema: buildVoiceResponseSchema(params.categories, params.cardNames),
      // Transkripsiyon + alan çıkarımı yaratıcılık istemiyor; aynı kayıt her
      // seferinde aynı taslağı vermeli.
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
    },
  };

  let res!: Response;
  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      // Anahtar ?key= query parametresi olarak da kabul ediliyor ama header
      // tercih edildi: query string'ler proxy/erişim loglarına sızıyor.
      headers: { "Content-Type": "application/json", "x-goog-api-key": params.apiKey },
      body: JSON.stringify(body),
    });

    if (res.ok) break;

    lastDetail = await res.text();

    if (res.status === 429) {
      // Kota/hız limiti — retry anlamsız (günlük limitse saatlerce sürer),
      // kullanıcıya ne yapması gerektiği söyleniyor.
      throw new VoiceQuotaError(`Gemini kota/hız limiti: ${lastDetail}`, `http_429 model=${model}`);
    }

    if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      console.warn(
        `[voice] Gemini ${res.status}, yeniden deneniyor (${attempt}/${MAX_ATTEMPTS - 1})`,
      );
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 1800);
      continue;
    }

    if (RETRYABLE_STATUSES.has(res.status)) {
      throw new VoiceOverloadedError(
        `Gemini ${res.status} (tüm denemeler tükendi): ${lastDetail}`,
        `http_${res.status} model=${model} attempts=${MAX_ATTEMPTS}`,
      );
    }

    throw new VoiceUpstreamError(
      `Gemini ${res.status}: ${lastDetail}`,
      `http_${res.status} model=${model}`,
    );
  }

  const payload = await res.json();
  const candidate = payload?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const text = extractAnswerText(candidate);

  if (!text) {
    // finishReason'ı loga yazmak şart: bu hatanın teşhisi tam olarak buradan
    // çıktı (MAX_TOKENS + boş parts = düşünme bütçeyi yedi).
    throw new VoiceUpstreamError(
      `Gemini yanıtında cevap metni yok (finishReason=${finishReason}): ${JSON.stringify(payload).slice(0, 800)}`,
      `empty_response finishReason=${finishReason} model=${model}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    // MAX_TOKENS'ta JSON yarıda kesilebiliyor — ayrı bir mesaj, "servise
    // ulaşılamadı" demekten dürüst.
    throw new VoiceUpstreamError(
      `Gemini geçersiz JSON döndürdü (finishReason=${finishReason}): ${text.slice(0, 500)}`,
      `invalid_json finishReason=${finishReason} model=${model}`,
    );
  }

  // responseSchema büyük ölçüde garanti veriyor ama tek doğrulama katmanı
  // olarak ona güvenmiyoruz — statements tarafındaki desenin aynısı.
  const parsed = voiceResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new VoiceUpstreamError(
      `Gemini şemaya uymayan çıktı verdi: ${parsed.error.message}`,
      `schema_mismatch model=${model}`,
    );
  }

  return parsed.data;
}
