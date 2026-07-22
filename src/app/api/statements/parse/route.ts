import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { extractStatementText } from "@/lib/statement-import/extract";
import { filterValidStatementRows } from "@/lib/statement-import/schema";

// 10MB — bir ekstre PDF'i için cömert bir üst sınır, kazara başka bir
// dosyanın yüklenmesine karşı bir güvenlik ağı.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return Response.json({ error: t("invalidFile") }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: t("fileTooLarge") }, { status: 400 });
  }

  let extracted;
  try {
    extracted = await extractStatementText(await file.arrayBuffer());
  } catch {
    return Response.json({ error: t("extractFailed") }, { status: 400 });
  }

  if (!extracted.transactionText.trim()) {
    return Response.json({ error: t("noTransactionsFound") }, { status: 400 });
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
    body: JSON.stringify({ transactionText: extracted.transactionText }),
  });

  const result = await edgeRes.json();
  if (!edgeRes.ok) {
    return Response.json({ error: result.error ?? t("parseFailed") }, { status: edgeRes.status });
  }

  const rows = filterValidStatementRows(Array.isArray(result.islemler) ? result.islemler : []);

  return Response.json({ header: extracted.header, rows });
}
