import type { Entry, EntryRecurrence } from "@/lib/ledger";
import { toDateString } from "@/lib/ledger";
import { clampMonthDay, nextOccurrenceOnOrAfter } from "@/lib/recurrence";

const DAY_MS = 86_400_000;

// Turkey withholds tax on TL deposit interest at the source ("stopaj") —
// 17.5% for the kind of daily/short-term interest account this feature is
// modeling. Every interest estimate below is net of this, so the numbers
// shown are what actually lands in the account, not the bank's quoted
// gross rate.
export const WITHHOLDING_TAX_RATE = 0.175;

// A charge on a card is a debt, not a cash event — the bank balance
// doesn't drop when the purchase happens, only when the card bill is
// actually paid (a separate kind='card_payment' entry, created by
// src/lib/actions/credit-cards.ts's payCreditCardDebt). currentBalance and
// projectBalance both skip these entirely when computing cash; they only
// count toward creditCardDebtBalance below. income/investment can never
// carry a credit_card_id (DB CHECK), so this only ever matters for
// expense/subscription.
function isCardDebt(entry: Pick<Entry, "kind" | "credit_card_id">): boolean {
  return (entry.kind === "expense" || entry.kind === "subscription") && entry.credit_card_id !== null;
}

// A card's running debt as of `asOf`: everything charged to it minus
// everything paid toward it, both only counting what's already happened
// (occurred_at <= asOf) — mirrors currentBalance's own cutoff logic below.
// Shown on the Kartlar page (src/components/statements/CreditCardsManager.tsx)
// so the user always knows what they actually owe, independent of the cash
// flow chart (which only ever shows a *projection* of a future payment, see
// projectBalance — this is the real, current number).
export function creditCardDebtBalance(entries: Entry[], cardId: string, asOf: Date = new Date()): number {
  const cutoff = toDateString(new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
  return entries.reduce((sum, e) => {
    // Recurring templates aren't transactions themselves (same reasoning as
    // currentBalance below) — their materialized concrete rows are what
    // actually carry a real occurred_at and credit_card_id to count here.
    if (e.recurrence !== "none" || e.credit_card_id !== cardId || e.occurred_at > cutoff) return sum;
    if (isCardDebt(e)) return sum + e.amount;
    if (e.kind === "card_payment") return sum - e.amount;
    return sum;
  }, 0);
}

// A card's billing cycle, generalized: charges cut off on statement_day and
// bill together on payment_day. A charge dated after this month's cutoff
// belongs to *next* month's statement, not this one — without that check, a
// subscription drawing on (say) the 18th with a card that cuts on the 13th
// and pays on the 23rd would compute a cash_out_at of the 23rd in the same
// month as the charge, which is only 5 days after the charge but actually
// belongs to the cutoff a month later (charges the 14th-13th of next month
// pay on next month's 23rd). payment_day < statement_day (a cutoff late in
// the month, paid early next month, e.g. cuts the 25th, pays the 5th) is
// handled the same way: the payment itself always lands in the month after
// whichever month the statement cut in.
export function nextCardPaymentDate(chargeDate: Date, statementDay: number, paymentDay: number): Date {
  const monthOffset =
    (chargeDate.getDate() > statementDay ? 1 : 0) + (paymentDay < statementDay ? 1 : 0);
  const totalMonthIndex = chargeDate.getMonth() + monthOffset;
  const year = chargeDate.getFullYear() + Math.floor(totalMonthIndex / 12);
  const month = ((totalMonthIndex % 12) + 12) % 12;
  return clampMonthDay(year, month, paymentDay);
}

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
// signed by kind. Recurring templates (recurrence <> 'none') are excluded:
// they're just the rule that generates real per-period rows (see
// src/lib/recurrence-materialize.ts), not a transaction themselves — a
// template row's `amount` would otherwise double-count alongside the
// concrete rows it already produced. projectBalance handles *future*
// recurrences separately, from the templates directly.
//
// A concrete row dated in the future (occurred_at > from) is excluded too —
// it hasn't happened yet from the caller's point of view. This used to be a
// non-issue because a one-off row's occurred_at was, in practice, always
// "today" (the form defaulted to it and nothing else produced concrete rows
// ahead of time). Taksit (src/lib/installments.ts) broke that assumption on
// purpose: it eagerly creates every future month's row up front, so without
// this guard, adding a 12-installment purchase would drop today's balance by
// the *entire* total instead of just the first installment. projectBalance
// below is what picks these future rows up as scheduled events instead.
export function currentBalance(entries: Entry[], from: Date = new Date()): number {
  const today = toDateString(new Date(from.getFullYear(), from.getMonth(), from.getDate()));
  return entries.reduce((sum, e) => {
    if (e.recurrence !== "none" || e.occurred_at > today) return sum;
    if (isCardDebt(e)) return sum; // debt, not cash — see isCardDebt above
    return sum + (e.kind === "income" ? e.amount : -e.amount);
  }, 0);
}

export type CashFlowEvent = { entry: Entry; occurrence: Date; isProjected?: boolean };
export type CashFlowPoint = { date: Date; balance: number };
export type CreditCardCycleInfo = { id: string; statement_day: number; payment_day: number };

// Builds the synthetic Entry a projected card-payment event is displayed
// as — every field beyond kind/amount/credit_card_id/occurred_at is inert
// (never read for a projected event), but the type is shared with real rows
// so the chart/tooltip code in CashFlowTimeline.tsx doesn't need a second
// shape to handle.
function projectedCardPaymentEntry(cardId: string, paymentDate: Date, amount: number): Entry {
  return {
    id: `projected-card-payment-${cardId}-${toDateString(paymentDate)}`,
    kind: "expense",
    amount,
    currency: "TRY",
    category: null,
    description: null,
    recurrence: "none",
    next_due_date: null,
    occurred_at: toDateString(paymentDate),
    credit_card_id: cardId,
    created_at: "",
    template_id: null,
    portfolio_position_id: null,
    installment_group_id: null,
    installment_index: null,
    installment_count: null,
  };
}

// Day-by-day running balance from today through `days` days out. Recurring
// entries project forward from their next_due_date anchor (same
// precondition FixedItemsTimeline uses); concrete (recurrence='none')
// entries project forward from their own occurred_at if that's still ahead
// of `from` — a plain one-off entry's occurred_at is "today" in practice
// (already folded into the starting balance, nothing to project), but a
// taksit installment's is a real future month, so it needs the same
// treatment as a recurring occurrence.
//
// `cards` (optional — pass [] or omit if the caller doesn't have credit
// card data handy, e.g. a unit test) drives one more thing: a *projected*
// cash-out event for card debt that hasn't been paid yet. A card-tagged
// expense/subscription never appears as a cash event on its own (see
// isCardDebt above — it's a debt, not a payment) — without this, the chart
// would never show that debt leaving cash at all, understating every future
// dip, including the near-term one (a charge added *today* still needs to
// show up — see the debtSoFar step below). This can only ever be an
// estimate (we don't know if/how much the user will actually pay), and it
// can never double-count against a real card_payment already logged: every
// future charge is bucketed by its own cycle (nextCardPaymentDate), and
// whatever's still owed as of today is computed via creditCardDebtBalance,
// which already nets out any payment the user made.
export function projectBalance(
  entries: Entry[],
  days: number,
  from: Date = new Date(),
  cards: CreditCardCycleInfo[] = [],
): { points: CashFlowPoint[]; events: CashFlowEvent[] } {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const rangeStart = new Date(today.getTime() + DAY_MS);
  const rangeEnd = new Date(today.getTime() + days * DAY_MS);

  // (template_id, occurred_at) pairs that already have a real materialized
  // row — materializeDueOccurrences' 2-year horizon means every occurrence
  // within any projection range here already exists as one of these by the
  // time this data is fetched (see src/lib/entries-data.ts). Without this,
  // the template branch below would project the exact same occurrence a
  // second time, doubling that day's impact on the balance (same dedup
  // EntryTable.tsx's plannedRows already does, for the same reason).
  const existingOccurrences = new Set(
    entries.filter((e) => e.template_id).map((e) => `${e.template_id}:${e.occurred_at}`),
  );

  const events: CashFlowEvent[] = [];
  for (const entry of entries) {
    if (isCardDebt(entry)) continue; // debt, not cash — projected separately below
    if (entry.recurrence === "none") {
      // A concrete row dated ahead of `from` (taksit's future installments,
      // or any manually future-dated one-off entry) — currentBalance above
      // deliberately excludes these from the starting balance, so they need
      // to land here instead, exactly like a recurring template's projected
      // occurrence, or they'd vanish from the projection entirely.
      if (!entry.occurred_at || entry.occurred_at <= toDateString(today)) continue;
      const occurrence = new Date(`${entry.occurred_at}T00:00:00`);
      if (occurrence >= rangeStart && occurrence <= rangeEnd) {
        events.push({ entry, occurrence });
      }
      continue;
    }
    if (!entry.next_due_date) continue;
    for (const occurrence of occurrencesInRange(entry.next_due_date, entry.recurrence, rangeStart, rangeEnd)) {
      if (existingOccurrences.has(`${entry.id}:${toDateString(occurrence)}`)) continue;
      events.push({ entry, occurrence });
    }
  }

  if (cards.length > 0) {
    // (cardId:paymentDate) -> accumulated total for that cycle.
    const cycleTotals = new Map<string, { cardId: string; paymentDate: Date; total: number }>();
    for (const card of cards) {
      // Every future charge on this card, bucketed by which payment cycle
      // it belongs to (nextCardPaymentDate already handles a charge landing
      // after this month's statement cutoff, rolling it to the following
      // cycle).
      for (const entry of entries) {
        if (entry.recurrence !== "none" || !isCardDebt(entry) || entry.credit_card_id !== card.id) continue;
        const chargeDate = new Date(`${entry.occurred_at}T00:00:00`);
        if (chargeDate <= today) continue; // already folded into debtSoFar below
        const paymentDate = nextCardPaymentDate(chargeDate, card.statement_day, card.payment_day);
        const key = `${card.id}:${toDateString(paymentDate)}`;
        const bucket = cycleTotals.get(key);
        if (bucket) bucket.total += entry.amount;
        else cycleTotals.set(key, { cardId: card.id, paymentDate, total: entry.amount });
      }

      // Whatever's already charged-and-unpaid as of today — creditCardDebtBalance
      // nets out any card_payment the user already logged, so this can never
      // double-count a payment they made early. It belongs to the same cycle
      // a charge made *today* would fall into (nextCardPaymentDate applied to
      // `today` itself): without folding it in here, a card the user hasn't
      // charged again since today (like a single coffee bought this morning)
      // would never show up leaving cash at all — only the *next* charge
      // would, understating every near-term dip.
      const debtSoFar = creditCardDebtBalance(entries, card.id, today);
      if (debtSoFar > 0) {
        const nextPaymentDate = nextCardPaymentDate(today, card.statement_day, card.payment_day);
        const key = `${card.id}:${toDateString(nextPaymentDate)}`;
        const bucket = cycleTotals.get(key);
        if (bucket) bucket.total += debtSoFar;
        else cycleTotals.set(key, { cardId: card.id, paymentDate: nextPaymentDate, total: debtSoFar });
      }
    }
    for (const { cardId, paymentDate, total } of cycleTotals.values()) {
      if (paymentDate < rangeStart || paymentDate > rangeEnd) continue;
      events.push({
        entry: projectedCardPaymentEntry(cardId, paymentDate, total),
        occurrence: paymentDate,
        isProjected: true,
      });
    }
  }

  events.sort((a, b) => a.occurrence.getTime() - b.occurrence.getTime());

  const startingBalance = currentBalance(entries, from);
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
    // Interest only accrues on a positive balance — there's no cash sitting
    // idle to deposit when the account is already overdrawn, so a negative
    // balance must carry forward unchanged (aside from that day's events),
    // not compound further into the negative.
    const interest = previous > 0 ? previous * dailyRate : 0;
    optimized.push({ date: points[i].date, balance: previous + interest + eventDelta });
  }

  return optimized;
}

function netSimpleInterest(amount: number, days: number, annualRatePercent: number): number {
  const gross = amount * (annualRatePercent / 100) * (days / 365);
  return gross * (1 - WITHHOLDING_TAX_RATE);
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
