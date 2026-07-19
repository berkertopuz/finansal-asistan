import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fetchCryptoQuotes } from "../_shared/providers/binance.ts";
import { fetchUsdTryFromTcmb } from "../_shared/providers/tcmb.ts";
import { fetchBistQuotes } from "../_shared/providers/bist.ts";

const GOLD_SYMBOL = "XAU_GRAM";
const SUPPORTED_FX_SYMBOL = "USDTRY";

// Called from AddPositionForm before a position is saved — a free-text
// symbol field with no check lets someone type "BOK" and get a phantom
// position that will never resolve a price (docs/phase1-plan.md E.d is
// about faking amounts; this is the same failure mode for symbols).
// auth:["user"]: caller's own session JWT, matches refresh-recommendations.
export default {
  fetch: withSupabase({ auth: ["user"], cors: "disabled" }, async (req, ctx) => {
    try {
      const body = await req.json().catch(() => ({}));
      const assetClass = String(body?.asset_class ?? "");
      const symbol = String(body?.symbol ?? "").trim().toUpperCase();

      if (!symbol) {
        return Response.json({ valid: false, error: "Sembol gerekli." }, { status: 400 });
      }

      if (assetClass === "gold") {
        return Response.json(
          symbol === GOLD_SYMBOL
            ? { valid: true, symbol: GOLD_SYMBOL }
            : { valid: false, error: "Altın için tek desteklenen sembol gram altın." },
        );
      }

      if (assetClass === "fx") {
        if (symbol !== SUPPORTED_FX_SYMBOL) {
          return Response.json({
            valid: false,
            error: "Şu an yalnızca USDTRY destekleniyor.",
          });
        }
        // TCMB being transiently down doesn't make USDTRY an invalid symbol
        // — poll-prices' own binance_cross fallback will catch up later.
        try {
          const price = await fetchUsdTryFromTcmb();
          await ctx.supabaseAdmin
            .from("market_snapshots")
            .insert({ asset_class: "fx", symbol, price, currency: "TRY", source: "tcmb" });
        } catch {
          // ignore — symbol is still valid, just no fresh snapshot right now
        }
        return Response.json({ valid: true, symbol: SUPPORTED_FX_SYMBOL });
      }

      if (assetClass === "bist") {
        const quotes = await fetchBistQuotes([symbol]);
        const quote = quotes[0];
        if (!quote) {
          return Response.json({
            valid: false,
            error: `"${symbol}" BIST'te bulunamadı. Sembolü kontrol et (örn. THYAO, SISE).`,
          });
        }
        await ctx.supabaseAdmin.from("market_snapshots").insert({
          asset_class: "bist",
          symbol,
          price: quote.price,
          currency: quote.currency,
          source: quote.source,
        });
        return Response.json({ valid: true, symbol });
      }

      if (assetClass === "crypto") {
        try {
          const quotes = await fetchCryptoQuotes([symbol]);
          const quote = quotes[0];
          if (!quote) throw new Error("no quote");
          await ctx.supabaseAdmin.from("market_snapshots").insert({
            asset_class: "crypto",
            symbol,
            price: quote.price,
            currency: quote.currency,
            source: quote.source,
          });
          return Response.json({ valid: true, symbol });
        } catch {
          return Response.json({
            valid: false,
            error: `"${symbol}" Binance'te bulunamadı. Sembolü kontrol et (örn. BTC, ETH).`,
          });
        }
      }

      return Response.json({ valid: false, error: "Geçersiz varlık sınıfı." }, { status: 400 });
    } catch (err) {
      return Response.json(
        { valid: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }),
};
