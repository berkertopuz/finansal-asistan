import { addMonthsClamped } from "@/lib/recurrence";
import { toDateString } from "@/lib/ledger";

export type InstallmentRow = {
  occurred_at: string;
  amount: number;
  index: number;
  count: number;
};

// Splits `totalAmount` into `count` monthly rows starting at `anchorDateStr`
// (the purchase date, becomes taksit 1/N). Kuruş-exact: equal amounts except
// the last, which absorbs whatever the floor division left over — otherwise
// a series like 100/3 would drift a kuruş short of the real total.
export function buildInstallmentRows(
  totalAmount: number,
  count: number,
  anchorDateStr: string,
): InstallmentRow[] {
  const totalKurus = Math.round(totalAmount * 100);
  const baseKurus = Math.floor(totalKurus / count);
  const lastKurus = totalKurus - baseKurus * (count - 1);

  return Array.from({ length: count }, (_, i) => ({
    occurred_at: toDateString(addMonthsClamped(anchorDateStr, i)),
    amount: (i === count - 1 ? lastKurus : baseKurus) / 100,
    index: i + 1,
    count,
  }));
}
