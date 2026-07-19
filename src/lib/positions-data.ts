import type { SupabaseClient } from "@supabase/supabase-js";
import type { PositionWithPrice } from "@/lib/portfolio";

type PositionRow = {
  id: string;
  asset_class: "bist" | "gold" | "crypto" | "fx";
  symbol: string;
  quantity: number;
  avg_cost_try: number;
  opened_at: string;
};

type SnapshotRow = {
  asset_class: string;
  symbol: string;
  price: number;
  currency: "TRY" | "USD";
  source: string;
  fetched_at: string;
};

type SignalRow = {
  asset_class: string;
  symbol: string;
  signal: "al" | "tut" | "sat";
  confidence: "T1" | "T2" | "T3";
  body: string;
  created_at: string;
};

function latestBySymbol<T extends { asset_class: string; symbol: string }>(
  rows: T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.asset_class}:${row.symbol}`;
    if (!map.has(key)) map.set(key, row); // rows are pre-sorted newest-first
  }
  return map;
}

// Shared by the /api/positions route (client SWR refetches) and the
// server-rendered /portfoy page (initial SWR fallbackData, so first paint
// skips the loading skeleton entirely) — one source of truth for the
// price/signal join logic (docs/phase1-plan.md E.c — "tüm fiyatlar tek SWR
// key'de").
export async function getPositionsWithPrices(
  supabase: SupabaseClient,
  userId: string,
): Promise<PositionWithPrice[]> {
  const { data: positionsData } = await supabase
    .from("portfolio_positions")
    .select("id, asset_class, symbol, quantity, avg_cost_try, opened_at")
    .order("created_at", { ascending: false });

  const positions = (positionsData as PositionRow[]) ?? [];
  if (positions.length === 0) return [];

  const hasCrypto = positions.some((p) => p.asset_class === "crypto");

  const [{ data: snapshotsData }, { data: signalsData }] = await Promise.all([
    supabase
      .from("market_snapshots")
      .select("asset_class, symbol, price, currency, source, fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(300),
    supabase
      .from("recommendations")
      .select("asset_class, symbol, signal, confidence, body, created_at")
      .eq("user_id", userId)
      .eq("kind", "position_signal")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const latestSnapshots = latestBySymbol((snapshotsData as SnapshotRow[]) ?? []);
  const latestSignals = latestBySymbol((signalsData as SignalRow[]) ?? []);
  const usdTrySnapshot = hasCrypto ? latestSnapshots.get("fx:USDTRY") : undefined;

  return positions.map((p) => {
    const key = `${p.asset_class}:${p.symbol}`;
    const snapshot = latestSnapshots.get(key);
    const signal = latestSignals.get(key);

    let priceTry: number | null = null;
    if (snapshot) {
      priceTry =
        snapshot.currency === "TRY"
          ? Number(snapshot.price)
          : usdTrySnapshot
            ? Number(snapshot.price) * Number(usdTrySnapshot.price)
            : null;
    }

    const costTotal = Number(p.avg_cost_try) * Number(p.quantity);
    const marketValue = priceTry !== null ? priceTry * Number(p.quantity) : null;
    const plTry = marketValue !== null ? marketValue - costTotal : null;
    const plPercent =
      priceTry !== null && Number(p.avg_cost_try) > 0
        ? (priceTry - Number(p.avg_cost_try)) / Number(p.avg_cost_try)
        : null;

    return {
      id: p.id,
      asset_class: p.asset_class,
      symbol: p.symbol,
      quantity: Number(p.quantity),
      avg_cost_try: Number(p.avg_cost_try),
      opened_at: p.opened_at,
      latest_price_try: priceTry,
      latest_price_fetched_at: snapshot?.fetched_at ?? null,
      latest_price_source: snapshot?.source ?? null,
      pl_try: plTry,
      pl_percent: plPercent,
      signal: signal
        ? {
            signal: signal.signal,
            confidence: signal.confidence,
            body: signal.body,
            created_at: signal.created_at,
          }
        : null,
    };
  });
}
