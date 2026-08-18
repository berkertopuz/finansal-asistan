import { getTranslations } from "next-intl/server";
import { SurplusCard } from "@/components/dashboard/SurplusCard";
import { HeroActions } from "@/components/dashboard/HeroActions";
import { CardsCarousel } from "@/components/dashboard/CardsCarousel";
import { LatestSignalsStrip } from "@/components/dashboard/LatestSignalsStrip";
import { StaleDataBadge } from "@/components/StaleDataBadge";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { createClient } from "@/lib/supabase/server";
import { getRecommendations } from "@/lib/recommendations-data";

export default async function Home() {
  const supabase = await createClient();
  const initialData = await getRecommendations(supabase);
  const t = await getTranslations("home");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 py-6">
      {/* Two columns on desktop (hero+actions beside the cards carousel)
          instead of one narrow centered strip with the sidebar's leftover
          width sitting empty. md:items-start on purpose — stretching the
          cards column to match the (usually taller) hero column just turned
          the leftover space into an obviously oversized, mostly-empty box,
          which read worse than letting the two columns size independently. */}
      <div className="grid gap-6 px-4 md:grid-cols-[3fr_2fr] md:items-start">
        <div className="flex flex-col gap-4">
          <SurplusCard />
          <HeroActions />
        </div>
        <CardsCarousel />
      </div>

      {/* One card (same rounded-3xl/ring language as the hero and Kartlarım),
          not a loose stack of independently-styled pieces — header,
          freshness note, disclaimer, and signal list all sit inside a single
          shared boundary instead of floating on the page background, which
          is what made this section read as bolted onto the rest of the
          page. StaleDataBadge/DisclaimerBanner's own px-4 is dropped here
          (both are Home-only) since this card's own p-4/p-6 is now the one
          source of horizontal inset for everything inside it. */}
      <div className="px-4">
        <div className="flex flex-col gap-4 rounded-3xl bg-card p-4 text-card-foreground shadow-sm ring-1 ring-foreground/10 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">{t("latestSignalsTitle")}</h2>
            <StaleDataBadge />
          </div>
          <DisclaimerBanner className="rounded-xl border-b-0" />
          <LatestSignalsStrip initialData={initialData} />
        </div>
      </div>
    </div>
  );
}
