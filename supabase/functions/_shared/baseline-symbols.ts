// Always polled regardless of holdings: XU100/USDTRY feed detect-events'
// market-wide comparisons, and one representative gold/crypto symbol keeps
// the buy-suggestion engine (section 6) able to cover all 4 asset classes
// even for a user who holds nothing yet (docs/phase1-plan.md D.2).
export const BASELINE_SYMBOLS: { asset_class: string; symbol: string }[] = [
  { asset_class: "bist", symbol: "XU100" },
  { asset_class: "gold", symbol: "XAU_GRAM" },
  { asset_class: "crypto", symbol: "BTC" },
  { asset_class: "fx", symbol: "USDTRY" },
];
