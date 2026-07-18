import { SurplusCard } from "@/components/dashboard/SurplusCard";
import { LatestSignalsStrip } from "@/components/dashboard/LatestSignalsStrip";
import { StaleDataBadge } from "@/components/StaleDataBadge";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col gap-6 py-6">
      <div className="flex flex-col gap-2 px-4">
        <SurplusCard />
        <StaleDataBadge />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-medium text-foreground">Son sinyaller</h2>
        <DisclaimerBanner />
        <LatestSignalsStrip />
      </div>

      <QuickAddFAB />
    </div>
  );
}
