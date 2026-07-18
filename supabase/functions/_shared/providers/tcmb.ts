import { XMLParser } from "npm:fast-xml-parser@^5";

const TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

type TcmbCurrency = { "@_Kod"?: string; ForexSelling?: string | number };

// TCMB publishes once/business-day (~15:30 TRT) and is down/holiday-frozen
// more than people expect (docs/phase1-plan.md E.a). Throws on any failure
// — the caller falls back to the Binance USDT/TRY cross rate and tags the
// result "binance_cross" so downstream confidence caps at "orta". T2.
export async function fetchUsdTryFromTcmb(): Promise<number> {
  const res = await fetch(TCMB_URL);
  if (!res.ok) throw new Error(`TCMB fetch failed: ${res.status}`);

  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);

  const currencies = doc?.Tarih_Date?.Currency;
  const list: TcmbCurrency[] = Array.isArray(currencies) ? currencies : [currencies].filter(Boolean);
  const usd = list.find((c) => c?.["@_Kod"] === "USD");
  const rate = Number(usd?.ForexSelling);

  if (!usd || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("USD ForexSelling not found in TCMB feed");
  }

  return rate;
}
