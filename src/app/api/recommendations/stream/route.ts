import { createClient } from "@/lib/supabase/server";

// TODO: restore to 60 * 60 * 1000 before real use — 0 while testing so
// "Yenile" doesn't lock out for an hour on every tap.
const RATE_LIMIT_MS = 0;

type RefreshResult = {
  generated?: number;
  skipped?: "stale_data_gate" | "already_at_cap" | "no_valid_oneriler";
  oneriler?: { gerekce_tr: string }[];
  error?: string;
};

function buildRevealLines(result: RefreshResult): string[] {
  if (result.skipped === "stale_data_gate") {
    return ["Şu an güncel fiyat veya haber verisi yok — öneri ertelendi."];
  }
  if (result.skipped === "already_at_cap") {
    return ["Zaten güncel önerilerin var, şu an için yeni bir tanesine gerek yok."];
  }
  if (!result.oneriler || result.oneriler.length === 0) {
    return ["Şu an için yeni bir öneri bulunamadı."];
  }
  return result.oneriler.map((o) => o.gerekce_tr);
}

// The ≤3-tap flow's counterpart on /oneriler: user taps "Yenile", we stream
// the (already-generated, already-validated) result back as a typing
// reveal. Rate-limited 1/hour (docs/phase1-plan.md C) — but only a
// *successful* generation claims the slot; a stale-data skip doesn't
// punish the user with an hour-long lockout for a gap that isn't theirs.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Oturum bulunamadı." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("last_recommendation_refresh_at")
    .eq("id", user.id)
    .maybeSingle();

  const lastRefresh = profile?.last_recommendation_refresh_at
    ? new Date(profile.last_recommendation_refresh_at).getTime()
    : 0;
  const elapsed = Date.now() - lastRefresh;
  if (elapsed < RATE_LIMIT_MS) {
    const waitMinutes = Math.ceil((RATE_LIMIT_MS - elapsed) / 60_000);
    return Response.json(
      { error: `Yenilemek için ${waitMinutes} dakika daha bekle.` },
      { status: 429 },
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return Response.json({ error: "Oturum doğrulanamadı." }, { status: 401 });
  }

  const edgeRes = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/refresh-recommendations`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    },
  );
  const result: RefreshResult = await edgeRes.json();

  if (!edgeRes.ok) {
    return Response.json({ error: result.error ?? "Öneri üretilemedi." }, { status: edgeRes.status });
  }

  if ((result.generated ?? 0) > 0 || result.skipped === "already_at_cap") {
    await supabase
      .from("profiles")
      .update({ last_recommendation_refresh_at: new Date().toISOString() })
      .eq("id", user.id);
  }

  const lines = buildRevealLines(result);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: line })}\n\n`));
        await new Promise((r) => setTimeout(r, 250));
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ done: true, generated: result.generated ?? 0 })}\n\n`),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
