import type { EntryRecurrence } from "@/lib/ledger";

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export function clampMonthDay(year: number, monthIndex0: number, day: number): Date {
  return new Date(year, monthIndex0, Math.min(day, daysInMonth(year, monthIndex0)));
}

// Taksit'in date math'i — "sonraki uygun tarih" değil, anchor'ın gününü
// aynen `monthsToAdd` ay ileri taşır (ay sonu clamp'iyle, nextOccurrenceOnOrAfter'ın
// monthly dalıyla aynı mantık). i=0 anchor'ın kendisini döner, taksit
// serisinin ilk satırı için de bu kullanılır.
export function addMonthsClamped(anchorDateStr: string, monthsToAdd: number): Date {
  const anchor = new Date(`${anchorDateStr}T00:00:00`);
  const targetMonthIndex = anchor.getMonth() + monthsToAdd;
  const year = anchor.getFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  return clampMonthDay(year, month, anchor.getDate());
}

// The user enters `next_due_date` as an ANCHOR — any date (past, present,
// or future) that establishes which day of the week/month/year this entry
// recurs on. This computes the actual next occurrence on or after `from`,
// rather than showing the anchor verbatim (which made no sense for a past
// anchor — see the bug report: anchoring on June 30 must show July 30 as
// the next payment, not June 30 itself).
//
// Month-end clamping only kicks in when the target month is shorter than
// the anchor's day-of-month (e.g. anchor day 31 -> Feb 28) — a literal
// day-of-month match otherwise, matching the reported expectation that an
// anchor of June 30 (30-day month) rolls to July 30, not July 31.
export function nextOccurrenceOnOrAfter(
  anchorDateStr: string,
  recurrence: EntryRecurrence,
  from: Date = new Date(),
): Date | null {
  if (recurrence === "none") return null;

  const anchor = new Date(`${anchorDateStr}T00:00:00`);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  if (recurrence === "weekly") {
    let d = anchor;
    while (d < today) d = new Date(d.getTime() + 7 * 86_400_000);
    return d;
  }

  if (recurrence === "monthly") {
    const day = anchor.getDate();
    let candidate = clampMonthDay(today.getFullYear(), today.getMonth(), day);
    if (candidate < today) {
      const nextMonthIndex = today.getMonth() + 1;
      candidate = clampMonthDay(
        today.getFullYear() + Math.floor(nextMonthIndex / 12),
        nextMonthIndex % 12,
        day,
      );
    }
    return candidate;
  }

  // yearly
  let candidate = clampMonthDay(today.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (candidate < today) {
    candidate = clampMonthDay(today.getFullYear() + 1, anchor.getMonth(), anchor.getDate());
  }
  return candidate;
}
