"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { Loader2, Mic, Square } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { recordVoiceConsent, addVoiceEntries } from "@/lib/actions/voice";
import { parseVoiceResult, type VoiceDraft } from "@/lib/voice";
import { ENTRY_CATEGORIES, categoryLabel, toDateString } from "@/lib/ledger";
import type { Category } from "@/lib/categories-data";
import type { CreditCard } from "@/lib/credit-cards-data";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { useVoiceRecorder } from "./useVoiceRecorder";

const QuickEntryForm = dynamic(
  () => import("@/components/ledger/QuickEntryForm").then((m) => m.QuickEntryForm),
  { loading: () => <div className="h-64" /> },
);

const CATEGORIES_KEY = "/api/categories";
const categoriesFetcher = (url: string) => fetch(url).then((res) => res.json());

// Kullanıcının yerel tarihi — sunucu UTC'de koştuğu için "dün"ü doğru
// çözebilmek adına tarihi client gönderiyor (route.ts bunu ±2 günle
// doğruluyor). toISOString() KULLANILMAZ: UTC parçalarını okur, gece yarısı
// civarında bir gün kayar.
function todayDateString(): string {
  return toDateString(new Date());
}

type ReviewItem = VoiceDraft & { selected: boolean };

// Sesli giriş butonu — AÇ/KAPA. İlk sürüm bas-konuş (pointer capture) idi;
// kullanıcı parmağı ekranda tutmanın rahatsız olduğunu, özellikle birden
// fazla harcamayı arka arkaya sayarken, geri bildirdi. Artık tıkla-başlat /
// tıkla-bitir ve simge kayıt sırasında dur işaretine dönüyor.
export function VoiceEntryButton({
  className,
  variant = "outline",
  showLabel = false,
}: {
  className?: string;
  variant?: "outline" | "secondary" | "default";
  // Satır içi aksiyon çubuğunda metinli, dar yerlerde yalnızca simge.
  showLabel?: boolean;
}) {
  const t = useTranslations("ledger.voice");
  const tCommon = useTranslations("common");
  const tLedger = useTranslations("ledger");
  const locale = useLocale() as AppLocale;
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  // Tek kalem: formu önceden doldur. Birden fazla: inceleme listesi.
  const [singleDraft, setSingleDraft] = useState<VoiceDraft | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[] | null>(null);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [transcript, setTranscript] = useState("");
  const [saving, setSaving] = useState(false);
  // Onay verildikten sonra kullanıcıyı yeniden konuşturmamak için son kaydı
  // tutuyoruz — onay diyaloğu kaydın ARDINDAN çıkıyor (sunucu 403 döndüğünde),
  // o yüzden ses zaten elimizde.
  const pendingAudioRef = useRef<Blob | null>(null);

  // İnceleme listesindeki kategori seçicisi kullanıcının kendi etiketlerini de
  // göstermeli — QuickEntryForm ile aynı SWR anahtarı.
  const { data: customCategories } = useSWR<Category[]>(CATEGORIES_KEY, categoriesFetcher);

  const showError = useCallback((key: string) => {
    setErrorText(null);
    setErrorKey(key);
  }, []);

  const upload = useCallback(
    async (wav: Blob) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        pendingAudioRef.current = null;
        setUploading(false);
        setErrorKey(null);
        setErrorText(t("offline"));
        return;
      }

      setUploading(true);
      setErrorKey(null);
      setErrorText(null);

      const body = new FormData();
      body.append("audio", wav, "kayit.wav");
      body.append("todayDate", todayDateString());

      try {
        const res = await fetch("/api/voice", { method: "POST", body });
        // Route'daki aynı gerekçe: sunucu tarafında beklenmeyen bir hata
        // olursa Next JSON değil HTML bir hata sayfası döndürüyor ve
        // res.json() anlamsız bir SyntaxError fırlatıyordu. Ham gövdeyi
        // konsola yazmak, gerçek hatayı görmenin tek yolu.
        const rawBody = await res.text();
        let payload: Record<string, unknown> | null = null;
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          pendingAudioRef.current = null;
          setUploading(false);
          console.error("[sesli giriş] sunucu JSON değil yanıt döndürdü", {
            httpStatus: res.status,
            contentType: res.headers.get("content-type"),
            bodyPreview: rawBody.slice(0, 500),
          });
          showError("transcribeFailed");
          return;
        }

        if (res.status === 403 && payload?.consentRequired) {
          pendingAudioRef.current = wav;
          setUploading(false);
          setConsentOpen(true);
          return;
        }

        if (!res.ok) {
          pendingAudioRef.current = null;
          setUploading(false);
          // Ekranda kullanıcı dostu metin duruyor, ama gerçek sebep konsolda:
          // ör. "http_429 model=gemini-3.7-flash" (kota) veya
          // "empty_response finishReason=MAX_TOKENS" (düşünme bütçeyi yedi).
          console.error("[sesli giriş] başarısız", {
            httpStatus: res.status,
            code: payload?.code,
            reason: payload?.reason,
            message: payload?.error,
          });
          setErrorText(
            typeof payload?.error === "string" ? payload.error : t("errors.transcribeFailed"),
          );
          return;
        }

        pendingAudioRef.current = null;
        setUploading(false);

        const cardList: CreditCard[] = Array.isArray(payload?.cards) ? payload.cards : [];
        setCards(cardList);

        const result = parseVoiceResult(payload, ENTRY_CATEGORIES, cardList);
        setTranscript(result.transcript);
        // Transkript konsolda da dursun: "ne dedim, o ne duydu" karşılaştırması
        // hata ayıklarken en hızlı yol.
        console.info("[sesli giriş] duyulan:", result.transcript);
        if (!result.understood || result.items.length === 0) {
          showError("notUnderstood");
          return;
        }

        // Tek kalemde inceleme listesi göstermek gereksiz bir adım olurdu —
        // form zaten dolu geliyor ve kullanıcı orada her alanı düzeltebiliyor.
        if (result.items.length === 1) {
          setSingleDraft(result.items[0]);
          return;
        }
        // Kuru getirilebilen dövizli kalemler de varsayılan seçili — kur
        // rotada ekleniyor (src/app/api/voice/route.ts).
        setReviewItems(
          result.items.map((item) => ({
            ...item,
            selected: item.currency === "TRY" || (item.fx_rate !== null && item.fx_rate > 0),
          })),
        );
      } catch (err) {
        pendingAudioRef.current = null;
        setUploading(false);
        console.error("[sesli giriş] ağ/istek hatası", err);
        showError("connectionError");
      }
    },
    [showError, t],
  );

  const { state, start, stop, reset } = useVoiceRecorder({
    onResult: (wav) => {
      reset();
      void upload(wav);
    },
    onError: showError,
  });

  const recording = state === "recording" || state === "starting";
  const busy = state === "processing" || uploading;

  function handleToggle() {
    if (recording) {
      stop();
      return;
    }
    setErrorKey(null);
    setErrorText(null);
    void start();
  }

  async function handleConsent() {
    setConsentPending(true);
    const result = await recordVoiceConsent();
    setConsentPending(false);
    if (result.error) {
      setErrorText(result.error);
      setConsentOpen(false);
      return;
    }
    setConsentOpen(false);
    const pending = pendingAudioRef.current;
    if (pending) void upload(pending);
  }

  // Tek bir kalemin tek bir alanını günceller. Liste tamamen düzenlenebilir:
  // model yanlış duymuş ya da ödeme yöntemini bilemiyor olabilir, kullanıcı
  // kaydetmeden önce burada düzeltiyor (ekstre incelemesindeki aynı gerekçe).
  function updateItem(index: number, patch: Partial<ReviewItem>) {
    setReviewItems((rows) => rows?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? null);
  }

  async function handleSaveReview() {
    if (!reviewItems) return;
    const selected = reviewItems.filter((item) => item.selected);
    if (selected.length === 0) return;
    setSaving(true);
    setErrorText(null);
    const result = await addVoiceEntries(
      selected.map((item) => ({
        kind: item.kind,
        amount: tryAmountOf(item)!,
        category: item.category,
        description: item.description,
        occurred_at: item.occurred_at ?? todayDateString(),
        recurrence: item.recurrence,
        installmentCount: item.installmentCount,
        credit_card_id: item.credit_card_id,
        original_amount: item.currency === "TRY" ? null : item.amount,
        original_currency: item.currency === "TRY" ? null : item.currency,
        fx_rate: item.currency === "TRY" ? null : item.fx_rate,
        fx_rate_date: item.currency === "TRY" ? null : item.fx_rate_date,
      })),
    );
    setSaving(false);
    if (result.error) {
      setErrorText(result.error);
      return;
    }
    mutate("/api/entries");
    router.refresh();
    setReviewItems(null);
  }

  // Bir kalemin deftere yazılacak TL tutarı. Dövizli kalemde kur yoksa null —
  // o kalem seçilemiyor, çünkü uydurma kurla kayıt yapmak yasak (kural 5).
  function tryAmountOf(item: ReviewItem): number | null {
    if (item.amount === null || item.amount <= 0) return null;
    if (item.currency === "TRY") return item.amount;
    if (item.fx_rate === null || item.fx_rate <= 0) return null;
    return Math.round(item.amount * item.fx_rate * 100) / 100;
  }

  const selectedCount = reviewItems?.filter((i) => i.selected).length ?? 0;
  // Yabancı para birimi duyulan kalemler kaydedilemez: kur çevirisi kasıtlı
  // olarak yapılmıyor (CLAUDE.md kural 5), o yüzden listede uyarıyla
  // gösteriliyor ve tutarını kullanıcı kendisi girene kadar seçilemiyorlar.
  const hasForeign = reviewItems?.some((i) => i.currency !== "TRY") ?? false;
  const categoryOptions = [
    ...ENTRY_CATEGORIES,
    ...(customCategories ?? [])
      .map((c) => c.name)
      .filter((name) => !(ENTRY_CATEGORIES as readonly string[]).includes(name)),
  ];

  const fieldClass =
    "border-input bg-background min-h-touch rounded-md border px-2 py-1 text-xs";

  return (
    <>
      <Button
        type="button"
        size={showLabel ? "touch" : "icon-touch"}
        variant={recording ? "destructive" : variant}
        disabled={busy}
        aria-label={t("holdToTalk")}
        aria-pressed={recording}
        className={cn("rounded-full", recording && "animate-pulse", className)}
        onClick={handleToggle}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : recording ? (
          <Square className="size-4 fill-current" />
        ) : (
          <Mic className="size-4" />
        )}
        {showLabel ? (recording ? t("stop") : busy ? t("processing") : t("holdToTalk")) : null}
      </Button>

      {(errorKey || errorText) && !reviewItems && (
        <p role="alert" className="text-destructive w-full text-xs">
          {errorText ?? t(`errors.${errorKey}`)}
        </p>
      )}

      {/* Tek kalem, doğrudan dolu form */}
      <Sheet open={singleDraft !== null} onOpenChange={(open) => !open && setSingleDraft(null)}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t("singleSheetTitle")}</SheetTitle>
            <SheetDescription className="sr-only">{t("singleSheetDescription")}</SheetDescription>
          </SheetHeader>
          {singleDraft && (
            <QuickEntryForm
              key={`${singleDraft.description}-${singleDraft.amount}`}
              onSaved={() => setSingleDraft(null)}
              draft={singleDraft}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Birden fazla kalem, DÜZENLENEBİLİR inceleme listesi. Model yanlış
          duymuş, kategoriyi şaşırmış ya da ödeme yöntemini bilemiyor olabilir
          — her alan kaydetmeden önce burada düzeltilebiliyor. */}
      <Sheet open={reviewItems !== null} onOpenChange={(open) => !open && setReviewItems(null)}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t("reviewTitle", { count: reviewItems?.length ?? 0 })}</SheetTitle>
            <SheetDescription className="sr-only">{t("reviewDescription")}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-6">
            <Button
              type="button"
              size="touch"
              disabled={saving || selectedCount === 0}
              onClick={handleSaveReview}
            >
              {saving ? tCommon("saving") : t("saveSelected", { count: selectedCount })}
            </Button>
            {hasForeign && <p className="text-muted-foreground text-xs">{t("foreignCurrency")}</p>}
            {transcript && (
              <p className="text-muted-foreground border-border rounded-lg border border-dashed px-3 py-2 text-xs">
                <span className="font-medium">{t("heard")}</span> “{transcript}”
              </p>
            )}
            <p className="text-muted-foreground text-xs">{t("editHint")}</p>

            <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
              {reviewItems?.map((item, i) => (
                <div key={i} className="border-border flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={item.selected}
                      disabled={tryAmountOf(item) === null}
                      onCheckedChange={() => updateItem(i, { selected: !item.selected })}
                      aria-label={item.description || t("itemLabel", { index: i + 1 })}
                    />
                    <input
                      type="text"
                      value={item.description}
                      maxLength={200}
                      onChange={(e) => updateItem(i, { description: e.target.value })}
                      className={cn(fieldClass, "min-w-0 flex-1 text-sm")}
                      aria-label={tLedger("form.descriptionLabel")}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={item.amount ?? ""}
                      onChange={(e) =>
                        updateItem(i, {
                          amount: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className={cn(fieldClass, "w-24 shrink-0 text-right text-sm font-semibold")}
                      aria-label={tLedger("form.amountLabel")}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {item.kind === "income" && <Badge variant="outline">{tLedger("kind.income")}</Badge>}
                    <select
                      value={item.category}
                      onChange={(e) => updateItem(i, { category: e.target.value })}
                      className={cn(fieldClass, "flex-1")}
                      aria-label={tLedger("form.categoryLabel")}
                    >
                      {categoryOptions.map((cat) => (
                        <option key={cat} value={cat}>
                          {categoryLabel(tLedger, cat)}
                        </option>
                      ))}
                    </select>
                    {/* Ödeme yöntemi — "" = Nakit/Banka. Kullanıcı "kredi
                        kartı" dediğinde ve birden fazla kartı olduğunda model
                        kasıtlı olarak boş bırakıyor, seçim burada yapılıyor. */}
                    {item.kind !== "income" && (
                      <select
                        value={item.credit_card_id}
                        onChange={(e) => updateItem(i, { credit_card_id: e.target.value })}
                        className={cn(fieldClass, "flex-1")}
                        aria-label={tLedger("form.paymentMethodLabel")}
                      >
                        <option value="">{tLedger("form.paymentMethodCash")}</option>
                        {cards.map((card) => (
                          <option key={card.id} value={card.id}>
                            {card.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      type="date"
                      value={item.occurred_at ?? todayDateString()}
                      onChange={(e) => updateItem(i, { occurred_at: e.target.value || null })}
                      className={cn(fieldClass, "flex-1")}
                      aria-label={tLedger("form.dateLabel")}
                    />
                  </div>

                  {item.currency !== "TRY" &&
                    (tryAmountOf(item) !== null ? (
                      <p className="text-muted-foreground text-xs">
                        {t("foreignConverted", {
                          original: `${item.amount} ${item.currency}`,
                          amount: formatCurrency(tryAmountOf(item)!, locale),
                          date: item.fx_rate_date ?? "",
                        })}
                      </p>
                    ) : (
                      <p className="text-signal-caution-foreground text-xs">
                        {t("foreignNoRate", { currency: item.currency })}
                      </p>
                    ))}
                  {item.installmentCount ? (
                    <p className="text-muted-foreground text-xs">
                      {t("installments", { count: item.installmentCount })} ·{" "}
                      {formatCurrency(item.amount ?? 0, locale)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {errorText && <p className="text-destructive text-sm">{errorText}</p>}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("consent.title")}</DialogTitle>
            <DialogDescription>{t("consent.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={() => {
                pendingAudioRef.current = null;
                setConsentOpen(false);
              }}
            >
              {t("consent.cancel")}
            </Button>
            <Button type="button" size="touch" disabled={consentPending} onClick={handleConsent}>
              {t("consent.accept")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
