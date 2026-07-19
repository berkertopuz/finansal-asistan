// TCMB EVDS — the cash-flow timeline's "float gain" estimate needs an
// interest-rate assumption, sourced live rather than hand-typed (CLAUDE.md
// rule 5's no-fabrication spirit, applied here too even though this isn't a
// recommendation-engine price). Series TP.TRY.MT01 is the banking sector's
// weighted-average interest rate on up-to-1-month TL deposits, published
// weekly (Fridays) under EVDS category 450501 ("Faiz ve Kâr Payı
// İstatistikleri (Akım)" -> "Mevduat Faiz Oranları (Akım)", group
// bie_mt100h). Confirmed working against the live API while building this:
// as of 10-07-2026 the published rate was 46.41%.
//
// Auth is an HTTP header, not a URL param — EVDS changed this in April 2024;
// the old `?key=...` query-string form now just gets redirected away.
const EVDS_BASE_URL = "https://evds3.tcmb.gov.tr/igmevdsms-dis";
const SERIES_CODE = "TP.TRY.MT01";
const VALUE_KEY = "TP_TRY_MT01"; // dots -> underscores in the response

type EvdsItem = { Tarih: string } & Record<string, string | number>;

function formatEvdsDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${date.getFullYear()}`;
}

export type AvgDepositRate = { rate: number; asOf: string };

// Requests the last ~2 weeks so a Friday-only series still has something to
// return regardless of which day "today" is. Returns null on any failure —
// callers fall back to the user's stored assumed_annual_rate, never a
// fabricated number.
export async function fetchAvgDepositRate(): Promise<AvgDepositRate | null> {
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
      next: { revalidate: 43_200 }, // 12h — the underlying series only moves weekly
    });
    if (!res.ok) return null;

    const data: { items?: EvdsItem[] } = await res.json();
    const items = data.items ?? [];
    if (items.length === 0) return null;

    const latest = items[items.length - 1];
    const rate = Number(latest[VALUE_KEY]);
    if (!Number.isFinite(rate)) return null;

    return { rate, asOf: latest.Tarih };
  } catch {
    return null;
  }
}
