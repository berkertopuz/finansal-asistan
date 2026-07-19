import type { PriceQuote } from "./types.ts";

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const RETRY_DELAY_MS = 400;
const REQUEST_STAGGER_MS = 120;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(ticker: string): Promise<number | null> {
  const res = await fetch(`${YAHOO_CHART_URL}/${ticker}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  return Number.isFinite(price) && price > 0 ? price : null;
}

// No sanctioned free BIST API exists (docs/phase1-plan.md E.a2 — Investing.com
// scraping is explicitly ruled out, T4). Yahoo Finance's chart JSON endpoint
// (not HTML scraping) covers BIST via ".IS"-suffixed tickers and needs no
// API key; it's third-party and unofficial for this exchange though, so
// treat as T3 and keep this adapter swappable behind fetchBistQuotes.
//
// One retry after a short delay: observed live that a symbol fails on one
// poll-prices cycle and then succeeds cleanly seconds later with the exact
// same request, which points at Yahoo rate-limiting bursts of concurrent
// requests rather than anything wrong with the symbol itself.
async function fetchOne(symbol: string): Promise<PriceQuote | null> {
  const ticker = symbol.endsWith(".IS") ? symbol : `${symbol}.IS`;
  try {
    let price = await fetchOnce(ticker);
    if (price === null) {
      await sleep(RETRY_DELAY_MS);
      price = await fetchOnce(ticker);
    }
    if (price === null) return null;

    return { assetClass: "bist", symbol, price, currency: "TRY", source: "bist_provider" };
  } catch {
    return null;
  }
}

// Individual bad/delisted symbols are dropped, not fatal — one bad ticker in
// a user's portfolio shouldn't take out XU100 and everything else. Requests
// are staggered, not fired via Promise.all: bursting several concurrent
// requests at Yahoo's endpoint from the same source is the likely cause of
// the intermittent per-symbol failures this retry/stagger is compensating
// for (T3 — third-party, unofficial for this exchange, revisit if it keeps
// flaking).
export async function fetchBistQuotes(symbols: string[]): Promise<PriceQuote[]> {
  if (symbols.length === 0) return [];
  const results: (PriceQuote | null)[] = [];
  for (const symbol of symbols) {
    results.push(await fetchOne(symbol));
    if (symbols.length > 1) await sleep(REQUEST_STAGGER_MS);
  }
  return results.filter((q): q is PriceQuote => q !== null);
}
