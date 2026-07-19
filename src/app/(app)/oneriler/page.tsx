import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { RecommendationList } from "@/components/recommendations/RecommendationList";
import { RefreshButton } from "@/components/recommendations/RefreshButton";
import { createClient } from "@/lib/supabase/server";
import { getRecommendations } from "@/lib/recommendations-data";

export default async function OnerilerPage() {
  const supabase = await createClient();
  const initialData = await getRecommendations(supabase);

  return (
    <div className="flex flex-1 flex-col">
      <DisclaimerBanner />
      <div className="flex flex-1 flex-col gap-4 py-6">
        <RefreshButton />
        <RecommendationList initialData={initialData} />
      </div>
    </div>
  );
}
