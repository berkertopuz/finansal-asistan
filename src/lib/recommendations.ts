export type Recommendation = {
  id: string;
  kind: "buy_suggestion" | "position_signal";
  asset_class: "bist" | "gold" | "crypto" | "fx";
  symbol: string;
  signal: "al" | "tut" | "sat" | null;
  confidence: "T1" | "T2" | "T3";
  body: string;
  locale: "tr" | "en";
  cited_headline: string;
  cited_url: string | null;
  event_id: string | null;
  created_at: string;
  expires_at: string | null;
};

// Label text lives in messages/{locale}.json ("assetClass", "recommendations"
// namespaces) — components resolve it via useTranslations, keyed by these
// values, so both Turkish and English labels come from one source of truth.
export const SIGNAL_VALUES = ["al", "tut", "sat"] as const;
export const CONFIDENCE_VALUES = ["T1", "T2", "T3"] as const;
export const ASSET_CLASS_VALUES = ["bist", "gold", "crypto", "fx"] as const;

// Shared by RecommendationCard and PositionCard's SignalBadge — a Tailwind
// class combo, not translatable text, so it stays a plain value map.
export const SIGNAL_TONE: Record<NonNullable<Recommendation["signal"]>, string> = {
  al: "text-signal-buy-foreground bg-signal-buy-bg",
  tut: "text-signal-hold-foreground bg-signal-hold-bg",
  sat: "text-signal-caution-foreground bg-signal-caution-bg",
};
