import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { PositionList } from "@/components/portfolio/PositionList";
import { AddPositionSheet } from "@/components/portfolio/AddPositionSheet";

export default function PortfoyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <DisclaimerBanner />
      <div className="flex flex-1 flex-col py-6">
        <PositionList />
      </div>
      <AddPositionSheet />
    </div>
  );
}
