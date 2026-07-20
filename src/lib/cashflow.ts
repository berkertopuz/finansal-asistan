import type { Entry, EntryRecurrence } from "@/lib/ledger";
import { nextOccurrenceOnOrAfter } from "@/lib/recurrence";

const DAY_MS = 86_400_000;

// Turkey withholds tax on TL deposit interest at the source ("stopaj") —
// 17.5% for the kind of daily/short-term interest account this feature is
// modeling. Every interest estimate below is net of this, so the numbers
// shown are what actually lands in the account, not the bank's quoted
// gross rate.
export const WITHHOLDING_TAX_RATE = 0.175;

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
  const dailyRate = (annualRatePercent / 100 / 365) * (1 - WITHHOLDING_TAX_RATE);
  const optimized: CashFlowPoint[] = [{ date: points[0].date, balance: points[0].balance }];

  for (let i = 1; i < points.length; i++) {
    const eventDelta = points[i].balance - points[i - 1].balance;
    const previous = optimized[i - 1].balance;
    optimized.push({ date: points[i].date, balance: previous + previous * dailyRate + eventDelta });
  }

  return optimized;
}

// How many days "this cycle" actually ran for a given occurrence — the
// window the user could realistically have held the payment amount in
// interest before it was due. The assumption (confirmed against a real
// daily-interest-account quote): the money becomes available at the start
// of the period — payday, effectively — and sits there until the due date
// within that same period. So a bill due on the 7th has a 7-day window
// (since the 1st), not "the ~31 days in the whole month" (that was the bug:
// it overstated a 1-week-scale gain by ~4-5x). Bounded to one cycle no
// matter how far the occurrence itself is from today — a bill 3 months out
// isn't 3 months of held cash, it's next month's bill, same window as
// every other month.
export function periodLengthDays(recurrence: EntryRecurrence, occurrence: Date): number {
  if (recurrence === "weekly") return 7;
  if (recurrence === "yearly") {
    const startOfYear = new Date(occurrence.getFullYear(), 0, 1);
    return Math.round((occurrence.getTime() - startOfYear.getTime()) / DAY_MS) + 1;
  }
  // monthly: days since the 1st of the occurrence's own month.
  return occurrence.getDate();
}

function netSimpleInterest(amount: number, days: number, annualRatePercent: number): number {
  const gross = amount * (annualRatePercent / 100) * (days / 365);
  return gross * (1 - WITHHOLDING_TAX_RATE);
}

// Simple-interest estimate, net of withholding tax, for holding `amount`
// for one recurrence cycle (see periodLengthDays) instead of paying it out
// as soon as it's available — deliberately not compounded, this is a
// back-of-envelope estimate the UI labels as such, not a precise yield.
// Checked against a real "günlük faiz" account quote: ₺40,000 held 7 days
// at 30%/yr nets ~₺189 after 17.5% stopaj, which this formula reproduces.
export function periodFloatGain(
  amount: number,
  recurrence: EntryRecurrence,
  occurrence: Date,
  annualRatePercent: number,
): number {
  return netSimpleInterest(amount, periodLengthDays(recurrence, occurrence), annualRatePercent);
}

// The "vadeye yatırsaydın" scenario: a lump sum locked for the whole term,
// paid out once at maturity — unlike the daily-account line above, which
// compounds continuously and is withdrawable any time. Simple (not
// compounded) interest is the correct model for a single term: that's how a
// real vadeli mevduat actually pays.
export function termDepositGain(amount: number, termDays: number, annualRatePercent: number): number {
  return netSimpleInterest(amount, termDays, annualRatePercent);
}

// The EVDS series this rate comes from is specifically the ~1-month time
// deposit average — nobody actually locks money into a single vadeli for
// 180 or 365 days at that rate. In practice you'd let it mature and renew
// ("rollover") into a new term at whatever the rate is then. We don't know
// future rates, so the best available assumption is holding today's rate
// constant across renewals — but *reinvesting* the net interest each cycle
// (rather than one flat simple-interest calc for the whole window) is what
// makes a long horizon behave like a real, renewed vadeli instead of
// understating it against the daily line's continuous compounding.
const DEFAULT_TERM_LENGTH_DAYS = 30;

export function termDepositGainWithRollover(
  amount: number,
  totalDays: number,
  annualRatePercent: number,
  termLengthDays: number = DEFAULT_TERM_LENGTH_DAYS,
): number {
  let principal = amount;
  let remaining = totalDays;
  while (remaining > 0) {
    const cycleDays = Math.min(termLengthDays, remaining);
    principal += netSimpleInterest(principal, cycleDays, annualRatePercent);
    remaining -= cycleDays;
  }
  return principal - amount;
}

// The largest amount that's never needed during the projection window — the
// portion of the balance that could safely be locked away in a term deposit
// without risking an early withdrawal (which would forfeit the accrued
// interest on a real vadeli mevduat). Anything above this floor is "idle"
// for the whole window; anything below it is needed to cover expenses along
// the way and has to stay liquid.
export function safeToLockAmount(points: CashFlowPoint[]): number {
  return Math.min(...points.map((p) => p.balance));
}

// A standard personal-finance heuristic: keep a few months of ordinary
// expenses liquid before locking any of it away, as a buffer against an
// expense the recurring schedule doesn't predict (the projection only knows
// about entries already in the ledger — an emergency isn't one of them).
// 3 months is the low end of the commonly cited 3-6 month range.
export const EMERGENCY_FUND_MONTHS = 3;

// Recurring outflows (expenses + subscriptions) normalized to a monthly
// figure regardless of their own recurrence — this is a steady-state "burn
// rate", not a projection over any particular window, so it's independent
// of the days/range the user has selected.
export function estimateMonthlyExpenseBurn(entries: Entry[]): number {
  const DAYS_PER_MONTH = 365 / 12;
  return entries.reduce((sum, e) => {
    if (e.kind === "income" || e.recurrence === "none") return sum;
    if (e.recurrence === "weekly") return sum + e.amount * (DAYS_PER_MONTH / 7);
    if (e.recurrence === "yearly") return sum + e.amount / 12;
    return sum + e.amount; // monthly
  }, 0);
}
