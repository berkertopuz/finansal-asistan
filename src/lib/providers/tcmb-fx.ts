// TCMB günlük döviz kurları — bir işlemin YAPILDIĞI GÜNÜN kuru.
//
// Neden ayrı bir dosya: supabase/functions/_shared/providers/tcmb.ts yalnızca
// BUGÜNÜN USD satış kurunu çekiyor ve öneri motoru için var. Defter kaydı
// farklı bir şeye ihtiyaç duyuyor — geçmiş bir tarihin kuru (kullanıcı üç gün
// önceki Berlin harcamasını bugün giriyor olabilir) ve USD dışındaki para
// birimleri.
//
// Kural 5 (uydurma yok) burada da geçerli: kur çekilemezse null dönüyoruz ve
// çağıran taraf kullanıcıdan TL tutarını istiyor. Tahmini bir kur ASLA
// üretilmiyor.
import { XMLParser } from "fast-xml-parser";

// Arşiv URL biçimi: /kurlar/YYYYMM/DDMMYYYY.xml. today.xml da var ama onu
// KULLANMIYORUZ — tarihli URL bugün için de çalışıyor ve tek bir kod yolu
// tutmak, "bugün mü geçmiş mi" ayrımını tamamen ortadan kaldırıyor.
const TCMB_ARCHIVE_BASE = "https://www.tcmb.gov.tr/kurlar";

// TCMB yalnızca iş günleri yayın yapıyor; hafta sonu ve resmî tatillerde URL
// 404 dönüyor (doğrulandı: 15-16 Ağustos 2026 cumartesi/pazar 404). O tarihte
// yapılan bir harcamanın kuru, ondan önceki son yayın günüdür — bu yüzden
// geriye doğru yürüyoruz. 7 gün, art arda gelen en uzun resmî tatili
// (Kurban Bayramı + hafta sonu) rahatça kapsıyor.
const MAX_LOOKBACK_DAYS = 7;

// Kur günde bir kez yayımlanıyor ve geçmiş tarihler HİÇ değişmiyor, o yüzden
// uzun cache güvenli. 6 saat, bugünün kuru öğleden sonra (~15:30 TRT)
// yayımlandığında makul sürede yakalanmasını sağlıyor.
const REVALIDATE_SECONDS = 6 * 60 * 60;

/** TCMB'nin yayımladığı para birimleri (2026-08 itibarıyla 22 tane). */
export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "DKK",
  "SAR", "AED", "KWD", "QAR", "RON", "RUB", "CNY", "PKR", "KRW", "AZN", "KZT",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export type FxRate = {
  currency: string;
  /** 1 birim yabancı para kaç TL. */
  rate: number;
  /** Kurun ait olduğu YAYIN günü — istenen tarihten geriye kaymış olabilir. */
  asOf: string;
  /** İstenen tarih yayın günü değilse true (hafta sonu/tatil). */
  shifted: boolean;
};

type TcmbCurrencyNode = {
  "@_Kod"?: string;
  Unit?: string | number;
  ForexSelling?: string | number;
  BanknoteSelling?: string | number;
};

function archiveUrl(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${TCMB_ARCHIVE_BASE}/${y}${m}/${d}${m}${y}.xml`;
}

function toDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ForexSelling = döviz satış kuru (hesaptan/kartla yapılan işlemin referansı).
// BanknoteSelling (efektif satış) nakit büro işlemleri için — ikisi arasında
// küçük bir fark var ve kart harcaması için doğru olan ForexSelling.
// XDR gibi bazı satırlarda banknot kurları boş geliyor, o yüzden ForexSelling'e
// düşemezsek o para birimini yok sayıyoruz.
function readRate(node: TcmbCurrencyNode): number | null {
  const unit = Number(node.Unit ?? 1);
  const selling = Number(node.ForexSelling ?? node.BanknoteSelling);
  if (!Number.isFinite(selling) || selling <= 0) return null;
  if (!Number.isFinite(unit) || unit <= 0) return null;
  // JPY ve KRW 100 birim üzerinden kote ediliyor (<Unit>100</Unit>) — bölmeyi
  // atlarsak yen cinsinden bir harcama 100 kat şişer.
  return selling / unit;
}

async function fetchDay(date: Date): Promise<Map<string, number> | null> {
  const res = await fetch(archiveUrl(date), { next: { revalidate: REVALIDATE_SECONDS } });
  // 404 = o gün yayın yok (hafta sonu/tatil). Hata değil, beklenen durum.
  if (!res.ok) return null;

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(await res.text());
  const raw = doc?.Tarih_Date?.Currency;
  const list: TcmbCurrencyNode[] = Array.isArray(raw) ? raw : [raw].filter(Boolean);

  const rates = new Map<string, number>();
  for (const node of list) {
    const code = node?.["@_Kod"];
    if (typeof code !== "string") continue;
    const rate = readRate(node);
    if (rate !== null) rates.set(code, rate);
  }
  return rates.size > 0 ? rates : null;
}

/**
 * `currency`'nin `dateString` günündeki (ya da ondan önceki son yayın
 * gününün) TL karşılığı. Bulunamazsa null — çağıran taraf kullanıcıdan TL
 * tutarını ister, tahmini kur ÜRETİLMEZ.
 */
export async function fetchFxRate(currency: string, dateString: string): Promise<FxRate | null> {
  if (!isSupportedCurrency(currency)) return null;
  const requested = toDateOnly(dateString);
  if (!requested) return null;

  // Gelecek bir tarihin kuru yok — bugüne kadar geri sar.
  const today = new Date();
  const start = requested > today ? today : requested;

  for (let back = 0; back <= MAX_LOOKBACK_DAYS; back++) {
    const day = new Date(start);
    day.setDate(day.getDate() - back);
    let rates: Map<string, number> | null = null;
    try {
      rates = await fetchDay(day);
    } catch {
      // Ağ hatası — bir sonraki güne geçmek yerine burada durmak yanlış
      // olurdu; TCMB'nin tek bir günü bazen yavaş/erişilemez oluyor.
      continue;
    }
    const rate = rates?.get(currency);
    if (rate !== undefined) {
      return { currency, rate, asOf: isoDate(day), shifted: back > 0 };
    }
  }
  return null;
}
