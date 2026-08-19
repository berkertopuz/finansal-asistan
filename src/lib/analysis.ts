import type { Entry, EntryRecurrence } from "@/lib/ledger";

// Analiz sayfasının (src/app/(app)/analiz) tüm hesapları. Saf fonksiyonlar —
// hiç I/O yok, girdisi getEntries()'in döndürdüğü satır listesi. Sayfa
// sunucuda render edilirken bir kez çağrılır.
//
// ÜÇ KURAL, hepsi mevcut modelden türedi ve hiçbiri isteğe bağlı değil:
//
// 1. HARCAMA = kind 'expense' + 'subscription'. 'investment' ve 'card_payment'
//    HARİÇ. Bu, v_monthly_surplus'ın (supabase/migrations/
//    20260718130000_recurring_entries_surplus.sql) kind filtrelerinin aynısı —
//    'card_payment' karta yapılan bir ödeme, yani nakit→borç transferi; borcu
//    doğuran asıl harcama zaten ayrı bir satır olarak sayılıyor, ikisini
//    birlikte saymak harcamayı iki katına çıkarırdı. 'investment' ise tasarrufun
//    ta kendisi (portföye giden para), harcama değil.
//
// 2. YİNELENEN ŞABLON SATIRLARI HARİÇ. Bir şablon, `recurrence <> 'none'` olan
//    bir entries satırı; gerçek aylık satırlar ondan üretilip `recurrence:
//    'none'` + `template_id` ile yazılıyor (src/lib/recurrence-materialize.ts).
//    Şablonun kendi `occurred_at`'i bir ödeme tarihi DEĞİL, sadece "deftere
//    eklendiği gün" (bkz. ledger.ts'teki entryDisplayDate notu) — onu da
//    saymak, şablonun oluşturulduğu aya hayalet bir tutar eklerdi.
//
// 3. GEÇMİŞ AYLAR GERİYE DOLDURULMAZ. materializeDueOccurrences kasıtlı olarak
//    backfill yapmıyor; bugün eklenen aylık bir kira şablonu geçmiş aylara
//    satır üretmez. Yani buradaki geçmiş ay rakamları "kayıtlı olan"ı gösterir,
//    "olması gerekeni" değil. Bu bir eksiklik değil tercih: kullanıcının hiç
//    girmediği bir veriyi varmış gibi göstermek analizi yalancı yapardı.

const SPENDING_KINDS: Entry["kind"][] = ["expense", "subscription"];

/** Gerçekleşmiş (şablon olmayan) satır — bkz. dosya başı kural 2. */
function isRealized(entry: Entry): boolean {
  return entry.recurrence === "none";
}

function isSpending(entry: Entry): boolean {
  return isRealized(entry) && SPENDING_KINDS.includes(entry.kind);
}

function isIncome(entry: Entry): boolean {
  return isRealized(entry) && entry.kind === "income";
}

export type MonthKey = string; // "YYYY-MM"

export function monthKeyOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

