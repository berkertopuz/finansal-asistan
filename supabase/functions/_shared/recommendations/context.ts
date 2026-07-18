import { fetchCryptoQuotes, fetchGoldGramTRY, fetchUsdtTryRate } from "../providers/binance.ts";
import { fetchUsdTryFromTcmb } from "../providers/tcmb.ts";
import { fetchBistQuotes } from "../providers/bist.ts";
import type { PriceQuote } from "../providers/types.ts";
import type { NewsContextItem } from "./prompts.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type LiveSnapshot = PriceQuote & { id: string; fetchedAt: string };

// Live-fetches every requested symbol right now — not a read of whatever
// poll-prices last cached. CLAUDE.md rule 5: every price entering the LLM
// context comes from a live API call in the SAME request cycle. Also
// writes each quote to market_snapshots, both to keep the shared table
// current and to get a real row id for recommendations.snapshot_ids
// provenance.
export async function assembleLiveSnapshots(
  supabaseAdmin: AdminClient,
  wanted: { asset_class: string; symbol: string }[],
): Promise<{ snapshots: LiveSnapshot[]; unavailable: string[] }> {
  const quotes: PriceQuote[] = [];
  const unavailable = new Set<string>();
  let usdtTry: number | null = null;

  const cryptoSymbols = wanted.filter((w) => w.asset_class === "crypto").map((w) => w.symbol);
  if (cryptoSymbols.length) {
    try {
      usdtTry = await fetchUsdtTryRate();
      quotes.push(...(await fetchCryptoQuotes(cryptoSymbols)));
    } catch {
      unavailable.add("crypto");
    }
  }

  if (wanted.some((w) => w.asset_class === "gold")) {
    try {
      usdtTry ??= await fetchUsdtTryRate();
      quotes.push(await fetchGoldGramTRY(usdtTry));
    } catch {
      unavailable.add("gold");
    }
  }

  if (wanted.some((w) => w.asset_class === "fx")) {
    try {
      const usdTry = await fetchUsdTryFromTcmb();
      quotes.push({ assetClass: "fx", symbol: "USDTRY", price: usdTry, currency: "TRY", source: "tcmb" });
    } catch {
      try {
        usdtTry ??= await fetchUsdtTryRate();
        quotes.push({
          assetClass: "fx",
          symbol: "USDTRY",
          price: usdtTry,
          currency: "TRY",
          source: "binance_cross",
        });
      } catch {
        unavailable.add("fx");
      }
    }
  }

  const bistSymbols = wanted.filter((w) => w.asset_class === "bist").map((w) => w.symbol);
  if (bistSymbols.length) {
    try {
      const bistQuotes = await fetchBistQuotes(bistSymbols);
      if (bistQuotes.length === 0) unavailable.add("bist");
      quotes.push(...bistQuotes);
    } catch {
      unavailable.add("bist");
    }
  }

  if (quotes.length === 0) return { snapshots: [], unavailable: [...unavailable] };

  const { data, error } = await supabaseAdmin
    .from("market_snapshots")
    .insert(
      quotes.map((q) => ({
        asset_class: q.assetClass,
        symbol: q.symbol,
        price: q.price,
        currency: q.currency,
        source: q.source,
      })),
    )
    .select("id, asset_class, symbol, price, currency, source, fetched_at");

  if (error || !data) {
    return { snapshots: [], unavailable: [...new Set([...unavailable, ...quotes.map((q) => q.assetClass)])] };
  }

  const snapshots: LiveSnapshot[] = data.map(
    (row: {
      id: string;
      asset_class: PriceQuote["assetClass"];
      symbol: string;
      price: number;
      currency: PriceQuote["currency"];
      source: PriceQuote["source"];
      fetched_at: string;
    }) => ({
      id: row.id,
      assetClass: row.asset_class,
      symbol: row.symbol,
      price: Number(row.price),
      currency: row.currency,
      source: row.source,
      fetchedAt: row.fetched_at,
    }),
  );

  return { snapshots, unavailable: [...unavailable] };
}

export async function fetchRecentNews(supabaseAdmin: AdminClient, hours = 48): Promise<NewsContextItem[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("news_items")
    .select("headline, source, url, published_at")
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(60);

  return (
    (data as { headline: string; source: string; url: string | null; published_at: string }[]) ?? []
  ).map((n) => ({ baslik: n.headline, kaynak: n.source, url: n.url, tarih: n.published_at }));
}

export function dedupeSymbols<T extends { asset_class: string; symbol: string }>(items: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(`${item.asset_class}:${item.symbol}`, item);
  return [...byKey.values()];
}
