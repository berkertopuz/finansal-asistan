// "manual" is for anything with no live price (land, a house, ...) — no
// symbol validation, no market_snapshots lookup, no recommendation
// generation is ever attempted for it (see src/lib/actions/positions.ts and
// src/lib/positions-data.ts).
export type AssetClass = "bist" | "gold" | "crypto" | "fx" | "manual";

export type PositionWithPrice = {
  id: string;
  asset_class: AssetClass;
  symbol: string;
  quantity: number;
  avg_cost_try: number;
  opened_at: string;
  latest_price_try: number | null;
  latest_price_fetched_at: string | null;
  latest_price_source: string | null;
  pl_try: number | null;
  pl_percent: number | null;
  // Whether this position has a linked entries row (kind="investment")
  // recording that its purchase came out of tracked cash — see
  // src/lib/positions-data.ts and src/lib/actions/positions.ts.
  funded_from_cash: boolean;
  signal: {
    signal: "al" | "tut" | "sat";
    confidence: "T1" | "T2" | "T3";
    body: string;
    created_at: string;
  } | null;
};

// Labels come from messages/{locale}.json ("assetClass" namespace) —
// components resolve via useTranslations, keyed by these values.
export const ASSET_CLASSES: AssetClass[] = ["bist", "gold", "crypto", "fx", "manual"];

// Must match GOLD_SYMBOL / SUPPORTED_FX_SYMBOL in
// supabase/functions/validate-symbol/index.ts — only one symbol is
// supported per asset class, so the form auto-assigns it instead of
// asking the user to type it (and possibly get it wrong).
export const FIXED_SYMBOLS: Partial<Record<AssetClass, string>> = {
  gold: "XAU_GRAM",
  fx: "USDTRY",
};