export function monthKeyOfDate(d: Date): MonthKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-08" -> "2026-07". Ay aritmetiğini Date'e bırakmıyoruz (TZ tuzağı yok). */
export function previousMonthKey(month: MonthKey): MonthKey {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function nextMonthKey(month: MonthKey): MonthKey {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Son `count` ayın anahtarları, eskiden yeniye. */
export function recentMonthKeys(from: MonthKey, count: number): MonthKey[] {
  const keys: MonthKey[] = [from];
  for (let i = 1; i < count; i++) keys.unshift(previousMonthKey(keys[0]));
  return keys;
}

function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// 1. Gelir / gider makası ve kümülatif tasarruf
// ---------------------------------------------------------------------------

export type MonthlyFlow = {
  month: MonthKey;
  income: number;
  spending: number;
  /** income - spending. Negatifse o ay açık verilmiş. */
  net: number;
  /** Pencerenin başından itibaren biriken net — "kümülatif tasarruf". */
  cumulativeNet: number;
};

// KASITLI olarak "net servet" (net worth) DEĞİL. Net servet nakit + portföy
// piyasa değeri - kart borcu olurdu ve tarihsel eğrisi çizilemez: portföyün
// geçmiş piyasa değeri kullanıcı bazında hiçbir yerde saklanmıyor
// (market_snapshots ortak bir fiyat tablosu, pozisyon değeri değil). Gelir
// eksi giderin birikimine "net servet" demek, portföyü ve kart borcunu yok
// saymak olurdu — o yüzden adı ne ise o: kümülatif tasarruf.
export function monthlyFlows(entries: Entry[], months: MonthKey[]): MonthlyFlow[] {
  const income = new Map<MonthKey, number>();
  const spending = new Map<MonthKey, number>();

  for (const entry of entries) {
    const month = monthKeyOf(entry.occurred_at);
    if (isIncome(entry)) income.set(month, (income.get(month) ?? 0) + entry.amount);
    else if (isSpending(entry)) spending.set(month, (spending.get(month) ?? 0) + entry.amount);
  }

  let cumulative = 0;
  return months.map((month) => {
    const inc = income.get(month) ?? 0;
    const spend = spending.get(month) ?? 0;
    const net = inc - spend;
    cumulative += net;
    return { month, income: inc, spending: spend, net, cumulativeNet: cumulative };
  });
}

// Pencerenin BAŞINDAKİ tamamen boş ayları atar.
//
// Neden gerekli: kullanıcı uygulamayı iki ay önce kurduysa 6 aylık pencerenin
// ilk dört ayı "0 TL gelir, 0 TL gider" olarak çizilir — ama "o ay hiç para
// harcamadım" ile "o ay bu uygulamayı kullanmıyordum" aynı şey değil. Gerçek
// veriyle test edildiğinde grafik dört ay boyunca sıfırda yatıp sonra dikey
// bir sıçrama yapıyordu; bu, olmayan bir "harcama patlaması" hikâyesi
// anlatıyor. Aradaki boş ayları (veri başladıktan SONRA gelen gerçek sıfır
// ayları) koruyoruz — onlar gerçek bilgi.
//
// En az iki ay bırakılır: tek noktalı bir çizgi grafiği trend göstermez.
export function trimLeadingEmptyMonths(flows: MonthlyFlow[], minMonths = 2): MonthlyFlow[] {
  const firstActive = flows.findIndex((flow) => flow.income > 0 || flow.spending > 0);
  if (firstActive <= 0) return flows;
  const start = Math.min(firstActive, Math.max(0, flows.length - minMonths));
  const trimmed = flows.slice(start);
  // cumulativeNet pencerenin başından itibaren biriktiği için yeniden
  // hesaplanmalı — kırpılan aylar zaten 0 net katıyordu, ama offset'i
  // sıfırlamak "birikim bu pencerede şuradan başladı"yı doğru gösteriyor.
  let cumulative = 0;
  return trimmed.map((flow) => {
    cumulative += flow.net;
    return { ...flow, cumulativeNet: cumulative };
  });
}

// ---------------------------------------------------------------------------
// 2. Kategori kırılımı
// ---------------------------------------------------------------------------

export type CategorySlice = {
  category: string;
  amount: number;
  /** 0..1 — o ayın toplam harcamasındaki payı. */
  share: number;
};

export function categoryBreakdown(entries: Entry[], month: MonthKey): CategorySlice[] {
  const totals = new Map<string, number>();
  let total = 0;
  for (const entry of entries) {
    if (!isSpending(entry) || monthKeyOf(entry.occurred_at) !== month) continue;
    const category = entry.category ?? "diğer";
    totals.set(category, (totals.get(category) ?? 0) + entry.amount);
    total += entry.amount;
  }
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount, share: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// 3. Kategori bazında aydan aya değişim
// ---------------------------------------------------------------------------

export type CategoryChange = {
  category: string;
  current: number;
  previous: number;
  delta: number;
  /** null = geçen ay bu kategoride hiç harcama yok, yani yüzde tanımsız. */
  deltaRatio: number | null;
};

// Çok küçük kategorilerde yüzde gürültüye dönüşüyor: 5 TL'den 50 TL'ye çıkan
// bir kalem "%900 arttı" diye en tepede görünür ve gerçek sinyali (market
// %15 arttı, tutarı 2.000 TL) ekrandan atar. Bu yüzden sıralama YÜZDEYE göre
// değil MUTLAK DEĞİŞİME göre yapılıyor ve iki ayın ikisinde de bu eşiğin
// altında kalan kalemler hiç listelenmiyor.
const CHANGE_NOISE_FLOOR_TRY = 100;

export function categoryChanges(
  entries: Entry[],
  currentMonth: MonthKey,
  previousMonth: MonthKey = previousMonthKey(currentMonth),
): CategoryChange[] {
  const current = new Map<string, number>();
  const previous = new Map<string, number>();

  for (const entry of entries) {
    if (!isSpending(entry)) continue;
    const month = monthKeyOf(entry.occurred_at);
    const category = entry.category ?? "diğer";
    if (month === currentMonth) current.set(category, (current.get(category) ?? 0) + entry.amount);
    else if (month === previousMonth) previous.set(category, (previous.get(category) ?? 0) + entry.amount);
  }

  const categories = new Set([...current.keys(), ...previous.keys()]);
  return [...categories]
    .map((category) => {
      const cur = current.get(category) ?? 0;
      const prev = previous.get(category) ?? 0;
      return {
        category,
        current: cur,
        previous: prev,
        delta: cur - prev,
        deltaRatio: prev > 0 ? (cur - prev) / prev : null,
      };
    })
    .filter((c) => Math.max(c.current, c.previous) >= CHANGE_NOISE_FLOOR_TRY && c.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// ---------------------------------------------------------------------------
// 4. Zorunlu / keyfi / sınıflanmamış
// ---------------------------------------------------------------------------

/**
 * Bir satırın ödeme zamanını ve varlığını kullanıcı BU AY mı seçti, yoksa
 * daha önce verilmiş bir karardan mı doğuyor?
 *
 * "Taahhütlü" sayılanlar:
 *   - Yinelenen bir şablondan üretilmiş satırlar (template_id) — kira,
 *     faturalar. Tarihi şablonun çıpası belirliyor, kullanıcı o gün bir karar
 *     vermiyor.
 *   - Abonelikler (kind='subscription').
 *   - İlk taksitten sonraki taksitler (installment_index > 1) — para geçmiş
 *     bir alışverişe ait, ödeme günü bankanın.
 *
 * Bu, ZORUNLU/KEYFİ ayrımının yerini aldı. Eski hali kategori listesine
 * dayanıyordu (kira/fatura/market/ulaşım = zorunlu) ve kullanıcı haklı olarak
 * reddetti: "markette aldığımız her şey zorunlu ihtiyaç değil, turistik bir
 * uçak bileti de zorunlu değil". Doğru tespit — aynı kategori hem zorunlu hem
 * keyfi kalem taşıyor, dolayısıyla kategori bazlı bir zorunluluk yargısı
 * kaçınılmaz olarak yanlış. Üstelik o yargıyı vermek bize düşmez.
 *
 * Yerine geçen ayrım YARGI DEĞİL YAPI: veri bunu kesin olarak biliyor.
 * "Harcamanın %62'si zaten taahhüt altında, %38'i bu ay verdiğin kararlar"
 * cümlesi hem doğru hem eyleme dönük — kısılabilecek kısmın hangisi olduğunu
 * kullanıcı kendisi bilir.
 */
function isCommitted(entry: Entry): boolean {
  if (entry.kind === "subscription") return true;
  if (entry.template_id !== null) return true;
  return entry.installment_index !== null && entry.installment_index > 1;
}

export type CommitmentSplit = {
  /** Kira, faturalar, abonelikler, süren taksitler — bu ay karar verilmedi. */
  committed: number;
  /** Bu ayın kendi kararları: tek seferlik alışverişler ve ilk taksitler. */
  discretionary: number;
  total: number;
};

export function commitmentSplit(entries: Entry[], month: MonthKey): CommitmentSplit {
  const split: CommitmentSplit = { committed: 0, discretionary: 0, total: 0 };
  for (const entry of entries) {
    if (!isSpending(entry) || monthKeyOf(entry.occurred_at) !== month) continue;
    if (isCommitted(entry)) split.committed += entry.amount;
    else split.discretionary += entry.amount;
    split.total += entry.amount;
  }
  return split;
}

// ---------------------------------------------------------------------------
// 5. Satıcı (merchant) analizi
// ---------------------------------------------------------------------------

// Ekstre açıklamaları aynı markayı birden fazla yazımla taşıyor — gerçek bir
// QNB ekstresinde AYNI dosyada hem "MİGROS- ANADOLU HISARI" hem "MIGROS-
// ANADOLU HISARI" geçti (bankanın fontu Türkçe harfleri tutarsız aktarıyor,
// bkz. src/lib/statement-import/extract.ts). Normalizasyon olmadan bir
// "en çok para gidenler" listesi aynı zinciri ikiye bölerdi.
const TURKISH_FOLD: Record<string, string> = {
  İ: "I", I: "I", ı: "I", Ş: "S", ş: "S", Ğ: "G", ğ: "G",
  Ü: "U", ü: "U", Ö: "O", ö: "O", Ç: "C", ç: "C",
};

// Ekstre açıklamalarının kuyruğuna banka/POS tarafından eklenen, markayı
// tanımlamayan parçalar. Hepsi gerçek ekstre satırlarında gözlendi:
//   "Vivaticket spa (EUR 16.50)"     -> yabancı para tutarı
//   "AIRBNB * HMBRYB9X5Z"            -> yıldız + referans kodu
//   "LinkedIn*P30288982673"          -> yıldız + referans kodu (boşluksuz)
//   "GRATİS TRABZON MEYDA ... TRTR"  -> ülke/POS eki
//   "PEGASUS\PGS418267780"           -> ters bölü + referans
const MERCHANT_NOISE: RegExp[] = [
  /\((?:[A-Z]{3})\s*[\d.,]+\)\s*$/i, // (EUR 16.50)
  // Yıldız/ters bölü + referans kodu. Ayırıcıdan SONRA boşluk olabilir
  // ("AIRBNB * HMBRYB9X5Z") ya da olmayabilir ("LinkedIn*P30288982673") —
  // \s* şart: boşluklu hali yakalanmazsa referans kodu anahtarın ikinci
  // kelimesi olur ve her rezervasyon ayrı bir "satıcı" olarak listelenir.
  /[*\\]\s*[A-Z0-9]{4,}\s*$/i,
  /\bTRTR\b/g, // POS ülke eki
  /\[(?:KART|TCKN|IBAN|TELEFON|EPOSTA|AD|NO)\]/g, // maskeleyici etiketleri
];

/**
 * Bir açıklamayı gruplama anahtarına çevirir.
 *
 * Anahtar, normalize edilmiş metnin İLK İKİ kelimesi. Neden tamamı değil:
 * aynı zincirin şube/şehir eki satır satır değişiyor ("MIGROS ANADOLU
 * HISARI", "MIGROS- ANADOLU HISARI", "MİGROS ATASEHIR") ve kullanıcının
 * görmek istediği şey "Migros'a toplam ne kadar verdim". Neden tek kelime
 * değil: ilk kelime çok sık jenerik oluyor ("IST.", "Y.DIŞI"), tek başına
 * alakasız satıcıları birleştirirdi.
 */
export function merchantKey(description: string): string {
  let text = description;
  for (const noise of MERCHANT_NOISE) text = text.replace(noise, " ");
  const folded = [...text].map((ch) => TURKISH_FOLD[ch] ?? ch).join("").toUpperCase();
  const words = folded
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0);
  return words.slice(0, 2).join(" ");
}

export type MerchantStat = {
  key: string;
  /** Kullanıcıya gösterilen etiket — o gruptaki EN SIK geçen özgün yazım. */
  label: string;
  amount: number;
  count: number;
  /** Ortalama sepet tutarı. Ayrı bir analiz değil, satıcı satırının detayı. */
  average: number;
  /** Gruptaki EN ÇOK TUTAR tutan kategori — satıcı barının rengini bu belirliyor
   * (renk kategoriye sabit bağlı, bkz. src/lib/analysis-colors.ts). */
  category: string | null;
};

export function topMerchants(
  entries: Entry[],
  options: { months: MonthKey[]; limit?: number; by?: "amount" | "count" },
): MerchantStat[] {
  const window = new Set(options.months);
  const groups = new Map<
    string,
    { amount: number; count: number; labels: Map<string, number>; categories: Map<string, number> }
  >();

  for (const entry of entries) {
    if (!isSpending(entry) || !window.has(monthKeyOf(entry.occurred_at))) continue;
    const description = entry.description?.trim();
    if (!description) continue; // elle girilmiş, açıklamasız satır
    const key = merchantKey(description);
    if (!key) continue;
    const group = groups.get(key) ?? { amount: 0, count: 0, labels: new Map(), categories: new Map() };
    group.amount += entry.amount;
    group.count += 1;
    group.labels.set(description, (group.labels.get(description) ?? 0) + 1);
    const category = entry.category ?? "diğer";
    group.categories.set(category, (group.categories.get(category) ?? 0) + entry.amount);
    groups.set(key, group);
  }

  const by = options.by ?? "amount";
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      // Gruplama normalize edilmiş anahtarla, GÖSTERİM özgün metinle: kullanıcı
      // ekstresinde gerçekten yazan şeyi görsün, uydurulmuş bir marka adı değil.
      label: [...group.labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
      amount: group.amount,
      count: group.count,
      average: group.amount / group.count,
      category: [...group.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => (by === "amount" ? b.amount - a.amount : b.count - a.count))
    .slice(0, options.limit ?? 8);
}

// ---------------------------------------------------------------------------
// 6. Taksit yükü (ileriye dönük)
// ---------------------------------------------------------------------------

// Jenerik bir bütçe uygulamasının yapamadığı analiz: taksitli bir alışverişin
// TÜM satırları, alışveriş girildiği anda zaten yazılıyor (src/lib/
// installments.ts — template_id'li yinelenenlerin aksine tembel üretim yok,
// bkz. ledger.ts'teki installment_group_id notu). Yani gelecek ayların taksit
// yükü tahmin değil, veritabanında duran kesin bir sayı.
/** Tek bir taksitli alışveriş (installment_group_id ile tanımlı). */
export type InstallmentPlan = {
  groupId: string;
  /**
   * Alışverişin açıklaması — o gruptaki en sık geçen özgün metin. Elle
   * girilmiş taksitli kayıtlarda açıklama olmayabiliyor; o zaman NULL döner.
   *
   * Buraya bir yedek metin KOYMUYORUZ (eskiden groupId'nin ilk 8 karakteri
   * yazılıyordu ve gerçek veride legend'a "c8ee6cc8" diye basıldı). Gösterim
   * etiketi üretmek arayüzün işi: hem çeviri gerekiyor hem de adsız planları
   * birbirinden ayırt edecek bir numaralandırma.
   */
  label: string | null;
  installmentCount: number | null;
  /** Pencere içindeki toplam yükü — planları sıralamak için. */
  windowTotal: number;
};

export type InstallmentPlanMonth = {
  month: MonthKey;
  /** groupId -> o ay o plandan ödenecek tutar. Ödemesi olmayan plan yok. */
  amounts: Record<string, number>;
  /** groupId -> "3/12" gibi gösterge; tooltip bunu yazıyor. */
  positions: Record<string, string>;
  total: number;
};

// dataviz rehberinin seri tavanı: kategorik slot sayısı sınırlı ve 6. bir hue
// ÜRETİLMEZ — kuyruk "Diğer"e katlanır. 5 slot tanımlı (--viz-series-1..5),
// o yüzden en büyük 4 plan kendi rengini alır, geri kalanı 5. slotta toplanır.
export const INSTALLMENT_PLAN_SLOTS = 4;
export const INSTALLMENT_OTHER_ID = "__other__";

/**
 * Taksit yükünü AY x PLAN olarak ayırır — tek bir toplam kolon yerine.
 *
 * Kullanıcı geri bildirimi: "her bir yük farklı bir renkle temsil edilmeli ve
 * üzerine gelindiğinde veya mobilde tıklandığında ne olduğu yazmalı". Doğru:
 * "Eylül'de 8.400 TL taksit var" tek başına eyleme dönük değil; hangi
 * alışverişin ne zaman bittiğini görmek karar değiştiriyor.
 */
export function installmentPlans(
  entries: Entry[],
  fromMonth: MonthKey,
  monthCount: number,
): { plans: InstallmentPlan[]; months: InstallmentPlanMonth[] } {
  const monthKeys: MonthKey[] = [fromMonth];
  for (let i = 1; i < monthCount; i++) monthKeys.push(nextMonthKey(monthKeys[i - 1]));
  const window = new Set(monthKeys);

  const groups = new Map<
    string,
    { labels: Map<string, number>; installmentCount: number | null; windowTotal: number }
  >();
  const perMonth = new Map<MonthKey, Map<string, { amount: number; position: string }>>();

  for (const entry of entries) {
    if (!isSpending(entry) || entry.installment_group_id === null) continue;
    const month = monthKeyOf(entry.occurred_at);
    if (!window.has(month)) continue;

    const groupId = entry.installment_group_id;
    const group = groups.get(groupId) ?? {
      labels: new Map<string, number>(),
      installmentCount: entry.installment_count,
      windowTotal: 0,
    };
    const label = entry.description?.trim();
    if (label) group.labels.set(label, (group.labels.get(label) ?? 0) + 1);
    group.windowTotal += entry.amount;
    groups.set(groupId, group);

    const monthMap = perMonth.get(month) ?? new Map();
    const existing = monthMap.get(groupId);
    monthMap.set(groupId, {
      amount: (existing?.amount ?? 0) + entry.amount,
      position:
        entry.installment_index !== null && entry.installment_count !== null
          ? `${entry.installment_index}/${entry.installment_count}`
          : (existing?.position ?? ""),
    });
    perMonth.set(month, monthMap);
  }

  const ranked = [...groups.entries()]
    .map(([groupId, group]) => ({
      groupId,
      label: [...group.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      installmentCount: group.installmentCount,
      windowTotal: group.windowTotal,
    }))
    .sort((a, b) => b.windowTotal - a.windowTotal);

  const named = ranked.slice(0, INSTALLMENT_PLAN_SLOTS);
  const tail = ranked.slice(INSTALLMENT_PLAN_SLOTS);
  const namedIds = new Set(named.map((plan) => plan.groupId));

  const plans: InstallmentPlan[] = [...named];
  if (tail.length > 0) {
    plans.push({
      groupId: INSTALLMENT_OTHER_ID,
      label: null,
      installmentCount: null,
      windowTotal: tail.reduce((sum, plan) => sum + plan.windowTotal, 0),
    });
  }

  const months: InstallmentPlanMonth[] = monthKeys.map((month) => {
    const monthMap = perMonth.get(month);
    const amounts: Record<string, number> = {};
    const positions: Record<string, string> = {};
    let total = 0;
    if (monthMap) {
      for (const [groupId, { amount, position }] of monthMap) {
        const key = namedIds.has(groupId) ? groupId : INSTALLMENT_OTHER_ID;
        amounts[key] = (amounts[key] ?? 0) + amount;
        // "Diğer" kovasında tek bir taksit göstergesi anlamsız olurdu (birden
        // fazla plan karışık), o yüzden yalnızca adlandırılmış planlarda yazılır.
        if (key !== INSTALLMENT_OTHER_ID) positions[key] = position;
        total += amount;
      }
    }
    return { month, amounts, positions, total };
  });

  return { plans, months };
}


export type MonthInstallmentLoad = {
  /** Bu ay ödenen TÜM taksitler (ilk taksitler dahil). */
  installment: number;
  /** Bunun geçmişte yapılmış alışverişlerden gelen kısmı (index > 1). */
  fromEarlierPurchases: number;
  /** Bu ayın toplam harcaması. */
  total: number;
  /** installment / total. */
  share: number;
};

/**
 * Bu ayın taksit yükü.
 *
 * İKİ sayı birden dönüyor ve sebebi bir tutarsızlığı düzeltmek: eskiden
 * yalnızca `installment_index > 1` olanlar sayılıyordu ("geçmiş bir kararın bu
 * aya düşen payı" — kavramsal olarak savunulabilir) ama KPI'nın etiketi "Bu
 * ayın taksit yükü" diyordu ve hemen altındaki grafik İLK taksitleri de
 * gösteriyordu. Gerçek veride sonuç şu oldu: grafikte taksitler görünüyor ama
 * KPI "₺0" yazıyor, çünkü bu ayın taksitlerinin hepsi 1. taksitti (kullanıcı
 * bildirdi). Aynı sayfada aynı kelimenin iki farklı anlamı olamaz.
 *
 * Artık `installment` grafikle aynı şeyi sayıyor (tüm taksitler),
 * `fromEarlierPurchases` ise o nüansı ayrı bir sayı olarak koruyor.
 */
export function installmentShareOfMonth(entries: Entry[], month: MonthKey): MonthInstallmentLoad {
  let installment = 0;
  let fromEarlierPurchases = 0;
  let total = 0;
  for (const entry of entries) {
    if (!isSpending(entry) || monthKeyOf(entry.occurred_at) !== month) continue;
    total += entry.amount;
    if (entry.installment_group_id === null) continue;
    installment += entry.amount;
    if (entry.installment_index !== null && entry.installment_index > 1) {
      fromEarlierPurchases += entry.amount;
    }
  }
  return { installment, fromEarlierPurchases, total, share: total > 0 ? installment / total : 0 };
}

// ---------------------------------------------------------------------------
// 7. Abonelik yükü — BU DOSYADA HESAPLANMIYOR (kasıtlı)
// ---------------------------------------------------------------------------
//
// Eskiden burada bir subscriptionLoad() vardı ve Analiz sayfası onu
// kullanıyordu. Kaldırıldı çünkü AYNI SAYININ İKİ TANIMI oluşuyordu:
// Abonelikler sayfası (src/app/(app)/defter/abonelikler) aylık abonelik
// toplamını v_monthly_surplus.subscription_total'dan okuyor, bu fonksiyon
// ise entries'ı kendisi topluyordu. İkisi üç noktada ayrışıyordu:
//   - tarih sınırı: view 'occurred_at <= ay sonu' istiyor, fonksiyonun
//     hiçbir tarih filtresi yoktu (her şablonu sayıyordu)
//   - recurrence='none' satırlar: view bu aya tarihliyse sayıyor, fonksiyon
//     hiç saymıyordu
//   - haftalık çevrim: view tutar*(aydaki gün/7) ~ 4.43, fonksiyon 52/12 ~ 4.33
// Sonuç gerçek veride görüldü: kullanıcı tek bir 400 TL'lik abonelik
// girmişken Abonelikler sayfası 400 TL, Analiz sayfası 1.635,07 TL
// gösteriyordu.
//
// Tek bir sayının tek bir kaynağı olmalı. Analiz sayfası artık view'ı
// doğrudan okuyor — ikinci bir tanım yazmak bu hatayı tekrar üretmenin
// en kısa yolu.

// ---------------------------------------------------------------------------
// 7b. Abonelik KIRILIMI (toplam değil — toplam view'dan geliyor)
// ---------------------------------------------------------------------------

export type SubscriptionPeriodGroup = {
  recurrence: Exclude<EntryRecurrence, "none">;
  count: number;
  /** Kuralların yazıldığı haliyle toplam (ör. yıllık 1.200 TL). */
  rawTotal: number;
  /** Aynı paranın aylık karşılığı (ör. 1.200 / 12 = 100 TL). */
  monthlyEquivalent: number;
};

export type SubscriptionBreakdown = {
  /** Tekrarlayan kurallar, periyoda göre. */
  groups: SubscriptionPeriodGroup[];
  /** Kuralların aylık karşılıklarının toplamı — "aylık sabit yük". */
  recurringMonthly: number;
  /** Bu aya düşen, kural OLMAYAN abonelik kategorili çekimler. */
  oneOffThisMonth: number;
};

// Kullanıcı isteği: "1200 tllik yıllık bir abonelik aslında aylık 100 tl'ye
// gelir. 20 tllik haftalık abonelik aylık 80 tlye gibi. bunun etkisini
// gösterebiliriz." Doğru istek: tek bir "abonelik toplamı" sayısı, yıllık bir
// aboneliğin aylık bütçeye gerçek etkisini saklıyor.
//
// Bu fonksiyon TOPLAM ÜRETMİYOR — o v_monthly_surplus.subscription_total'dan
// geliyor ve tek kaynak olarak kalıyor (bkz. yukarıdaki "7. Abonelik yükü"
// notu: ikinci bir toplam tanımı gerçek bir hataya yol açmıştı). Buradaki iş
// yalnızca o toplamı AÇIKLAMAK: hangi periyottan ne kadar geliyor.
//
// Çevrim katsayıları view'ın kullandıklarıyla BİREBİR aynı olmak zorunda,
// yoksa kırılımın toplamı kartın gösterdiği toplamı tutmaz:
//   monthly -> tutar
//   weekly  -> tutar * (aydaki gün sayısı / 7)      <- 52/12 DEĞİL
//   yearly  -> tutar / 12
// (Kullanıcının "20 TL haftalık ~ 80 TL/ay" örneği 4 haftalık kaba hesap;
// view 31 günlük bir ayda 4.43 kullanıyor, yani ~88,6 TL. Kırılımın toplamla
// tutması, kaba hesaba yakınlıktan önemli.)
export function subscriptionBreakdown(entries: Entry[], month: MonthKey): SubscriptionBreakdown {
  const days = daysInMonth(month);
  const factor: Record<Exclude<EntryRecurrence, "none">, number> = {
    weekly: days / 7,
    monthly: 1,
    yearly: 1 / 12,
  };

  const byPeriod = new Map<Exclude<EntryRecurrence, "none">, { count: number; rawTotal: number }>();
  let oneOffThisMonth = 0;

  for (const entry of entries) {
    if (entry.kind !== "subscription") continue;

    if (entry.recurrence === "none") {
      // Kural olmayan abonelik satırı. Bir şablonun bu ayki dönem satırı ise
      // (template_id dolu) SAYILMAZ — o para zaten kuralın aylık karşılığında
      // var, ikisini toplamak aynı aboneliği iki kez saymak olurdu.
      if (entry.template_id === null && monthKeyOf(entry.occurred_at) === month) {
        oneOffThisMonth += entry.amount;
      }
      continue;
    }

    const group = byPeriod.get(entry.recurrence) ?? { count: 0, rawTotal: 0 };
    group.count += 1;
    group.rawTotal += entry.amount;
    byPeriod.set(entry.recurrence, group);
  }

  // Sıra sabit ve okuma sırasına göre: en sık tekrardan en seyrek olana.
  const order: Exclude<EntryRecurrence, "none">[] = ["weekly", "monthly", "yearly"];
  const groups = order
    .filter((recurrence) => byPeriod.has(recurrence))
    .map((recurrence) => {
      const { count, rawTotal } = byPeriod.get(recurrence)!;
      return { recurrence, count, rawTotal, monthlyEquivalent: rawTotal * factor[recurrence] };
    });

  return {
    groups,
    recurringMonthly: groups.reduce((sum, g) => sum + g.monthlyEquivalent, 0),
    oneOffThisMonth,
  };
}

// ---------------------------------------------------------------------------
// 8. Ay içi harcama hızı
// ---------------------------------------------------------------------------

export type SpendingPace = {
  dayOfMonth: number;
  monthToDate: number;
  /** Önceki ayların AYNI gününe kadarki ortalaması. null = kıyas verisi yok. */
  baselineToSameDay: number | null;
  deltaRatio: number | null;
};

// AY SONU PROJEKSİYONU KALDIRILDI ve geri eklenmemeli.
//
// Eskiden `projectedMonthEnd = (monthToDate / dayOfMonth) * daysInMonth` diye
// doğrusal bir tahmin dönüyordu ve KPI'da "Bu hızla ay sonu: X" olarak
// gösteriliyordu. Kullanıcı reddetti ve gerekçesi doğru: "kullanıcının tek
// seferlik yüklü miktardaki giderlerini ayın sonuna kadar süreceğini
// öngöremeyiz". Doğrusal ekstrapolasyon harcamanın güne eşit dağıldığını
// varsayıyor; gerçek veride ayın 19'una kadarki ₺260.035'in ₺232.800'ü TEK
// bir kalemdi ve tahmin ₺424.267 gibi anlamsız bir sayı üretiyordu.
//
// Savunulabilir bir "ay sonu" ancak BİLİNEN gelecek satırlardan (ayın kalanına
// tarihli taksitler, yinelenen şablonlardan üretilmiş kayıtlar) kurulabilir —
// o farklı bir hesap ve farklı bir isim ister. Yanlış bir sayı, hiç sayı
// olmamasından kötüdür.

// Gemini'nin önerdiği "ayın ilk 15 gününde ne harcandı" eşiği keyfi — 15
// neden? Karşılaştırma noktası olmayan bir sayı kullanıcıya bir şey
// söylemiyor. Bunun yerine AYNI GÜNE kadarki geçmiş ortalamasıyla kıyas:
// "ayın 18'indesin, son 3 ayın 18'ine göre %23 fazlasındasın" — hem bir
// uyarı hem bir tahmin.
export function spendingPace(entries: Entry[], today: Date, baselineMonths = 3): SpendingPace {
  const month = monthKeyOfDate(today);
  const dayOfMonth = today.getDate();

  const spentToDayInMonth = (target: MonthKey): number => {
    let total = 0;
    for (const entry of entries) {
      if (!isSpending(entry) || monthKeyOf(entry.occurred_at) !== target) continue;
      if (Number(entry.occurred_at.slice(8, 10)) > dayOfMonth) continue;
      total += entry.amount;
    }
    return total;
  };

  const monthToDate = spentToDayInMonth(month);

  // BENİMSEME AYI kıyasa girmez. Kullanıcının ilk kaydının düştüğü ay doğası
  // gereği kısmi: uygulamayı ayın 20'sinde kurduysa o ayın "aynı güne kadarki"
  // toplamı gerçek harcamasını değil, yalnızca kayıt tuttuğu günleri gösterir.
  // Gerçek veriyle yakalandı — kıyas "%773 fazla harcıyorsun" diyordu, çünkü
  // taban ay kullanıcının kayda başladığı aydı. Aritmetik doğruydu, anlamı
  // yanlıştı; böyle bir sayı kullanıcının sayfanın tümüne olan güvenini
  // bozar. Yalnızca baştan sona takip edilmiş aylar taban olabilir.
  const firstTrackedMonth = entries.reduce<MonthKey | null>((earliest, entry) => {
    if (!isRealized(entry) || (!SPENDING_KINDS.includes(entry.kind) && entry.kind !== "income")) return earliest;
    const key = monthKeyOf(entry.occurred_at);
    return earliest === null || key < earliest ? key : earliest;
  }, null);

  const baselines: number[] = [];
  let cursor = previousMonthKey(month);
  for (let i = 0; i < baselineMonths; i++) {
    // Yalnızca gerçekten harcama görülmüş VE benimseme ayından sonraki aylar.
    if (firstTrackedMonth !== null && cursor > firstTrackedMonth) {
      const spent = spentToDayInMonth(cursor);
      if (spent > 0) baselines.push(spent);
    }
    cursor = previousMonthKey(cursor);
  }

  const baselineToSameDay =
    baselines.length > 0 ? baselines.reduce((a, b) => a + b, 0) / baselines.length : null;

  return {
    dayOfMonth,
    monthToDate,
    baselineToSameDay,
    deltaRatio:
      baselineToSameDay !== null && baselineToSameDay > 0
        ? (monthToDate - baselineToSameDay) / baselineToSameDay
        : null,
  };
}

// ---------------------------------------------------------------------------
// 9. Hafta içi / hafta sonu
// ---------------------------------------------------------------------------

export type DayOfWeekStat = {
  /** 1 = Pazartesi ... 7 = Pazar (ISO). */
  isoDay: number;
  total: number;
  /** Pencerede o haftagününün kaç kez geçtiği — yalnızca bağlam için. */
  occurrences: number;
};

// Haftanın 7 GÜNÜ ayrı ayrı, TOPLAM tutarla — ortalama DEĞİL.
//
// "hafta içi vs hafta sonu" ikili kıyası kaldırıldı çünkü 5 güne karşı 2 günü
// kıyaslıyordu (kullanıcı bildirdi). İlk düzeltmede toplam yerine "takvim günü
// başına ortalama" hesaplanmıştı ve bu DAHA KÖTÜ çıktı: gerçek veride tek bir
// pazartesi kaydı (30.000 TL) 3 aylık pencerenin 14 pazartesisine bölünüp
// 2.142,86 gibi hiçbir şey anlatmayan bir sayı üretti — bölenin içinde
// kullanıcının hiç kayıt tutmadığı aylar ve ayın henüz gelmemiş günleri vardı.
//
// Doğru tespit şu: 5-e-karşı-2 problemi günleri TEK TEK ayırmakla çözülüyor.
// Her haftagünü herhangi bir pencerede aşağı yukarı aynı sayıda geçtiği için
// (13 ya da 14) pazartesi toplamı ile salı toplamı zaten adil bir kıyas.
// Bölme, adil olmayan bir kıyası düzeltmiyordu; sadece anlaşılmaz bir sayı
// üretiyordu. occurrences bilgi olarak dönüyor ama bir bölen değil.
export function dayOfWeekProfile(entries: Entry[], months: MonthKey[]): DayOfWeekStat[] {
  const window = new Set(months);
  const totals = new Map<number, number>();

  for (const entry of entries) {
    if (!isSpending(entry) || !window.has(monthKeyOf(entry.occurred_at))) continue;
    // Sabit giderler girmez — tarihi şablonun çıpası belirliyor, kullanıcının
    // o günle bir ilgisi yok (bkz. isCommitted).
    if (isCommitted(entry)) continue;
    const isoDay = isoDayOf(entry.occurred_at);
    totals.set(isoDay, (totals.get(isoDay) ?? 0) + entry.amount);
  }

  // Takvim sayımı: pencerenin her gününü gezip haftagünlerini sayıyoruz.
  const occurrences = new Map<number, number>();
  for (const month of window) {
    const [year, m] = month.split("-").map(Number);
    for (let day = 1; day <= daysInMonth(month); day++) {
      const isoDay = isoDayOf(`${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
      occurrences.set(isoDay, (occurrences.get(isoDay) ?? 0) + 1);
    }
  }

  return Array.from({ length: 7 }, (_, i) => {
    const isoDay = i + 1;
    return { isoDay, total: totals.get(isoDay) ?? 0, occurrences: occurrences.get(isoDay) ?? 0 };
  });
}

// occurred_at bir tarih (saat yok) — UTC ile ayrıştırmak zorunlu, yerel saat
// TZ'ye göre günü bir kaydırabilir. getUTCDay() 0=Pazar veriyor, ISO'ya
// (1=Pazartesi..7=Pazar) çeviriyoruz ki hafta pazartesiden başlasın.
function isoDayOf(isoDate: string): number {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
