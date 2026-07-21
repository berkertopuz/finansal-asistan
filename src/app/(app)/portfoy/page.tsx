import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { PositionList } from "@/components/portfolio/PositionList";
import { AddPositionSheet } from "@/components/portfolio/AddPositionSheet";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPositionsWithPrices } from "@/lib/positions-data";

export default async function PortfoyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getUser();
  const initialData = user ? await getPositionsWithPrices(supabase, user.id) : [];

  return (
    <div className="flex flex-1 flex-col">
      <DisclaimerBanner />
      <div className="flex flex-1 flex-col py-6">
        <PositionList initialData={initialData} />
      </div>
      <AddPositionSheet />
    </div>
  );
}
