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
import { recordStatementConsent, importStatementEntries } from "@/lib/actions/statements";
import { updateCreditCard } from "@/lib/actions/credit-cards";
import { formatCurrency, formatDate } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { CreditCard } from "@/lib/credit-cards-data";
import { ENTRY_CATEGORIES, type Entry } from "@/lib/ledger";

type StatementRow = {
  tarih: string;
  aciklama: string;
  tutar: number;
  tur: "harcama" | "odeme" | "ucret";
  kategori: (typeof ENTRY_CATEGORIES)[number];
  taksit_index: number | null;
  taksit_sayisi: number | null;
};

type ReviewRow = StatementRow & { selected: boolean; possibleDuplicate: boolean };

const ENTRIES_KEY = "/api/entries";
const entriesFetcher = (url: string) => fetch(url).then((res) => res.json());

function toReviewRows(rows: StatementRow[], existing: Entry[]): ReviewRow[] {
  return rows.map((row) => {
    // kind === "expense" only would miss a row that started as an import
    // (kind="expense") and was later converted into a real subscription
    // rule (kind="subscription" — src/components/ledger/QuickEntryForm.tsx's
    // "kart harcamalarından abonelik" edit flow) or was already tracked as
    // one: re-uploading the same statement would silently offer it again as
    // a "new" charge instead of flagging it.
    const possibleDuplicate = existing.some(
      (e) =>
        (e.kind === "expense" || e.kind === "subscription") &&
        e.occurred_at === row.tarih &&
        Math.abs(e.amount - row.tutar) < 0.01,
    );
    // "ucret" (faiz/KKDF/BSMV) gerçek bir masraf — varsayılan olarak seçili
    // gelir. "odeme" (kartın kendisine yapılan ödeme) ise yeni bir harcama
    // değil, zaten borcu doğuran asıl harcama ayrı bir satırda sayılıyor —
    // onu da eklemek çift sayım olurdu, o yüzden varsayılan olarak işaretsiz.
    const selected = (row.tur === "harcama" || row.tur === "ucret") && !possibleDuplicate;
    return { ...row, selected, possibleDuplicate };
  });
}

export function StatementUploadSheet({
  card,
  hasConsent,
  onConsentGranted,
  onClose,
}: {
  card: CreditCard;
  hasConsent: boolean;
  onConsentGranted: () => void;
  onClose: () => void;
}) {
  const [consentPending, setConsentPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reviewRows, setReviewRows] = useState<ReviewRow[] | null>(null);
  const [suggestedDays, setSuggestedDays] = useState<{ statement_day: number; payment_day: number } | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: existingEntries } = useSWR<Entry[]>(ENTRIES_KEY, entriesFetcher);
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("statements");
  const tCommon = useTranslations("common");
  const tCategory = useTranslations("ledger.category");

  async function handleConsent() {
    setConsentPending(true);
    const result = await recordStatementConsent();
    setConsentPending(false);
    if (result.success) onConsentGranted();
    else setError(result.error);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(undefined);
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/statements/parse", { method: "POST", body: formData });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? t("errors.parseFailed"));
        setUploading(false);
        return;
      }
      setReviewRows(toReviewRows(result.rows, existingEntries ?? []));
      const statementDay = result.header?.statementDate ? Number(result.header.statementDate.slice(8, 10)) : null;
      const paymentDay = result.header?.paymentDueDate ? Number(result.header.paymentDueDate.slice(8, 10)) : null;
      if (statementDay && paymentDay && (statementDay !== card.statement_day || paymentDay !== card.payment_day)) {
        setSuggestedDays({ statement_day: statementDay, payment_day: paymentDay });
      }
    } catch {
      setError(t("errors.connectionError"));
    } finally {
      setUploading(false);
    }
  }

  async function handleApplySuggestedDays() {
    if (!suggestedDays) return;
    await updateCreditCard(card.id, suggestedDays);
    setSuggestedDays(null);
    router.refresh();
  }

  function toggleRow(index: number) {
    setReviewRows((rows) => rows?.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r)) ?? null);
  }

  function changeCategory(index: number, kategori: (typeof ENTRY_CATEGORIES)[number]) {
    setReviewRows((rows) => rows?.map((r, i) => (i === index ? { ...r, kategori } : r)) ?? null);
  }

  async function handleImport() {
    if (!reviewRows) return;
    const selected = reviewRows.filter((r) => r.selected);
    if (selected.length === 0) return;
    setImporting(true);
    const result = await importStatementEntries(
      selected.map((r) => ({
        tarih: r.tarih,
        aciklama: r.aciklama,
        tutar: r.tutar,
        kategori: r.kategori,
        taksit_index: r.taksit_index,
        taksit_sayisi: r.taksit_sayisi,
      })),
    );
    setImporting(false);
    if (result.success) {
      mutate(ENTRIES_KEY);
      router.refresh();
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{t("uploadSheetTitle", { name: card.name })}</SheetTitle>
          <SheetDescription className="sr-only">{t("uploadSheetDescription")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {!hasConsent ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">{t("consentText")}</p>
              {error && <p className="text-sm text-signal-caution-foreground">{error}</p>}
              <Button type="button" size="touch" disabled={consentPending} onClick={handleConsent}>
                {consentPending ? tCommon("saving") : t("consentAccept")}
              </Button>
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
                <Button type="button" size="touch" disabled={importing} onClick={handleImport}>
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
                  {reviewRows.map((row, i) => (
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
                          {row.possibleDuplicate && (
                            <Badge variant="outline" className="gap-1 text-signal-caution-foreground">
                              <AlertTriangle className="size-3" />
                              {t("possibleDuplicate")}
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
                  ))}
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
