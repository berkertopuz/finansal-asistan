import { SurplusCard } from "@/components/dashboard/SurplusCard";
import { HeroActions } from "@/components/dashboard/HeroActions";
import { CardsCarousel } from "@/components/dashboard/CardsCarousel";

// Yatırım sinyali şeridi buradan kaldırıldı — Öneriler motoru v2'ye ertelendi
// (bkz. src/lib/nav-items.ts). StaleDataBadge ve DisclaimerBanner de birlikte
// gitti: ikisi de o şeride aitti. SPK uyarısı (CLAUDE.md kural 2) "her ÖNERİ
// yüzeyinin en üstünde" zorunlu — ana sayfada artık bir yatırım önerisi
// gösterilmiyor, dolayısıyla burada yeri yok. Portföy sayfasında duruyor.
export default async function Home() {
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
    </div>
  );
}
