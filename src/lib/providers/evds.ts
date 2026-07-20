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

// The up-to-1-month TIME DEPOSIT series — rejected earlier for the liquid
// daily-interest model (it requires locking the money up, so it read too
// high for that), but it's exactly the right number for a genuine "vadeli
// mevduat" (term deposit) scenario, which is a locked product by definition.
const TERM_DEPOSIT_SERIES_CODE = "TP.TRY.MT01";
const TERM_DEPOSIT_VALUE_KEY = "TP_TRY_MT01";

type EvdsItem = { Tarih: string } & Record<string, string | number>;

function formatEvdsDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${date.getFullYear()}`;
}

export type ReferenceRate = { rate: number; asOf: string };

async function fetchLatestSeriesValue(
  seriesCode: string,
  valueKey: string,
): Promise<ReferenceRate | null> {
  const apiKey = process.env.EVDS_API_KEY;
  if (!apiKey) return null;

  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000);
  const url =
    `${EVDS_BASE_URL}/series=${seriesCode}` +
    `&startDate=${formatEvdsDate(twoWeeksAgo)}&endDate=${formatEvdsDate(now)}&type=json`;

  try {
    const res = await fetch(url, {
      headers: { key: apiKey },
      next: { revalidate: 21_600 }, // 6h — these series move at most daily
    });
    if (!res.ok) return null;

    const data: { items?: EvdsItem[] } = await res.json();
    const items = (data.items ?? []).filter((item) => item[valueKey] != null);
    if (items.length === 0) return null;

    const latest = items[items.length - 1];
    const rate = Number(latest[valueKey]);
    if (!Number.isFinite(rate)) return null;

    return { rate, asOf: latest.Tarih };
  } catch {
    return null;
  }
}

// Requests the last ~2 weeks so weekends/holidays (this series only
// publishes on business days) still leave something to return. Returns
// null on any failure — callers fall back to the user's stored
// assumed_annual_rate, never a fabricated number.
export async function fetchReferenceRate(): Promise<ReferenceRate | null> {
  return fetchLatestSeriesValue(SERIES_CODE, VALUE_KEY);
}

// For the "vadeye yatırsaydın" (term deposit) scenario — a separate, higher
// rate than the liquid daily-account line above, since a real vadeli
// mevduat pays more precisely because the money is locked for the term.
// Returns null the same way (no fabricated fallback); callers should simply
// hide the term-deposit panel rather than guess a number.
export async function fetchTermDepositRate(): Promise<ReferenceRate | null> {
  return fetchLatestSeriesValue(TERM_DEPOSIT_SERIES_CODE, TERM_DEPOSIT_VALUE_KEY);
}
