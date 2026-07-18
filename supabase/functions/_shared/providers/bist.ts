import type { PriceQuote } from "./types.ts";

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

// No sanctioned free BIST API exists (docs/phase1-plan.md E.a2 — Investing.com
// scraping is explicitly ruled out, T4). Yahoo Finance's chart JSON endpoint
// (not HTML scraping) covers BIST via ".IS"-suffixed tickers and needs no
// API key; it's third-party and unofficial for this exchange though, so
// treat as T3 and keep this adapter swappable behind fetchBistQuotes.
async function fetchOne(symbol: string): Promise<PriceQuote | null> {
  const ticker = symbol.endsWith(".IS") ? symbol : `${symbol}.IS`;
  try {
    const res = await fetch(`${YAHOO_CHART_URL}/${ticker}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      assetClass: "bist",
      symbol,
      price,
      currency: "TRY",
      source: "bist_provider",
    };
  } catch {
    return null;
  }
}

// Individual bad/delisted symbols are dropped, not fatal — one bad ticker in
// a user's portfolio shouldn't take out XU100 and everything else.
export async function fetchBistQuotes(symbols: string[]): Promise<PriceQuote[]> {
  if (symbols.length === 0) return [];
  const results = await Promise.all(symbols.map(fetchOne));
  return results.filter((q): q is PriceQuote => q !== null);
}
