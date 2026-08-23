import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { StatementTooComplexError, extractStatementText } from "@/lib/statement-import/extract";
import { filterValidStatementRows, parseStatementHeader } from "@/lib/statement-import/schema";

// 10MB — bir ekstre PDF'i için cömert bir üst sınır, kazara başka bir
// dosyanın yüklenmesine karşı bir güvenlik ağı.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Gövdenin tamamı için sınır: dosya + multipart zarfı. `file.size` kontrolü
// ancak request.formData() gövdeyi TAMAMEN belleğe aldıktan SONRA çalışıyor,
// yani tek başına bir bellek koruması değil — 1 GB'lık bir gövde, "dosya çok
// büyük" hatasını görmeden önce çoktan okunmuş olurdu. Content-Length'e
// bakmak bunu el sıkışma anında kesiyor.
//
// Content-Length HER ZAMAN gelmiyor (chunked transfer): o durumda yalnızca
// aşağıdaki file.size kontrolü kalıyor. Bu kabul edilen bir artık risk —
// tamamen kapatmak gövdeyi akış halinde okumayı gerektirir, Next'in
// formData() API'si buna izin vermiyor.
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;

// PDF imzası. `file.type` İSTEMCİDEN geliyor (multipart Content-Type
// başlığı), yani saldırgan herhangi bir baytı "application/pdf" diye
// gönderebilir — tek başına bir doğrulama değil, bir ipucu. Gerçek kontrol
// dosyanın kendi imzası. Spec, imzadan önce bir miktar çöp bayta izin
// veriyor ve ayrıştırıcılar da tolere ediyor, o yüzden ilk 1 KB taranıyor.
const PDF_SIGNATURE = "%PDF-";
const PDF_SIGNATURE_SCAN_BYTES = 1024;

function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, PDF_SIGNATURE_SCAN_BYTES)).toString("latin1");
  return head.includes(PDF_SIGNATURE);
}

// Edge function'ın döndürdüğü hata kodu → mesaj kataloğu anahtarı. Dinamik
// anahtar araması yapılmıyor (next-intl bilinmeyen anahtarda hata atıyor);
// yalnızca bu tabloda olan kodlar çevrilir, gerisi genel mesaja düşer.
const UPSTREAM_ERROR_KEYS = new Set(["quotaExceeded", "llmFailed"]);

function upstreamErrorMessage(result: unknown, t: (key: string) => string): string {
  const { code, error } = (result ?? {}) as { code?: unknown; error?: unknown };
  if (typeof code === "string" && UPSTREAM_ERROR_KEYS.has(code)) return t(code);
  return typeof error === "string" ? error : t("parseFailed");
}

// refresh-recommendations'ın Next.js ucuyla (src/app/api/recommendations/stream/route.ts)
// aynı köprü deseni: burada oturum + rıza kontrolü + PDF'ten metin çıkarımı
// (LLM'siz, PII asla buradan çıkmaz), sonra kullanıcı JWT'siyle edge function'a
// tek bir istek. Dosya hiçbir zaman diske/Storage'a yazılmaz — bellekte
// işlenip atılır (KVKK veri minimizasyonu — CLAUDE.md'ye eklenen not).
export async function POST(request: Request) {
  const t = await getTranslations("statements.errors");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: t("noSession") }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("statement_llm_consent_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!(profile as { statement_llm_consent_at: string | null } | null)?.statement_llm_consent_at) {
    return Response.json({ error: t("consentRequired"), consentRequired: true }, { status: 403 });
  }

  // Gövdeyi OKUMADAN önceki tek kontrol — bkz. MAX_REQUEST_BYTES notu.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: t("fileTooLarge") }, { status: 413 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return Response.json({ error: t("invalidFile") }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: t("fileTooLarge") }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // İmza kontrolü ayrıştırıcıdan ÖNCE: pdf.js'e rastgele bayt vermemek,
  // ayrıştırıcı yüzeyini yalnızca gerçekten PDF olan girdilere daraltıyor.
  if (!hasPdfSignature(bytes)) {
    return Response.json({ error: t("invalidFile") }, { status: 400 });
  }

  let extracted;
  try {
    extracted = await extractStatementText(bytes.buffer as ArrayBuffer);
  } catch (error) {
    if (error instanceof StatementTooComplexError) {
      // Sunucu loguna yazılıyor: normal kullanımda görülmemesi gereken bir
      // yol, tekrarlıyorsa ya gerçekten büyük bir ekstre ya kötüye kullanım.
      console.warn("[/api/statements/parse] bütçe aşıldı:", error.message);
      return Response.json({ error: t("tooComplex") }, { status: 413 });
    }
    return Response.json({ error: t("extractFailed") }, { status: 400 });
  }

  // Şekil whitelist'i hiçbir aday işlem satırı bulamadıysa bu PDF bizim
  // okuyamadığımız bir şey (ör. metin katmanı olmayan taranmış bir ekstre,
  // ya da tarihle başlamayan bir tablo düzeni). Kullanıcıya dürüst bir hata
  // gösterip manuel girişe yönlendiriyoruz — OpenAI'a boş/anlamsız bir metin
  // gönderip ücret ödemenin de, sayfayı görüntü olarak gönderip (ad/adres
  // dahil) gizliliği bozmanın da bir faydası yok.
  if (extracted.transactionCount === 0) {
    return Response.json({ error: t("unreadableStatement") }, { status: 422 });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return Response.json({ error: t("sessionInvalid") }, { status: 401 });
  }

  const edgeRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/parse-statement`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ statementMarkdown: extracted.markdown }),
  });

  const result = await edgeRes.json();
  if (!edgeRes.ok) {
    // Edge function artık başarısız bir OpenAI çağrısında ham sağlayıcı
    // metnini değil sabit bir kod döndürüyor (bkz. oradaki not) — kullanıcıya
    // görünen metin burada, mesaj kataloğundan üretiliyor. `result.error`
    // yolu, kodu olmayan diğer (normal kullanımda görülmemesi gereken) edge
    // hataları için geriye dönük olarak korunuyor.
    return Response.json({ error: upstreamErrorMessage(result, t) }, { status: edgeRes.status });
  }

  const rows = filterValidStatementRows(Array.isArray(result.islemler) ? result.islemler : []);
  if (rows.length === 0) {
    return Response.json({ error: t("noTransactionsFound") }, { status: 422 });
  }

  return Response.json({ header: parseStatementHeader(result.ekstre), rows });
}
