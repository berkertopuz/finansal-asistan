import { FixedItemsTimeline } from "@/components/ledger/FixedItemsTimeline";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";

export default async function SabitGelirlerPage() {
  const supabase = await createClient();
  const initialData = await getEntries(supabase);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="px-4 md:px-0">
        <FixedItemsTimeline kind="income" initialData={initialData} />
      </div>
      <QuickAddFAB defaultKind="income" />
    </div>
  );
}
