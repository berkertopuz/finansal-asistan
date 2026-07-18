import type { PriceQuote } from "./types.ts";

const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/price";
const TROY_OUNCE_GRAMS = 31.1034768;

async function fetchBinancePrices(pairs: string[]): Promise<Map<string, number>> {
  const url = `${BINANCE_TICKER_URL}?symbols=${encodeURIComponent(JSON.stringify(pairs))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance fetch failed: ${res.status}`);
  const data: { symbol: string; price: string }[] = await res.json();
  return new Map(data.map((d) => [d.symbol, Number(d.price)]));
}

// Binance public API — no auth, no rate-limit key needed (docs/phase1-plan.md
// C, T1). Crypto stays priced in USD/USDT; TRY conversion happens in the app
// layer against the same-cycle USDTRY snapshot, not here.
export async function fetchCryptoQuotes(symbols: string[]): Promise<PriceQuote[]> {
  if (symbols.length === 0) return [];
  const pairs = symbols.map((s) => `${s.toUpperCase()}USDT`);
  const prices = await fetchBinancePrices(pairs);

  return symbols.map((symbol, i) => {
    const price = prices.get(pairs[i]);
    if (price === undefined || !Number.isFinite(price)) {
      throw new Error(`Missing Binance price for ${pairs[i]}`);
    }
    return { assetClass: "crypto", symbol, price, currency: "USD", source: "binance" };
  });
}

export async function fetchUsdtTryRate(): Promise<number> {
  const prices = await fetchBinancePrices(["USDTTRY"]);
  const rate = prices.get("USDTTRY");
  if (rate === undefined || !Number.isFinite(rate)) throw new Error("Missing USDTTRY price");
  return rate;
}

// Gram gold in TRY, derived from PAXG (1 token ≈ 1 troy oz of gold) — Binance
// has no direct XAU pair. T3: PAXG can trade at a small premium/discount to
// spot gold; swap this adapter out if a dedicated gold feed becomes worth
// the extra API key (docs/phase1-plan.md E, provider interface is built to
// make that a config change, not a rewrite).
export async function fetchGoldGramTRY(usdtTry: number): Promise<PriceQuote> {
  const prices = await fetchBinancePrices(["PAXGUSDT"]);
  const paxgUsdt = prices.get("PAXGUSDT");
  if (paxgUsdt === undefined || !Number.isFinite(paxgUsdt)) throw new Error("Missing PAXGUSDT price");

  const gramTRY = (paxgUsdt * usdtTry) / TROY_OUNCE_GRAMS;
  return { assetClass: "gold", symbol: "XAU_GRAM", price: gramTRY, currency: "TRY", source: "binance" };
}
