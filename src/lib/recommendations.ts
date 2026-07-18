export type Recommendation = {
  id: string;
  kind: "buy_suggestion" | "position_signal";
  asset_class: "bist" | "gold" | "crypto" | "fx";
  symbol: string;
  signal: "al" | "tut" | "sat" | null;
  confidence: "T1" | "T2" | "T3";
  body_tr: string;
  cited_headline: string;
  cited_url: string | null;
  event_id: string | null;
  created_at: string;
  expires_at: string | null;
};

// Softened language (docs/phase1-plan.md F.2) — never a blunt "SAT" button.
export const SIGNAL_LABELS: Record<NonNullable<Recommendation["signal"]>, string> = {
  al: "Alım değerlendirilebilir",
  tut: "Tutmaya devam edilebilir",
  sat: "Satış değerlendirilebilir",
};

// Shared by RecommendationCard and PositionCard's SignalBadge.
export const SIGNAL_TONE: Record<NonNullable<Recommendation["signal"]>, string> = {
  al: "text-signal-buy-foreground bg-signal-buy-bg",
  tut: "text-signal-hold-foreground bg-signal-hold-bg",
  sat: "text-signal-caution-foreground bg-signal-caution-bg",
};

export const CONFIDENCE_LABELS: Record<Recommendation["confidence"], string> = {
  T1: "yüksek güven",
  T2: "orta güven",
  T3: "düşük güven",
};

export const CONFIDENCE_HINTS: Record<Recommendation["confidence"], string> = {
  T1: "Fiyat ve haber akışı net destekliyor.",
  T2: "Haber akışı destekliyor ama makro belirsizlik var.",
  T3: "Sınırlı veriyle üretildi, temkinli değerlendir.",
};

export const ASSET_CLASS_LABELS: Record<Recommendation["asset_class"], string> = {
  bist: "BIST",
  gold: "Altın",
  crypto: "Kripto",
  fx: "Döviz",
};
