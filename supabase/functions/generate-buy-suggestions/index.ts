import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { BASELINE_SYMBOLS } from "../_shared/baseline-symbols.ts";
import { assembleLiveSnapshots, dedupeSymbols, fetchRecentNews, type LiveSnapshot } from "../_shared/recommendations/context.ts";
import { buildBuySuggestionPrompt, type NewsContextItem } from "../_shared/recommendations/prompts.ts";
import { generateValidatedOneriler } from "../_shared/recommendations/openai-client.ts";
import { guvenToConfidence } from "../_shared/recommendations/schema.ts";
import { localeFromProfile } from "../_shared/locale.ts";

const ONERI_SAYISI = 5;
const MIN_SINIF_SAYISI = 2;
const MAX_LIVE_SUGGESTIONS = 5;
const EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000;

type Position = { user_id: string; asset_class: string; symbol: string; quantity: number };

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

function formatPositionsForPrompt(positions: Position[]) {
  return positions.map((p) => ({ varlik_sinifi: p.asset_class, sembol: p.symbol, adet: p.quantity }));
}

// Daily cron, 08:00 TRT (docs/phase1-plan.md C). Skips a user once they
// already have 5 live buy suggestions so this doesn't runaway-generate;
// still comfortably supports the ">=5/week" rule (CLAUDE.md rule 6).
export default {
  fetch: withSupabase({ auth: ["secret"], cors: "disabled" }, async (_req, ctx) => {
    try {
      const { data: allPositionsRaw } = await ctx.supabaseAdmin
        .from("portfolio_positions")
        .select("user_id, asset_class, symbol, quantity");
      const allPositions = (allPositionsRaw as Position[]) ?? [];

      const wanted = dedupeSymbols([...BASELINE_SYMBOLS, ...allPositions]);
      const { snapshots, unavailable } = await assembleLiveSnapshots(ctx.supabaseAdmin, wanted);
      const news: NewsContextItem[] = await fetchRecentNews(ctx.supabaseAdmin);

      // Hard gate (docs/phase1-plan.md C, "self-check before every LLM
      // call"): no fresh prices or no recent news at all → no LLM call,
      // full stop. Never let the model improvise on stale/missing data.
      if (snapshots.length === 0 || news.length === 0) {
        return Response.json({ generated: 0, skipped: "stale_data_gate", unavailable });
      }

      const { data: profiles } = await ctx.supabaseAdmin.from("profiles").select("id, locale");
      const snapshotIdBySymbol = new Map(snapshots.map((s) => [`${s.assetClass}:${s.symbol}`, s.id]));

      let generated = 0;
      const errors: string[] = [];
      for (const profile of (profiles as { id: string; locale: string | null }[]) ?? []) {
        const userId = profile.id;
        const locale = localeFromProfile(profile.locale);

        const { count: liveCount } = await ctx.supabaseAdmin
          .from("recommendations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("kind", "buy_suggestion")
          .gt("expires_at", new Date().toISOString());
        if ((liveCount ?? 0) >= MAX_LIVE_SUGGESTIONS) continue;

        const { data: surplusRow } = await ctx.supabaseAdmin
          .from("v_monthly_surplus")
          .select("surplus")
          .eq("user_id", userId)
          .maybeSingle();
        const surplusTry = Number((surplusRow as { surplus: number } | null)?.surplus ?? 0);

        const ownPositions = allPositions.filter((p) => p.user_id === userId);

        const userPrompt = buildBuySuggestionPrompt({
          oneriSayisi: ONERI_SAYISI,
          minSinifSayisi: MIN_SINIF_SAYISI,
          surplusTry,
          positionsJson: formatPositionsForPrompt(ownPositions),
          fetchZamani: new Date().toISOString(),
          snapshotsJson: formatSnapshotsForPrompt(snapshots),
          newsJson: news,
        });

        const oneriler = await generateValidatedOneriler({
          apiKey: Deno.env.get("OPENAI_API_KEY")!,
          userPrompt,
          news,
          locale,
        });
        if (oneriler.length === 0) continue;

        const expiresAt = new Date(Date.now() + EXPIRES_IN_MS).toISOString();
        const rows = oneriler.map((o) => ({
          user_id: userId,
          kind: "buy_suggestion",
          asset_class: o.varlik_sinifi,
          symbol: o.sembol,
          signal: null,
          confidence: guvenToConfidence(o.guven),
          body: o.gerekce,
          locale,
          cited_headline: o.atif_baslik,
          cited_url: o.atif_url,
          snapshot_ids: [snapshotIdBySymbol.get(`${o.varlik_sinifi}:${o.sembol}`)].filter(Boolean),
          expires_at: expiresAt,
        }));

        const { error: insertError } = await ctx.supabaseAdmin.from("recommendations").insert(rows);
        if (insertError) {
          errors.push(`${userId}: ${insertError.message}`);
          continue;
        }
        generated += rows.length;
      }

      return Response.json({ generated, unavailable, errors });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }),
};
