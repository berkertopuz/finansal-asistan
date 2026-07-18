export type AssetClass = "bist" | "gold" | "crypto" | "fx";

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
  signal: {
    signal: "al" | "tut" | "sat";
    confidence: "T1" | "T2" | "T3";
    body_tr: string;
    created_at: string;
  } | null;
};

export const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "bist", label: "BIST" },
  { value: "gold", label: "Altın" },
  { value: "crypto", label: "Kripto" },
  { value: "fx", label: "Döviz" },
];
