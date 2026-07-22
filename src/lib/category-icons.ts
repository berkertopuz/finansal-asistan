import {
  Banknote,
  Briefcase,
  Car,
  Home,
  type LucideIcon,
  MoreHorizontal,
  PartyPopper,
  Receipt,
  Repeat,
  ShoppingCart,
  UtensilsCrossed,
} from "lucide-react";
import { DEFAULT_CATEGORY, isPresetCategory } from "@/lib/ledger";

// Purely categorization colors (which category is this?), not the app's
// signal palette (buy/caution/hold — what should you do about it?) — using
// a varied hue per category here doesn't reintroduce alarm-red anywhere,
// it's a different kind of color than CLAUDE.md's signal rule is about.
const CATEGORY_ICON: Record<string, LucideIcon> = {
  "maaş": Banknote,
  serbest: Briefcase,
  kira: Home,
  fatura: Receipt,
  abonelik: Repeat,
  market: ShoppingCart,
  yemek: UtensilsCrossed,
  "eğlence": PartyPopper,
  "ulaşım": Car,
  "diğer": MoreHorizontal,
};

const CATEGORY_COLOR_CLASS: Record<string, string> = {
  "maaş": "bg-primary/10 text-primary",
  serbest: "bg-violet-500/10 text-violet-500",
  kira: "bg-blue-500/10 text-blue-500",
  fatura: "bg-orange-500/10 text-orange-500",
  abonelik: "bg-sky-500/10 text-sky-500",
  market: "bg-amber-500/10 text-amber-500",
  yemek: "bg-rose-500/10 text-rose-500",
  "eğlence": "bg-pink-500/10 text-pink-500",
  "ulaşım": "bg-indigo-500/10 text-indigo-500",
  "diğer": "bg-muted text-muted-foreground",
};

// Mirrors categoryLabel()'s fallback-to-diğer pattern (src/lib/ledger.ts) —
// entry.category is always one of ENTRY_CATEGORIES in practice, but this
// guards against legacy/unknown values the same way.
export function categoryIcon(category: string | null): {
  Icon: LucideIcon;
  colorClassName: string;
} {
  const value = category && isPresetCategory(category) ? category : DEFAULT_CATEGORY;
  return { Icon: CATEGORY_ICON[value], colorClassName: CATEGORY_COLOR_CLASS[value] };
}
