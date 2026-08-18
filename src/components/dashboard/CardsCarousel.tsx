"use client";

import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { CreditCard as CardIcon } from "lucide-react";
import type { CreditCard } from "@/lib/credit-cards-data";
import type { Entry } from "@/lib/ledger";
import { creditCardDebtBalance } from "@/lib/cashflow";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

// Same SWR keys CreditCardsManager.tsx already uses (src/app/(app)/defter/giderler/kartlar) —
// sharing them means navigating there from here hits a warm cache instead of
// refetching.
const CARDS_KEY = "/api/credit-cards";
const cardsFetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch credit cards");
    return res.json();
  });

const ENTRIES_KEY = "/api/entries";
const entriesFetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch entries");
    return res.json();
  });

// Ana Sayfa'ya eklenen kısayol: Kartlarım'a gitmeden borç durumunu görmek
// için (defter/giderler/kartlar zaten var, bu onun yerini almaz, sadece
// önizlemesi). Hiç kart yoksa hiçbir şey render etmez.
export function CardsCarousel() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("creditCards");
  const { data: cards } = useSWR<CreditCard[]>(CARDS_KEY, cardsFetcher);
  const { data: entries } = useSWR<Entry[]>(ENTRIES_KEY, entriesFetcher);

  if (!cards || cards.length === 0) return null;

  return (
    // A card shell (matching the hero's rounded-3xl/ring) sized to its own
    // content — deliberately not stretched to match the hero column's
    // height (see page.tsx's md:items-start): a taller box just made the
    // empty space more obvious, not less.
    <div className="flex flex-col gap-3 rounded-3xl bg-card p-4 text-card-foreground shadow-sm ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
        <Link
          href="/defter/giderler/kartlar"
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          {t("viewAll")}
        </Link>
      </div>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1">
        {cards.map((card) => {
          const debt = entries ? creditCardDebtBalance(entries, card.id) : 0;
          return (
            <Link
              key={card.id}
              href="/defter/giderler/kartlar"
              className={cn(
                "flex w-36 shrink-0 snap-start flex-col justify-between gap-3 rounded-2xl p-4",
                "bg-gradient-to-br from-foreground/90 to-foreground text-background",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-xs font-medium">{card.name}</span>
                <CardIcon className="size-4 shrink-0 opacity-70" />
              </div>
              <div>
                <p className="text-[10px] opacity-70">{t("currentDebtLabel")}</p>
                <p className="text-sm font-semibold">{formatCurrency(debt, locale)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
