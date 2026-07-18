import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { BASELINE_SYMBOLS } from "../_shared/baseline-symbols.ts";
import { fetchCryptoQuotes, fetchGoldGramTRY, fetchUsdtTryRate } from "../_shared/providers/binance.ts";
import { fetchUsdTryFromTcmb } from "../_shared/providers/tcmb.ts";
import { fetchBistQuotes } from "../_shared/providers/bist.ts";
import type { PriceQuote } from "../_shared/providers/types.ts";

type Holding = { asset_class: string; symbol: string };

function dedupeSymbols(items: Holding[]): Holding[] {
  const byKey = new Map<string, Holding>();
  for (const item of items) byKey.set(`${item.asset_class}:${item.symbol}`, item);
  return [...byKey.values()];
}

// Cron-only — pg_cron (via private.invoke_edge_function) calls this with the
// project's own secret key as `apikey`. No "publishable" mode: this must
// never be reachable with just the anon key.
export default {
  fetch: withSupabase({ auth: ["secret"], cors: "disabled" }, async (_req, ctx) => {
    const { data: positions } = await ctx.supabaseAdmin
      .from("portfolio_positions")
      .select("asset_class, symbol");

    // Fan out by distinct symbol across every user's holdings, not per
    // position — 50 positions in the same symbol is one Binance/Yahoo call,
    // not 50 (docs/phase1-plan.md E.c).
    const wanted = dedupeSymbols([...BASELINE_SYMBOLS, ...((positions as Holding[]) ?? [])]);

    const snapshots: PriceQuote[] = [];
    const failures: string[] = [];
    let usdtTry: number | null = null;

    const cryptoSymbols = wanted.filter((w) => w.asset_class === "crypto").map((w) => w.symbol);
    try {
      usdtTry = await fetchUsdtTryRate();
      snapshots.push(...(await fetchCryptoQuotes(cryptoSymbols)));
    } catch {
      failures.push("crypto");
    }

    if (wanted.some((w) => w.asset_class === "gold")) {
      try {
        usdtTry ??= await fetchUsdtTryRate();
        snapshots.push(await fetchGoldGramTRY(usdtTry));
      } catch {
        failures.push("gold");
      }
    }

    try {
      const usdTry = await fetchUsdTryFromTcmb();
      snapshots.push({ assetClass: "fx", symbol: "USDTRY", price: usdTry, currency: "TRY", source: "tcmb" });
    } catch {
      // TCMB down/stale — Binance USDT/TRY cross as an indicative fallback,
      // tagged so the app caps FX recommendation confidence at "orta"
      // (docs/phase1-plan.md E.a).
      try {
        usdtTry ??= await fetchUsdtTryRate();
        snapshots.push({
          assetClass: "fx",
          symbol: "USDTRY",
          price: usdtTry,
          currency: "TRY",
          source: "binance_cross",
        });
      } catch {
        failures.push("fx");
      }
    }

    const bistSymbols = wanted.filter((w) => w.asset_class === "bist").map((w) => w.symbol);
    try {
      snapshots.push(...(await fetchBistQuotes(bistSymbols)));
    } catch {
      failures.push("bist");
    }

    let inserted = 0;
    let insertError: string | null = null;
    if (snapshots.length > 0) {
      const { error, count } = await ctx.supabaseAdmin.from("market_snapshots").insert(
        snapshots.map((s) => ({
          asset_class: s.assetClass,
          symbol: s.symbol,
          price: s.price,
          currency: s.currency,
          source: s.source,
        })),
        { count: "exact" },
      );
      if (error) {
        insertError = error.message;
      } else {
        inserted = count ?? snapshots.length;
      }
    }

    return Response.json({ inserted, failures, insertError });
  }),
};
