"use client";

import { useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordStatementConsent, importStatementEntries } from "@/lib/actions/statements";
import { addCreditCard, payCreditCardDebt, updateCreditCard } from "@/lib/actions/credit-cards";
import { creditCardDebtBalance } from "@/lib/cashflow";
import { formatCurrency, formatDate, formatMonthYear } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { CreditCard } from "@/lib/credit-cards-data";
import type { StatementImport } from "@/lib/statement-imports-data";
import { ENTRY_CATEGORIES, toDateString, type Entry } from "@/lib/ledger";
import { isPaymentAlreadyRecorded, matchStatementRows } from "@/lib/statement-import/match";

type StatementRow = {
  tarih: string;
  aciklama: string;
  tutar: number;
  tur: "harcama" | "odeme" | "ucret";
  kategori: (typeof ENTRY_CATEGORIES)[number];
  taksit_index: number | null;
  taksit_sayisi: number | null;
};

type ReviewRow = StatementRow & {
  selected: boolean;
  possibleDuplicate: boolean;
  // Hangi kayıtla eşleştiği — rozetin GEREKÇESİ. Sezgisel bir eşleştirmede
  // "olası mükerrer" demek yetmiyor; kullanıcı neye dayanıldığını görmeden
  // karar veremez.
  duplicateOf: { occurred_at: string; amount: number } | null;
  // Bu satır, kullanıcının elle girdiği dövizli bir kaydın ekstredeki
  // karşılığıysa o kayıt. İçe aktarma onu EKLEMİYOR, üstüne yazıyor.
  replaces: { id: string; label: string } | null;
  // Yalnızca tur === "odeme" satırları için anlamlı. Bu ödeme banka
  // tarafında zaten bir card_payment satırıyla kayıtlıysa (kullanıcı bir
  // önceki ekstrenin ardından "Tam ödedim" akışıyla aynı olayı elle
  // kaydetmişse) tekrar eklenmez — aksi halde aynı ödeme iki kez düşülüp
  // borç olduğundan az görünürdü.
  alreadyRecorded: boolean;
};

const ENTRIES_KEY = "/api/entries";
const entriesFetcher = (url: string) => fetch(url).then((res) => res.json());

const STATEMENT_IMPORTS_KEY = "/api/statement-imports";
const statementImportsFetcher = (url: string) => fetch(url).then((res) => res.json());

// QuickEntryForm ile aynı anahtar — sheet artık kart listesini kendisi
// okuyor, çünkü Kartlar sayfasından değil FAB'dan da açılabiliyor.
const CREDIT_CARDS_KEY = "/api/credit-cards";
const creditCardsFetcher = (url: string) => fetch(url).then((res) => res.json());

