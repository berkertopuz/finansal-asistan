import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { RecommendationList } from "@/components/recommendations/RecommendationList";
import { RefreshButton } from "@/components/recommendations/RefreshButton";

export default function OnerilerPage() {
  return (
    <div className="flex flex-1 flex-col">
      <DisclaimerBanner />
      <div className="flex flex-1 flex-col gap-4 py-6">
        <RefreshButton />
        <RecommendationList />
      </div>
    </div>
  );
}
