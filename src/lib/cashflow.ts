import type { Entry, EntryRecurrence } from "@/lib/ledger";
import { nextOccurrenceOnOrAfter } from "@/lib/recurrence";

const DAY_MS = 86_400_000;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Every occurrence of a recurring entry between rangeStart and rangeEnd
// (inclusive) — repeatedly rolls nextOccurrenceOnOrAfter forward from the
// day after the last hit. The 400-iteration cap is just a safety valve
// (weekly is the finest recurrence granularity here, so even a generous
// range never comes close).
export function occurrencesInRange(
  anchorDateStr: string,
  recurrence: EntryRecurrence,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  if (recurrence === "none") return [];

  const occurrences: Date[] = [];
  let from = rangeStart;
  for (let i = 0; i < 400; i++) {
    const occurrence = nextOccurrenceOnOrAfter(anchorDateStr, recurrence, from);
    if (!occurrence || occurrence > rangeEnd) break;
    occurrences.push(occurrence);
    from = new Date(occurrence.getTime() + DAY_MS);
  }
  return occurrences;
}

// entries is treated as a literal transaction log — every row counts once,
// signed by kind. Recurring rows contribute their historical occurred_at
// here exactly once; their *future* recurrences are handled separately by
// projectBalance, so there's no double-count.
export function currentBalance(entries: Entry[]): number {
  return entries.reduce((sum, e) => sum + (e.kind === "income" ? e.amount : -e.amount), 0);
}

export type CashFlowEvent = { entry: Entry; occurrence: Date };
export type CashFlowPoint = { date: Date; balance: number };

// Day-by-day running balance from today through `days` days out. Only
// recurring entries with a next_due_date anchor project forward (same
// precondition FixedItemsTimeline uses) — a one-off entry already happened
// (occurred_at is always "today" at creation time) and is already folded
// into the starting balance.
export function projectBalance(
  entries: Entry[],
  days: number,
  from: Date = new Date(),
): { points: CashFlowPoint[]; events: CashFlowEvent[] } {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const rangeStart = new Date(today.getTime() + DAY_MS);
  const rangeEnd = new Date(today.getTime() + days * DAY_MS);

  const events: CashFlowEvent[] = [];
  for (const entry of entries) {
    if (entry.recurrence === "none" || !entry.next_due_date) continue;
    for (const occurrence of occurrencesInRange(entry.next_due_date, entry.recurrence, rangeStart, rangeEnd)) {
      events.push({ entry, occurrence });
    }
  }
  events.sort((a, b) => a.occurrence.getTime() - b.occurrence.getTime());

  const startingBalance = currentBalance(entries);
  const points: CashFlowPoint[] = [{ date: today, balance: startingBalance }];
  let running = startingBalance;
  let eventIndex = 0;

  for (let d = 1; d <= days; d++) {
    const date = new Date(today.getTime() + d * DAY_MS);
    while (eventIndex < events.length && isSameDay(events[eventIndex].occurrence, date)) {
      const { entry } = events[eventIndex];
      running += entry.kind === "income" ? entry.amount : -entry.amount;
      eventIndex++;
    }
    points.push({ date, balance: running });
  }

  return { points, events };
}

// A second trajectory over the same `points`: what the balance would look
// like if idle cash always earned interest instead of sitting in a 0%
// checking account, applying the same income/expense events on the same
// days. Daily-compounded on the *optimized* balance (which already includes
// previously accrued interest), not on the naive one — a payment still
// withdraws the same principal either way, but the gap between the two
// lines grows over time, which is the whole point: it's a direct visual
// answer to "where could this money end up" instead of a per-payment
// "days since today" estimate (that broke down for anything more than one
// cycle out — a bill 3 months away isn't money that's been idle since
// today; it's next month's income, paid on schedule, same as every month).
export function projectOptimizedBalance(
  points: CashFlowPoint[],
  annualRatePercent: number,
): CashFlowPoint[] {
  const dailyRate = annualRatePercent / 100 / 365;
  const optimized: CashFlowPoint[] = [{ date: points[0].date, balance: points[0].balance }];

  for (let i = 1; i < points.length; i++) {
    const eventDelta = points[i].balance - points[i - 1].balance;
    const previous = optimized[i - 1].balance;
    optimized.push({ date: points[i].date, balance: previous + previous * dailyRate + eventDelta });
  }

  return optimized;
}