// "YYYY-MM-DD" -> ayın günü. Yeni kart formunun kesim/son ödeme günlerini
// ekstrenin kendisinden doldurmak için — akışın asıl kazancı bu: kullanıcı
// bu iki sayıyı bilmek/hatırlamak zorunda kalmıyor, sadece bir isim yazıyor.
function dayOfMonth(dateString: string | null): number | null {
  if (!dateString) return null;
  const day = Number(dateString.slice(8, 10));
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

// Eşleştirme mantığı ayrı modülde (src/lib/statement-import/match.ts) —
// orada saf ve test edilebilir. Burada kalan tek karar arayüze ait:
// hangi satır varsayılan olarak İŞARETLİ gelecek.
function toReviewRows(rows: StatementRow[], existing: Entry[], creditCardId: string): ReviewRow[] {
  const matches = matchStatementRows(rows, existing, creditCardId);
  return rows.map((row, index) => {
    const match = matches[index];
    // "ucret" (faiz/KKDF/BSMV) gerçek bir masraf — varsayılan olarak seçili
    // gelir. "odeme" (kartın kendisine yapılan ödeme) ise yeni bir harcama
    // değil, zaten borcu doğuran asıl harcama ayrı bir satırda sayılıyor —
    // onu da eklemek çift sayım olurdu, o yüzden varsayılan olarak işaretsiz.
    //
    // Değiştirilecek satır MÜKERRER DEĞİL — tam tersi, işaretlenmesi gereken
    // satır o: onaylanınca elle girilen tahminin yerine bankanın gerçek
    // rakamı geçiyor. İşaretlenmezse tahmin defterde kalır.
    const selected =
      (row.tur === "harcama" || row.tur === "ucret") &&
      (!match.possibleDuplicate || match.replaces !== null);
    const alreadyRecorded =
      row.tur === "odeme" && isPaymentAlreadyRecorded(row, existing, creditCardId);
    return { ...row, ...match, selected, alreadyRecorded };
  });
}

export function StatementUploadSheet({
  card,
  hasConsent,
  onConsentGranted,
  onClose,
}: {
  // İSTEĞE BAĞLI. Kartlar sayfasındaki kart başına "Yükle" düğmesi kartı
  // baştan veriyor (eski davranış aynen korunuyor). FAB'dan açıldığında ise
  // kart YOK: önce PDF yükleniyor, kart ayrıştırmadan SONRA seçiliyor.
  // Sıralamanın tersine çevrilmesinin sebebi sadece tık sayısı değil —
  // yeni bir kart eklemek kesim/son ödeme günlerini gerektiriyor ve bu iki
  // bilgi zaten ekstrenin içinde yazıyor. Kart adımını sonraya almak, o
  // formu "bir isim yaz"a indiriyor.
  card?: CreditCard;
  // İSTEĞE BAĞLI. Kartlar sayfası bunu sunucudan biliyor ve veriyor. FAB'dan
  // açıldığında bilinmiyor (undefined) — o durumda rıza kapısı ÖNDEN
  // gösterilmiyor: kullanıcı dosyayı seçiyor, /api/statements/parse 403 +
  // consentRequired dönerse rıza adımı O ZAMAN çıkıyor ve onaydan sonra aynı
  // dosya otomatik yeniden gönderiliyor. Sesli girişteki desenin aynısı —
  // zaten onay vermiş kullanıcıya her seferinde ekstra bir adım göstermemek
  // için, ve yalnızca bunun için yeni bir "rıza durumu" endpoint'i açmamak
  // için.
  hasConsent?: boolean;
  onConsentGranted: () => void;
  onClose: () => void;
}) {
  const [consentPending, setConsentPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reviewRows, setReviewRows] = useState<ReviewRow[] | null>(null);
  // Ayrıştırılmış ama henüz bir karta atanmamış satırlar. Mükerrer tespiti
  // (toReviewRows) kart id'si olmadan yapılamıyor, o yüzden ham satırlar
  // burada bekliyor ve kart seçilir seçilmez inceleme satırlarına çevriliyor.
  const [rawRows, setRawRows] = useState<StatementRow[] | null>(null);
  const [selectedCard, setSelectedCard] = useState<CreditCard | null>(null);
  const [newCardName, setNewCardName] = useState("");
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [cardPending, setCardPending] = useState(false);
  // Sunucu rıza istediğinde dosyayı saklıyoruz: onaydan sonra kullanıcı
  // dosyayı yeniden seçmek zorunda kalmasın.
  const [needsConsent, setNeedsConsent] = useState(false);
  const pendingFileRef = useRef<File | null>(null);
  const [suggestedDays, setSuggestedDays] = useState<{ statement_day: number; payment_day: number } | null>(
    null,
  );
  // statementDate = bu ekstrenin dönem kimliği (Hesap Kesim Tarihi) —
  // importStatementEntries'e geçiriliyor, statement_imports geçmiş
  // kaydının anahtarı (src/lib/actions/statements.ts). paymentDueDate ise
  // yalnızca bilgi amaçlı gösteriliyor (içe aktarma sonrası isteğe bağlı
  // ödeme adımında "Son ödeme tarihi: ...") — cash_out_at kavramı
  // card_payment modeliyle yer değiştirdiği için artık nakit akışı
  // hesaplarına girmiyor.
  const [statementDate, setStatementDate] = useState<string | null>(null);
  // Kesim tarihi ayrıştırmadan mı geldi, kullanıcı mı girdi? Ayrıştırmadan
  // geldiyse özet olarak gösterilir; gelmediyse (LLM özet adaylarında
  // bulamadı ya da bulduğu değer makul çıkmadı) kullanıcıya düzenlenebilir
  // bir tarih alanı sunulur.
  const [statementDateAutoDetected, setStatementDateAutoDetected] = useState(false);
  const [paymentDueDate, setPaymentDueDate] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // İçe aktarma başarılı olduktan sonra, hâlâ kalan bir borç varsa
  // gösterilen isteğe bağlı adım — kullanıcı bu dönem için AYRICA ne kadar
  // ödediğini/ödeyeceğini (tam/kısmi/asgari) burada bildirir; "Atla" da
  // tamamen geçerli bir seçim (borç Kartlar sayfasında creditCardDebtBalance
  // ile zaten görünür kalır, sonra da ödenebilir). Ekstredeki "odeme"
  // satırları bu adımdan AYRI ve otomatik zaten card_payment olarak
  // eklendiği için (handleImport), kalan borç 0 ya da altındaysa (o dönem
  // zaten tam/fazla ödenmiş) bu adım hiç gösterilmiyor — sorulacak bir şey
  // kalmıyor.
  const [postImportTotal, setPostImportTotal] = useState<number | null>(null);
  // Az önce otomatik eklenen ödeme sayısı/toplamı — postImportPayment
  // adımının üstünde "bu, ayrı bir yeni ödeme" notunu göstermek için.
  const [autoRecordedPayments, setAutoRecordedPayments] = useState<{ count: number; total: number }>({
    count: 0,
    total: 0,
  });
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(() => toDateString(new Date()));
  const [payError, setPayError] = useState<string | undefined>();
  const [payPending, setPayPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: existingEntries } = useSWR<Entry[]>(ENTRIES_KEY, entriesFetcher);
  const { data: cards } = useSWR<CreditCard[]>(CREDIT_CARDS_KEY, creditCardsFetcher);
  const { data: statementImports } = useSWR<StatementImport[]>(
    STATEMENT_IMPORTS_KEY,
    statementImportsFetcher,
  );
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("statements");
  const tCommon = useTranslations("common");
  const tCategory = useTranslations("ledger.category");

  // Prop olarak gelen kart (Kartlar sayfası) ya da bu akışta seçilen/oluşturulan
  // kart. Aşağıdaki her şey bunun üzerinden çalışıyor.
  const activeCard = card ?? selectedCard;

  // Kart belli olduğu anda ham satırları inceleme satırlarına çevirir —
  // mükerrer tespiti kart id'sine bağlı olduğu için ancak burada yapılabiliyor.
  function attachCard(target: CreditCard, rows: StatementRow[], fromStatement: boolean) {
    setSelectedCard(target);
    setReviewRows(toReviewRows(rows, existingEntries ?? [], target.id));
    setRawRows(null);
    // Yeni oluşturulan kartın günleri zaten ekstreden geldi — ona "günlerini
    // güncelleyeyim mi" diye sormanın anlamı yok. Yalnızca MEVCUT bir kartın
    // kayıtlı günleri ekstredekinden farklıysa öneri gösteriliyor.
    if (fromStatement) return;
    const sDay = dayOfMonth(statementDate);
    const pDay = dayOfMonth(paymentDueDate);
    if (sDay && pDay && (sDay !== target.statement_day || pDay !== target.payment_day)) {
      setSuggestedDays({ statement_day: sDay, payment_day: pDay });
    }
  }

  async function handleCreateCard() {
    const name = newCardName.trim();
    if (!name || !rawRows) return;
    setCardPending(true);
    setError(undefined);
    const formData = new FormData();
    formData.append("name", name);
    // Ekstreden okunamadıysa ayın 1'i — kullanıcı kartı sonradan Kartlar
    // sayfasından düzeltebilir; akışı burada bir tarih sorusuyla durdurmak
    // "önce yükle" fikrinin tamamını bozardı.
    formData.append("statement_day", String(dayOfMonth(statementDate) ?? 1));
    formData.append("payment_day", String(dayOfMonth(paymentDueDate) ?? 1));
    const result = await addCreditCard({}, formData);
    setCardPending(false);
    if (!result.success || !result.card) {
      setError(result.error ?? t("errors.saveFailed"));
      return;
    }
    mutate(CREDIT_CARDS_KEY, (current: CreditCard[] | undefined) => [...(current ?? []), result.card!], {
      revalidate: false,
    });
    router.refresh();
    attachCard(result.card, rawRows, true);
  }

  async function handleConsent() {
    setConsentPending(true);
    const result = await recordStatementConsent();
    setConsentPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onConsentGranted();
    setNeedsConsent(false);
    // Rıza dosya seçildikten sonra istendiyse, o dosyayı şimdi gönder.
    const pending = pendingFileRef.current;
    if (pending) {
      pendingFileRef.current = null;
      void parseFile(pending);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void parseFile(file);
  }

  async function parseFile(file: File) {
    setError(undefined);
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/statements/parse", { method: "POST", body: formData });
      const result = await res.json();
      if (res.status === 403 && result?.consentRequired) {
        pendingFileRef.current = file;
        setNeedsConsent(true);
        setUploading(false);
        return;
      }
      if (!res.ok) {
        setError(result.error ?? t("errors.parseFailed"));
        setUploading(false);
        return;
      }
      setStatementDate(result.header?.statementDate ?? null);
      setStatementDateAutoDetected(Boolean(result.header?.statementDate));
      setPaymentDueDate(result.header?.paymentDueDate ?? null);

      if (card) {
        // Kart baştan belliydi (Kartlar sayfasındaki kart başına düğme) —
        // doğrudan incelemeye geç, eski davranışın aynısı.
        setReviewRows(toReviewRows(result.rows, existingEntries ?? [], card.id));
        const sDay = dayOfMonth(result.header?.statementDate ?? null);
        const pDay = dayOfMonth(result.header?.paymentDueDate ?? null);
        if (sDay && pDay && (sDay !== card.statement_day || pDay !== card.payment_day)) {
          setSuggestedDays({ statement_day: sDay, payment_day: pDay });
        }
      } else {
        // Kart yok: satırlar kart adımında bekliyor.
        setRawRows(result.rows);
      }
    } catch {
      setError(t("errors.connectionError"));
    } finally {
      setUploading(false);
    }
  }

  async function handleApplySuggestedDays() {
    if (!suggestedDays) return;
    if (!activeCard) return;
    await updateCreditCard(activeCard.id, suggestedDays);
    setSuggestedDays(null);
    router.refresh();
  }

  function toggleRow(index: number) {
    setReviewRows((rows) => rows?.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r)) ?? null);
  }

  function changeCategory(index: number, kategori: (typeof ENTRY_CATEGORIES)[number]) {
    setReviewRows((rows) => rows?.map((r, i) => (i === index ? { ...r, kategori } : r)) ?? null);
  }

  // Bu ekstre (bu kart + bu Hesap Kesim Tarihi) daha önce yüklenmiş mi? —
  // engellemiyor (banka düzeltilmiş bir ekstre yeniden göndermiş olabilir),
  // sadece inceleme ekranında net bir uyarı gösteriyor. Kullanıcı yine de
  // devam ederse ve gerçekten aynı dönemse statement_imports'taki
  // unique(credit_card_id, statement_date) constraint'i sert bir dur işareti
  // koyuyor (errors.alreadyImported).
  const matchingImport = statementDate
    ? statementImports?.find(
        (imp) => imp.credit_card_id === activeCard?.id && imp.statement_date === statementDate,
      )
    : undefined;

  async function handleImport() {
    if (!reviewRows || !statementDate || !activeCard) return;
    const selected = reviewRows.filter((r) => r.selected);
    // "odeme" satırları bir seçim değil — banka bu ödemeyi zaten yaptığını
    // bildiriyor, onay kutusuna bağlı olmadan (zaten hiç gösterilmiyor)
    // card_payment olarak eklenir. Aynı ödeme daha önce elle ("Tam ödedim")
    // kaydedildiyse (alreadyRecorded) tekrar eklenmez.
    const paymentRows = reviewRows.filter((r) => r.tur === "odeme" && !r.alreadyRecorded);
    if (selected.length === 0 && paymentRows.length === 0) return;
    setImporting(true);
    const result = await importStatementEntries(
      selected.map((r) => ({
        replaces_entry_id: r.replaces?.id ?? null,
        tarih: r.tarih,
        aciklama: r.aciklama,
        tutar: r.tutar,
        kategori: r.kategori,
        taksit_index: r.taksit_index,
        taksit_sayisi: r.taksit_sayisi,
      })),
      paymentRows.map((r) => ({ tarih: r.tarih, tutar: r.tutar })),
      activeCard.id,
      statementDate,
      paymentDueDate,
    );
    setImporting(false);
    if (result.success) {
      mutate(ENTRIES_KEY);
      mutate(STATEMENT_IMPORTS_KEY);
      router.refresh();
      // Ödeme önerisinin varsayılanı, sadece bu ekstreden yeni eklenen
      // satırların toplamı DEĞİL (bu, kartta bir önceki dönemden kalan
      // ödenmemiş bakiye varsa gerçek borcu olduğundan düşük gösterirdi) —
      // içe aktarmadan HEMEN ÖNCEki gerçek borç (existingEntries, bu importun
      // henüz eklemediği hâliyle) artı bu importun eklediği toplam, EKSİ bu
      // ekstredeki "odeme" satırlarının (bu importun az önce card_payment
      // olarak eklediği) toplamı — yani kartın şu anki gerçek güncel borcu.
      // "Tam ödedim" tek dokunuşla bunu onaylar; kullanıcı isterse
      // (asgari/kısmi ödeme) düzenler ya da adımı tamamen atlar.
      const priorDebt = creditCardDebtBalance(existingEntries ?? [], activeCard.id);
      const selectedTotal = selected.reduce((sum, r) => sum + r.tutar, 0);
      const paymentsTotal = paymentRows.reduce((sum, r) => sum + r.tutar, 0);
      const totalDebt = priorDebt + selectedTotal - paymentsTotal;
      if (totalDebt <= 0) {
        // Ekstredeki ödemeler bu dönemin borcunu zaten tam (ya da
        // fazlasıyla) kapattı — sorulacak bir şey kalmadı, adımı hiç
        // gösterme. creditCardDebtBalance'ın kendisi (Kartlar sayfası)
        // negatifse "fazla ödendi" olarak zaten görünür kalıyor.
        onClose();
        return;
      }
      setPostImportTotal(totalDebt);
      setAutoRecordedPayments({ count: paymentRows.length, total: paymentsTotal });
      setPayAmount(totalDebt.toFixed(2));
      setPayDate(toDateString(new Date()));
    } else {
      setError(result.error);
    }
  }

  async function handleSavePayment() {
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError(t("errors.genericInvalid"));
      return;
    }
    if (!activeCard) return;
    setPayPending(true);
    setPayError(undefined);
    const result = await payCreditCardDebt(activeCard.id, amount, payDate);
    setPayPending(false);
    if (result.success) {
      mutate(ENTRIES_KEY);
      router.refresh();
      onClose();
    } else {
      setPayError(result.error);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>
            {activeCard ? t("uploadSheetTitle", { name: activeCard.name }) : t("uploadSheetTitleGeneric")}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("uploadSheetDescription")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {postImportTotal !== null ? (
            <div className="flex flex-col gap-3">
              {/* Ekstredeki "odeme" satırları burada sorulan alanla AYNI
                  şey değil — o zaten otomatik ve kendi (geçmiş) tarihiyle
                  kaydedildi. Bu not olmadan art arda görününce "bunu az
                  önce sormadı mı" izlenimi veriyordu. */}
              {autoRecordedPayments.count > 0 && (
                <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  {t("postImportPayment.autoRecordedNote", {
                    count: autoRecordedPayments.count,
                    total: formatCurrency(autoRecordedPayments.total, locale),
                  })}
                </p>
              )}
              <p className="text-sm text-foreground">{t("postImportPayment.prompt")}</p>
              {paymentDueDate && (
                <p className="text-xs text-muted-foreground">
                  {t("postImportPayment.dueDate", { date: formatDate(paymentDueDate, locale) })}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">{t("postImportPayment.amountLabel")}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="min-h-touch rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">{t("postImportPayment.dateLabel")}</span>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="min-h-touch rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {payError && <p className="text-sm text-signal-caution-foreground">{payError}</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                  {t("postImportPayment.skip")}
                </Button>
                <Button type="button" className="flex-1" disabled={payPending} onClick={handleSavePayment}>
                  {payPending ? tCommon("saving") : t("postImportPayment.save")}
                </Button>
              </div>
            </div>
          ) : hasConsent === false || needsConsent ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">{t("consentText")}</p>
              {error && <p className="text-sm text-signal-caution-foreground">{error}</p>}
              <Button type="button" size="touch" disabled={consentPending} onClick={handleConsent}>
                {consentPending ? tCommon("saving") : t("consentAccept")}
              </Button>
            </div>
          ) : rawRows ? (
            // KART ADIMI — ayrıştırma bitti, satırlar hazır, geriye sadece
            // "bu hangi kart" sorusu kaldı. Bu adım kasıtlı olarak yüklemeden
            // SONRA: yeni bir kart için gereken kesim/son ödeme günleri
            // ekstrenin içinden çıktığı için form burada tek bir isim alanına
            // iniyor.
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">
                {t("assignCard.prompt", { count: rawRows.length })}
              </p>
              {statementDate && (
                <p className="text-xs text-muted-foreground">
                  {t("assignCard.period", { month: formatMonthYear(statementDate, locale) })}
                </p>
              )}

              {!newCardOpen && (cards?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-2">
                  {cards!.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => attachCard(c, rawRows, false)}
                      className="flex min-h-touch items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("assignCard.cardDays", { statementDay: c.statement_day, paymentDay: c.payment_day })}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {newCardOpen || (cards?.length ?? 0) === 0 ? (
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="new-card-name">{t("assignCard.nameLabel")}</Label>
                    <Input
                      id="new-card-name"
                      value={newCardName}
                      onChange={(e) => setNewCardName(e.target.value)}
                      placeholder={t("assignCard.namePlaceholder")}
                      autoFocus
                      maxLength={50}
                    />
                  </div>
                  {/* Günler ekstreden okundu — kullanıcıya sadece BİLGİ olarak
                      gösteriliyor, doldurulacak alan olarak değil. Okunamadıysa
                      ayın 1'i varsayılıyor ve bu da açıkça yazılıyor. */}
                  <p className="text-xs text-muted-foreground">
                    {dayOfMonth(statementDate) && dayOfMonth(paymentDueDate)
                      ? t("assignCard.daysFromStatement", {
                          statementDay: dayOfMonth(statementDate)!,
                          paymentDay: dayOfMonth(paymentDueDate)!,
                        })
                      : t("assignCard.daysUnknown")}
                  </p>
                  <Button
                    type="button"
                    size="touch"
                    disabled={cardPending || newCardName.trim().length === 0}
                    onClick={handleCreateCard}
                  >
                    {cardPending ? tCommon("saving") : t("assignCard.createAndContinue")}
                  </Button>
                  {(cards?.length ?? 0) > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setNewCardOpen(false)}>
                      {t("assignCard.backToList")}
                    </Button>
                  )}
                </div>
              ) : (
                <Button type="button" variant="outline" size="touch" onClick={() => setNewCardOpen(true)}>
                  {t("assignCard.newCard")}
                </Button>
              )}

              {error && <p className="text-sm text-signal-caution-foreground">{error}</p>}
            </div>
          ) : !reviewRows ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t("uploadHint")}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                size="touch"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? t("uploading") : t("chooseFile")}
              </Button>
              {error && <p className="text-sm text-signal-caution-foreground">{error}</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Kullanıcı "hangi ayı yüklüyorum" sorusuna içe aktarmadan
                  önce net cevap alsın diye — ayrıştırılan kesim tarihinden
                  türetiliyor, elle bir ay seçtirmek yerine (ayrıştırma
                  güvenilir, göstermek yeterli). */}
              {statementDateAutoDetected ? (
                <p className="text-sm text-muted-foreground">
                  {t("periodLabel", {
                    month: formatMonthYear(statementDate!, locale),
                    statementDate: formatDate(statementDate!, locale),
                    paymentDate: paymentDueDate ? formatDate(paymentDueDate, locale) : "—",
                  })}
                </p>
              ) : (
                // Kesim tarihi artık banka başına regex ile değil, ekstre
                // özeti adaylarından LLM seçimiyle bulunuyor ve makul olmayan
                // değerler null'a düşürülüyor (bkz.
                // src/lib/statement-import/schema.ts) — yani "bulunamadı"
                // gerçek ve beklenen bir durum. Eskiden bu durumda
                // handleImport sessizce hiçbir şey yapmıyordu (buton
                // tıklanıyor, hiçbir şey olmuyordu); artık kullanıcı dönemi
                // kendisi giriyor ve içe aktarma o zamana kadar kapalı.
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3">
                  <span className="text-sm text-foreground">{t("statementDateMissing")}</span>
                  <input
                    type="date"
                    value={statementDate ?? ""}
                    onChange={(e) => setStatementDate(e.target.value || null)}
                    className="min-h-touch rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              )}
              {matchingImport && (
                <div className="flex items-start gap-2 rounded-lg border border-signal-caution-foreground/30 bg-signal-caution-bg p-3 text-sm text-signal-caution-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {t("alreadyImportedWarning", {
                      date: formatDate(matchingImport.created_at, locale),
                      count: matchingImport.imported_count,
                      total: formatCurrency(matchingImport.imported_total, locale),
                    })}
                  </span>
                </div>
              )}
              {suggestedDays && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  <span className="text-foreground">
                    {t("suggestDaysUpdate", {
                      statementDay: suggestedDays.statement_day,
                      paymentDay: suggestedDays.payment_day,
                    })}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={handleApplySuggestedDays}>
                    {tCommon("save")}
                  </Button>
                </div>
              )}

              {reviewRows.length > 0 && (
                <Button
                  type="button"
                  size="touch"
                  disabled={importing || !statementDate}
                  onClick={handleImport}
                >
                  {importing
                    ? tCommon("saving")
                    : t("importSelected", { count: reviewRows.filter((r) => r.selected).length })}
                </Button>
              )}

              {reviewRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noTransactionsFound")}</p>
              ) : (
                // Bir gerçek ekstre 100'e yakın satır getirebiliyor (bkz.
                // QNB testi) — "Ekle" butonu artık listenin ÜSTÜNde
                // (kullanıcı testinde: butonu SheetFooter'da altta tutmak
                // + listeyi kendi scroll'una sahip yapmak iki iç içe
                // scrollbar'a yol açtı, biri portalı biri listeyi
                // kaydırıyordu — kafa karıştırıcıydı). Buton hiç
                // kaydırmadan her zaman görünür olduğu için liste burada
                // hâlâ kendi max-h/overflow-y-auto'sunu koruyor, ama artık
                // sadece "sheet sonsuz uzamasın" içindir, butona erişmek
                // için değil.
                <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
                  {reviewRows.map((row, i) =>
                    // "odeme" satırları harcama değil, bankaya yapılan
                    // ödeme — onay kutusu/kategori yok, çünkü seçime bağlı
                    // değil: card_payment olarak otomatik eklenir (bkz.
                    // handleImport). Burada sadece hangi ödemenin
                    // eklendiğini (ya da zaten kayıtlı olduğu için
                    // atlandığını) şeffaf göstermek için var.
                    row.tur === "odeme" ? (
                      <div
                        key={i}
                        className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-foreground">{row.aciklama}</span>
                            <span className="shrink-0 font-semibold text-signal-buy-foreground">
                              {formatCurrency(row.tutar, locale)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{formatDate(row.tarih, locale)}</span>
                            <Badge variant="outline">{t("rowType.odeme")}</Badge>
                            <Badge variant="outline">
                              {t(row.alreadyRecorded ? "paymentAlreadyRecorded" : "paymentWillBeAdded")}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <label
                        key={i}
                        className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
                      >
                        <Checkbox checked={row.selected} onCheckedChange={() => toggleRow(i)} className="mt-0.5" />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-foreground">{row.aciklama}</span>
                            <span className="shrink-0 font-semibold text-foreground">
                              {formatCurrency(row.tutar, locale)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{formatDate(row.tarih, locale)}</span>
                            {row.tur !== "harcama" && <Badge variant="outline">{t(`rowType.${row.tur}`)}</Badge>}
                            {row.taksit_index && row.taksit_sayisi && (
                              <Badge variant="outline">
                                {row.taksit_index}/{row.taksit_sayisi}
                              </Badge>
                            )}
                            {row.replaces && (
                              <Badge variant="outline" className="gap-1">
                                {t("replacesManualEntry", { original: row.replaces.label })}
                              </Badge>
                            )}
                            {row.possibleDuplicate && (
                              // Rozet artık GEREKÇESİNİ taşıyor. Eşleştirme
                              // sezgisel (tutar + yakın tarih) ve kanıt
                              // değil — hangi kayıtla eşleştiğini
                              // göstermeden kullanıcıyı sezgisele güvenmek
                              // zorunda bırakıyorduk. Tarih + tutar yazılınca
                              // kararı kendisi verebiliyor.
                              <Badge variant="outline" className="gap-1 text-signal-caution-foreground">
                                <AlertTriangle className="size-3" />
                                {row.duplicateOf
                                  ? t("possibleDuplicateOf", {
                                      date: formatDate(row.duplicateOf.occurred_at, locale),
                                      amount: formatCurrency(row.duplicateOf.amount, locale),
                                    })
                                  : t("possibleDuplicate")}
                              </Badge>
                            )}
                            {/* AI'nın kategori tahmini — yanlışsa kaydetmeden
                                önce burada düzeltilebilir, sessizce
                                güvenilmiyor. */}
                            <select
                              value={row.kategori}
                              onChange={(e) =>
                                changeCategory(i, e.target.value as (typeof ENTRY_CATEGORIES)[number])
                              }
                              className="min-h-touch rounded-md border border-input bg-background px-1.5 py-0.5 text-xs"
                            >
                              {ENTRY_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>
                                  {tCategory(cat)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </label>
                    ),
                  )}
                </div>
              )}

              {error && <p className="text-sm text-signal-caution-foreground">{error}</p>}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
