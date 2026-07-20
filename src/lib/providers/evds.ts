// TCMB EVDS — the cash-flow timeline's "float gain" estimate needs an
// interest-rate assumption, sourced live rather than hand-typed (CLAUDE.md
// rule 5's no-fabrication spirit, applied here too even though this isn't a
// recommendation-engine price).
//
// There's no official published statistic for "average daily-interest
// account rate" — that's a bank-specific retail product, not a regulated
// category TCMB tracks (the up-to-1-month TIME DEPOSIT series, TP.TRY.MT01,
// was tried first and rejected: it requires locking the money up, so it ran
// well above what a liquid daily-interest account actually pays). Series
// TP.BISTTLREF.ORAN (BIST-TLREF, the TL overnight reference rate published
// each business day under EVDS category 4505 -> "Faiz ve Kâr Payı
// İstatistikleri (Akım)", group bie_bisttlref) is the closest live official
// number — it's the wholesale interbank overnight rate a bank's own daily
// account is priced off of, though retail accounts pay somewhat less (the
// bank's margin), so it reads a bit high vs. a real account. Confirmed
// working against the live API while building this: 39.91% on 17-07-2026.
//
// Auth is an HTTP header, not a URL param — EVDS changed this in April 2024;
// the old `?key=...` query-string form now just gets redirected away.
const EVDS_BASE_URL = "https://evds3.tcmb.gov.tr/igmevdsms-dis";
const SERIES_CODE = "TP.BISTTLREF.ORAN";
const VALUE_KEY = "TP_BISTTLREF_ORAN"; // dots -> underscores in the response

type EvdsItem = { Tarih: string } & Record<string, string | number>;

function formatEvdsDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${date.getFullYear()}`;
}

export type ReferenceRate = { rate: number; asOf: string };

// Requests the last ~2 weeks so weekends/holidays (this series only
// publishes on business days) still leave something to return. Returns
// null on any failure — callers fall back to the user's stored
// assumed_annual_rate, never a fabricated number.
export async function fetchReferenceRate(): Promise<ReferenceRate | null> {
  const apiKey = process.env.EVDS_API_KEY;
  if (!apiKey) return null;

  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000);
  const url =
    `${EVDS_BASE_URL}/series=${SERIES_CODE}` +
    `&startDate=${formatEvdsDate(twoWeeksAgo)}&endDate=${formatEvdsDate(now)}&type=json`;

  try {
    const res = await fetch(url, {
      headers: { key: apiKey },
      next: { revalidate: 21_600 }, // 6h — this series moves daily (business days)
    });
    if (!res.ok) return null;

    const data: { items?: EvdsItem[] } = await res.json();
    const items = (data.items ?? []).filter((item) => item[VALUE_KEY] != null);
    if (items.length === 0) return null;

    const latest = items[items.length - 1];
    const rate = Number(latest[VALUE_KEY]);
    if (!Number.isFinite(rate)) return null;

    return { rate, asOf: latest.Tarih };
  } catch {
    return null;
  }
}
