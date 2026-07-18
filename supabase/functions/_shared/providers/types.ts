export type AssetClass = "bist" | "gold" | "crypto" | "fx";
export type PriceSource = "binance" | "tcmb" | "binance_cross" | "bist_provider";

export type PriceQuote = {
  assetClass: AssetClass;
  symbol: string;
  price: number;
  currency: "TRY" | "USD";
  source: PriceSource;
};
