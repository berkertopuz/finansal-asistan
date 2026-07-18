import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { BASELINE_SYMBOLS } from "../_shared/baseline-symbols.ts";
import { assembleLiveSnapshots, dedupeSymbols, fetchRecentNews, type LiveSnapshot } from "../_shared/recommendations/context.ts";
import { buildBuySuggestionPrompt, type NewsContextItem } from "../_shared/recommendations/prompts.ts";
import { generateValidatedOneriler } from "../_shared/recommendations/openai-client.ts";
import { guvenToConfidence } from "../_shared/recommendations/schema.ts";

const ONERI_SAYISI = 5;
const MIN_SINIF_SAYISI = 2;
const MAX_LIVE_SUGGESTIONS = 5;
const EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000;

type Position = { asset_class: string; symbol: string; quantity: number };

function formatSnapshotsForPrompt(snapshots: LiveSnapshot[]) {
  return snapshots.map((s) => ({
    varlik_sinifi: s.assetClass,
    sembol: s.symbol,
    fiyat: s.price,
    birim: s.currency,
    kaynak: s.source,
    saat: s.fetchedAt,
  }));
}

// The "Yenile" button's edge (docs/phase1-plan.md C — POST
// /api/recommendations/stream). auth:["user"] means the caller must present
// the caller's own Supabase session JWT — the user to generate for comes
// from the verified token (ctx.userClaims.id), never a client-supplied
// parameter, so this can't be tricked into generating for someone else.
// The Next.js route handles session verification, the 1/hour rate limit,
// and turning this single JSON response into an SSE reveal — this function
// only does generation, exactly like the two cron-triggered functions.
export default {
  fetch: withSupabase({ auth: ["user"], cors: "disabled" }, async (_req, ctx) => {
    try {
      const userId = ctx.userClaims?.id;
      if (!userId) {
        return Response.json({ error: "Oturum doğrulanamadı." }, { status: 401 });
      }

      const { count: liveCount } = await ctx.supabaseAdmin
        .from("recommendations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("kind", "buy_suggestion")
        .gt("expires_at", new Date().toISOString());
      if ((liveCount ?? 0) >= MAX_LIVE_SUGGESTIONS) {
        return Response.json({ generated: 0, skipped: "already_at_cap" });
      }

      const { data: ownPositionsRaw } = await ctx.supabaseAdmin
        .from("portfolio_positions")
        .select("asset_class, symbol, quantity")
        .eq("user_id", userId);
      const ownPositions = (ownPositionsRaw as Position[]) ?? [];

      const wanted = dedupeSymbols([...BASELINE_SYMBOLS, ...ownPositions]);
      const { snapshots, unavailable } = await assembleLiveSnapshots(ctx.supabaseAdmin, wanted);
      const news: NewsContextItem[] = await fetchRecentNews(ctx.supabaseAdmin);

      if (snapshots.length === 0 || news.length === 0) {
        return Response.json({ generated: 0, skipped: "stale_data_gate", unavailable });
      }

      const { data: surplusRow } = await ctx.supabaseAdmin
        .from("v_monthly_surplus")
        .select("surplus")
        .eq("user_id", userId)
        .maybeSingle();
      const surplusTry = Number((surplusRow as { surplus: number } | null)?.surplus ?? 0);

      const userPrompt = buildBuySuggestionPrompt({
        oneriSayisi: ONERI_SAYISI,
        minSinifSayisi: MIN_SINIF_SAYISI,
        surplusTry,
        positionsJson: ownPositions.map((p) => ({
          varlik_sinifi: p.asset_class,
          sembol: p.symbol,
          adet: p.quantity,
        })),
        fetchZamani: new Date().toISOString(),
        snapshotsJson: formatSnapshotsForPrompt(snapshots),
        newsJson: news,
      });

      const oneriler = await generateValidatedOneriler({
        apiKey: Deno.env.get("OPENAI_API_KEY")!,
        userPrompt,
        news,
      });

      if (oneriler.length === 0) {
        return Response.json({ generated: 0, skipped: "no_valid_oneriler" });
      }

      const snapshotIdBySymbol = new Map(snapshots.map((s) => [`${s.assetClass}:${s.symbol}`, s.id]));
      const expiresAt = new Date(Date.now() + EXPIRES_IN_MS).toISOString();
      const rows = oneriler.map((o) => ({
        user_id: userId,
        kind: "buy_suggestion",
        asset_class: o.varlik_sinifi,
        symbol: o.sembol,
        signal: null,
        confidence: guvenToConfidence(o.guven),
        body_tr: o.gerekce_tr,
        cited_headline: o.atif_baslik,
        cited_url: o.atif_url,
        snapshot_ids: [snapshotIdBySymbol.get(`${o.varlik_sinifi}:${o.sembol}`)].filter(Boolean),
        expires_at: expiresAt,
      }));

      const { error: insertError } = await ctx.supabaseAdmin.from("recommendations").insert(rows);
      if (insertError) {
        return Response.json({ error: insertError.message }, { status: 500 });
      }

      return Response.json({ generated: rows.length, oneriler });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }),
};
