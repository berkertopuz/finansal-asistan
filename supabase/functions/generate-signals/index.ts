import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { assembleLiveSnapshots, dedupeSymbols, fetchRecentNews, type LiveSnapshot } from "../_shared/recommendations/context.ts";
import { buildPositionSignalPrompt, type NewsContextItem } from "../_shared/recommendations/prompts.ts";
import { generateValidatedOneriler } from "../_shared/recommendations/openai-client.ts";
import { guvenToConfidence } from "../_shared/recommendations/schema.ts";
import { localeFromProfile } from "../_shared/locale.ts";

type Position = {
  user_id: string;
  asset_class: string;
  symbol: string;
  quantity: number;
  avg_cost_try: number;
};

type MarketEvent = {
  id: string;
  event_type: "bist100_move" | "usdtry_move" | "rate_decision" | "cpi_print";
  magnitude: number | null;
  detected_at: string;
};

const EVENT_TYPE_TR: Record<MarketEvent["event_type"], string> = {
  bist100_move: "BIST-100 Hareketi",
  usdtry_move: "USD/TRY Hareketi",
  rate_decision: "Faiz Kararı",
  cpi_print: "Enflasyon (TÜFE) Açıklaması",
};

// deno-lint-ignore no-explicit-any
type AdminClient = any;

// TRY equivalent for pl_yuzde — crypto snapshots are priced in USD
// (docs/phase1-plan.md A.1), everything else is already TRY.
function priceInTry(snapshot: LiveSnapshot, usdTry: number | null): number | null {
  if (snapshot.currency === "TRY") return snapshot.price;
  if (usdTry) return snapshot.price * usdTry;
  return null;
}

async function processEvent(ctx: { supabaseAdmin: AdminClient }, event: MarketEvent) {
  const { data: allPositionsRaw } = await ctx.supabaseAdmin
    .from("portfolio_positions")
    .select("user_id, asset_class, symbol, quantity, avg_cost_try");
  const allPositions = (allPositionsRaw as Position[]) ?? [];

  if (allPositions.length === 0) return { generated: 0 };

  const wanted = dedupeSymbols(allPositions).map((p) => ({ asset_class: p.asset_class, symbol: p.symbol }));
  // Position P/L needs a TRY conversion for any crypto holding.
  if (allPositions.some((p) => p.asset_class === "crypto") && !wanted.some((w) => w.asset_class === "fx")) {
    wanted.push({ asset_class: "fx", symbol: "USDTRY" });
  }

  const { snapshots } = await assembleLiveSnapshots(ctx.supabaseAdmin, wanted);
  const news: NewsContextItem[] = await fetchRecentNews(ctx.supabaseAdmin);

  if (snapshots.length === 0 || news.length === 0) {
    return { generated: 0, skipped: "stale_data_gate" };
  }

  const usdTrySnapshot = snapshots.find((s) => s.assetClass === "fx" && s.symbol === "USDTRY");
  const usdTry = usdTrySnapshot?.price ?? null;
  const snapshotBySymbol = new Map(snapshots.map((s) => [`${s.assetClass}:${s.symbol}`, s]));

  const byUser = new Map<string, Position[]>();
  for (const p of allPositions) {
    byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p]);
  }

  const { data: profilesRaw } = await ctx.supabaseAdmin
    .from("profiles")
    .select("id, locale")
    .in("id", [...byUser.keys()]);
  const localeByUser = new Map(
    ((profilesRaw as { id: string; locale: string | null }[]) ?? []).map((p) => [
      p.id,
      localeFromProfile(p.locale),
    ]),
  );

  let generated = 0;
  for (const [userId, positions] of byUser) {
    const locale = localeByUser.get(userId) ?? "tr";
    const positionsWithPrices = positions
      .map((p) => {
        const snapshot = snapshotBySymbol.get(`${p.asset_class}:${p.symbol}`);
        if (!snapshot) return null;
        const guncelFiyatTry = priceInTry(snapshot, usdTry);
        if (guncelFiyatTry === null) return null;
        const plYuzde =
          p.avg_cost_try > 0 ? ((guncelFiyatTry - p.avg_cost_try) / p.avg_cost_try) * 100 : 0;
        return {
          sembol: p.symbol,
          sinif: p.asset_class,
          adet: p.quantity,
          ortalama_maliyet_try: p.avg_cost_try,
          guncel_fiyat_try: Number(guncelFiyatTry.toFixed(2)),
          pl_yuzde: Number(plYuzde.toFixed(2)),
          fiyat_zamani: snapshot.fetchedAt,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (positionsWithPrices.length === 0) continue;

    const userPrompt = buildPositionSignalPrompt({
      eventTypeTr: EVENT_TYPE_TR[event.event_type],
      eventMagnitude: event.magnitude ?? 0,
      eventDetectedAt: event.detected_at,
      positionsWithPricesJson: positionsWithPrices,
      newsJson: news,
    });

    const oneriler = await generateValidatedOneriler({
      apiKey: Deno.env.get("OPENAI_API_KEY")!,
      userPrompt,
      news,
      locale,
    });
    if (oneriler.length === 0) continue;

    const rows = oneriler
      .filter((o) => o.sinyal !== null)
      .map((o) => ({
        user_id: userId,
        kind: "position_signal",
        asset_class: o.varlik_sinifi,
        symbol: o.sembol,
        signal: o.sinyal,
        confidence: guvenToConfidence(o.guven),
        body: o.gerekce,
        locale,
        cited_headline: o.atif_baslik,
        cited_url: o.atif_url,
        snapshot_ids: [snapshotBySymbol.get(`${o.varlik_sinifi}:${o.sembol}`)?.id].filter(Boolean),
        event_id: event.id,
      }));

    if (rows.length > 0) {
      await ctx.supabaseAdmin.from("recommendations").insert(rows);
      generated += rows.length;
    }
  }

  return { generated };
}

// Fires two ways (docs/phase1-plan.md C): real-time via the market_events
// row trigger set up in section 1 (payload has event_id), and a daily
// 07:00 TRT safety sweep with no event_id — that pass picks up anything
// still unprocessed near the 24h SLA (CLAUDE.md rule 6).
export default {
  fetch: withSupabase({ auth: ["secret"], cors: "disabled" }, async (req, ctx) => {
    try {
      let eventId: string | undefined;
      try {
        const body = await req.json();
        eventId = body?.event_id;
      } catch {
        // No/empty body — safety-sweep mode.
      }

      let events: MarketEvent[];
      if (eventId) {
        const { data } = await ctx.supabaseAdmin
          .from("market_events")
          .select("id, event_type, magnitude, detected_at")
          .eq("id", eventId)
          .maybeSingle();
        events = data ? [data as MarketEvent] : [];
      } else {
        const { data } = await ctx.supabaseAdmin
          .from("market_events")
          .select("id, event_type, magnitude, detected_at")
          .is("processed_at", null);
        events = (data as MarketEvent[]) ?? [];
      }

      let totalGenerated = 0;
      const results: Record<string, unknown>[] = [];
      for (const event of events) {
        const result = await processEvent(ctx, event);
        totalGenerated += result.generated;
        results.push({ event_id: event.id, ...result });
        await ctx.supabaseAdmin
          .from("market_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", event.id);
      }

      return Response.json({ generated: totalGenerated, events: results });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }),
};
