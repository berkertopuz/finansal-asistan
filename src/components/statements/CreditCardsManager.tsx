"use client";

import { useActionState, useState, useSyncExternalStore, type ReactNode } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  BellOff,
  Check,
  CircleDollarSign,
  CreditCard as CardIcon,
  History,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addCreditCard,
  deleteCreditCard,
  payCreditCardDebt,
  updateCreditCard,
  type CreditCardState,
} from "@/lib/actions/credit-cards";
import { deleteEntry } from "@/lib/actions/entries";
import { undoStatementImport } from "@/lib/actions/statements";
import { subscribeToPush } from "@/lib/actions/push";
import type { CreditCard } from "@/lib/credit-cards-data";
import type { StatementImport } from "@/lib/statement-imports-data";
import { creditCardDebtBalance } from "@/lib/cashflow";
import { formatCurrency, formatDate, formatMonthYear } from "@/lib/format";
import { toDateString, type Entry } from "@/lib/ledger";
import type { AppLocale } from "@/lib/locale";
import { StatementUploadSheet } from "@/components/statements/StatementUploadSheet";
import { cn } from "@/lib/utils";

// Bildirim izni sunucuda bilinemez, client'ta bilinir — yani React açısından
// bir "external system" değeri. Bunu `useState(typeof window !== "undefined"
// ? Notification.permission : "unsupported")` ile okumak hydration
// uyuşmazlığına yol açıyordu (gerçek bir çalıştırmada Kartlar sayfasında
// gözlendi: sunucu bildirim kartını hiç basmıyor, client basıyor); useState +
// useEffect'e çevirmek ise effect içinde senkron setState demek oluyor
// (cascading render, eslint hatası). useSyncExternalStore tam bu durum için
// var: ayrı bir sunucu snapshot'ı alıyor, yani sunucu ile client'ın ilk
// render'ı tanımı gereği uyuşuyor.
//
// Aboneliğin gerçek bir işi var: izni biz değiştirdiğimizde
// (handleEnableNotifications içindeki requestPermission) abonelere haber
// veriliyor. Tarayıcı iznin kendiliğinden değiştiğine dair bir olay
// yayınlamıyor, o yüzden başka bir tetikleyici yok.
const notifPermissionListeners = new Set<() => void>();

function subscribeNotifPermission(onStoreChange: () => void): () => void {
  notifPermissionListeners.add(onStoreChange);
  return () => notifPermissionListeners.delete(onStoreChange);
}

function getNotifPermission(): NotificationPermission | "unsupported" {
  return "Notification" in window ? Notification.permission : "unsupported";
}

function getServerNotifPermission(): NotificationPermission | "unsupported" {
  return "unsupported";
}

function notifyNotifPermissionChanged(): void {
  for (const listener of notifPermissionListeners) listener();
}

const CARDS_KEY = "/api/credit-cards";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch credit cards");
    return res.json();
  });

const ENTRIES_KEY = "/api/entries";
const entriesFetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch entries");
    return res.json();
  });

const STATEMENT_IMPORTS_KEY = "/api/statement-imports";
const statementImportsFetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch statement imports");
    return res.json();
  });

// VAPID public key'i pushManager.subscribe'ın beklediği Uint8Array'e çevirir
// — standart, herkesin kullandığı bir dönüşüm (Web Push spesifikasyonunun
// bir parçası, kütüphane değil).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function CreditCardsManager({
  initialCards,
  initialHasConsent,
}: {
  initialCards: CreditCard[];
  initialHasConsent: boolean;
}) {
  const { data: cards } = useSWR<CreditCard[]>(CARDS_KEY, fetcher, { fallbackData: initialCards });
  const { data: entries } = useSWR<Entry[]>(ENTRIES_KEY, entriesFetcher);
  const { data: statementImports } = useSWR<StatementImport[]>(
    STATEMENT_IMPORTS_KEY,
    statementImportsFetcher,
  );
  const [hasConsent, setHasConsent] = useState(initialHasConsent);
  const [addOpen, setAddOpen] = useState(false);
  const [uploadCard, setUploadCard] = useState<CreditCard | null>(null);
  const [payDebtCard, setPayDebtCard] = useState<CreditCard | null>(null);
  const [payDebtAmount, setPayDebtAmount] = useState("");
  const [payDebtDate, setPayDebtDate] = useState(() => toDateString(new Date()));
  const [payDebtError, setPayDebtError] = useState<string | undefined>();
  const [payDebtPending, setPayDebtPending] = useState(false);
  const [historyCard, setHistoryCard] = useState<CreditCard | null>(null);
  const [undoTarget, setUndoTarget] = useState<StatementImport | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [undoError, setUndoError] = useState<string | undefined>();
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<Entry | null>(null);
  const [deletePaymentPending, setDeletePaymentPending] = useState(false);
  const notifState = useSyncExternalStore(
    subscribeNotifPermission,
    getNotifPermission,
    getServerNotifPermission,
  );
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("creditCards");
  const tCommon = useTranslations("common");

  // Ekstre/ödeme günü metinlerindeki <hl> etiketi — sayıyı cümlenin
  // içinden ayırmak icin, çeviri dizesini parçalamadan.
  const hl = (chunks: ReactNode) => (
    <span className="font-medium text-amber-500 dark:text-amber-400">{chunks}</span>
  );

  const [state, formAction, pending] = useActionState<CreditCardState, FormData>(
    async (_prev, formData) => {
      const result = await addCreditCard(_prev, formData);
      if (result.success) {
        mutate(CARDS_KEY);
        router.refresh();
        setAddOpen(false);
      }
      return result;
    },
    {},
  );

  async function handleEnableNotifications() {
    const permission = await Notification.requestPermission();
    // requestPermission zaten Notification.permission'ı güncelliyor; store'un
    // okuyacağı kaynak o, burada yapılacak tek şey abonelere haber vermek.
    notifyNotifPermissionChanged();
    if (permission !== "granted") return;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as BufferSource,
    });
    await subscribeToPush(subscription.toJSON());
  }

  async function handleToggleReminders(card: CreditCard) {
    mutate(
      CARDS_KEY,
      (current: CreditCard[] | undefined) =>
        current?.map((c) => (c.id === card.id ? { ...c, reminders_enabled: !c.reminders_enabled } : c)),
      false,
    );
    await updateCreditCard(card.id, { reminders_enabled: !card.reminders_enabled });
    mutate(CARDS_KEY);
  }

  async function handleDelete(id: string) {
    mutate(CARDS_KEY, (current: CreditCard[] | undefined) => current?.filter((c) => c.id !== id), false);
    await deleteCreditCard(id);
    mutate(CARDS_KEY);
    router.refresh();
  }

  function openPayDebt(card: CreditCard, debt: number) {
    setPayDebtCard(card);
    // Varsayılan = güncel borcun tamamı — kısmi/asgari ödeme için
    // kullanıcı düzenleyebilir, tam ödemede tek dokunuşla onaylayabilir.
    setPayDebtAmount(debt > 0 ? debt.toFixed(2) : "");
    setPayDebtDate(toDateString(new Date()));
    setPayDebtError(undefined);
  }

  async function handlePayDebt() {
    if (!payDebtCard) return;
    const amount = Number(payDebtAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayDebtError(t("payDebt.errors.amountInvalid"));
      return;
    }
    setPayDebtPending(true);
    setPayDebtError(undefined);
    const result = await payCreditCardDebt(payDebtCard.id, amount, payDebtDate);
    setPayDebtPending(false);
    if (result.success) {
      mutate(ENTRIES_KEY);
      router.refresh();
      setPayDebtCard(null);
    } else {
      setPayDebtError(result.error);
    }
  }

  async function handleUndo() {
    if (!undoTarget) return;
    setUndoPending(true);
    setUndoError(undefined);
    const result = await undoStatementImport(undoTarget.id);
    setUndoPending(false);
    if (result.success) {
      // ON DELETE CASCADE bu ekstreden gelen tüm entries satırlarını da
      // sildi (bkz. migration) — hem geçmiş listesi hem borç bakiyesi hem
      // Defter değişti, üçünü de tazele.
      mutate(STATEMENT_IMPORTS_KEY);
      mutate(ENTRIES_KEY);
      router.refresh();
      setUndoTarget(null);
    } else {
      setUndoError(result.error);
    }
  }

  // deleteEntry itself never reports success/failure (see
  // src/lib/actions/entries.ts — its own error paths are console.error-only,
  // matching how every other delete flow in this codebase already treats it,
  // e.g. EntryTable.tsx/FixedItemsTimeline.tsx) — a card_payment row is
  // always a plain one-off entry (never a template, never an installment),
  // so the extra deleteGeneratedRows/deleteFutureInstallments params default
  // to false without needing to ask the user anything. Removing it here
  // hands the amount back to the card's outstanding debt (creditCardDebtBalance
  // just stops subtracting it), giving a real way to correct a fat-fingered
  // "Borç öde" entry — until this, there was no path back from one at all.
  async function handleDeletePayment() {
    if (!deletePaymentTarget) return;
    setDeletePaymentPending(true);
    mutate(
      ENTRIES_KEY,
      (current: Entry[] | undefined) => current?.filter((e) => e.id !== deletePaymentTarget.id),
      false,
    );
    await deleteEntry(deletePaymentTarget.id);
    setDeletePaymentPending(false);
    mutate(ENTRIES_KEY);
    router.refresh();
    setDeletePaymentTarget(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {notifState !== "unsupported" && notifState !== "granted" && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <p className="font-heading text-base font-semibold text-foreground">
                {t("notificationsTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {notifState === "denied" ? t("notificationsDenied") : t("notificationsDescription")}
              </p>
            </div>
            {notifState !== "denied" && (
              <Button type="button" variant="outline" onClick={handleEnableNotifications}>
                {t("notificationsEnable")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-base font-semibold text-primary">{t("title")}</h2>
        {/* Dolu (primary) buton: bu sayfanın tek "yeni bir şey yarat"
            aksiyonu o, kart satırlarındaki outline aksiyonlarla aynı
            ağırlıkta durunca kayboluyordu. */}
        <Button type="button" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          {t("addLabel")}
        </Button>
      </div>

      {!cards || cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => {
            // entries henüz yüklenmediyse (ilk render, initialCards zaten
            // hazır ama /api/entries'in SWR fetch'i sürüyor) 0 gösterilir —
            // bir an için yanlış "borç yok" izlenimi verse de, fetch biter
            // bitmez gerçek değere geçer; entries olmadan hiç gösterilmemesi
            // (skeleton) bu kısa an için fazla karmaşık olurdu.
            const debt = entries ? creditCardDebtBalance(entries, card.id) : 0;
            return (
              <Card key={card.id}>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <CardIcon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-heading text-base font-semibold text-foreground">
                        {card.name}
                      </p>
                      {/* Gün sayıları vurgulu: bu satırdaki tek değişken bilgi
                          o iki sayı, düz gri bir cümlenin içinde okunmak için
                          tekrar taranması gerekiyordu. */}
                      <p className="text-xs text-muted-foreground">
                        {t.rich("statementDayShort", { day: card.statement_day, hl })} ·{" "}
                        {t.rich("paymentDayShort", { day: card.payment_day, hl })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tCommon("delete")}
                      className="text-foreground/70 hover:text-destructive"
                      onClick={() => handleDelete(card.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {/* Borç artık gri bir şeritte tek satır değil, kendi bölümü:
                      kartın asıl sayısı o — etiket üstte küçük ve büyük
                      harflerle, tutar altında büyük puntoyla. */}
                  <div className="flex flex-wrap items-end justify-between gap-3 border-t border-foreground/10 pt-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
                        {t("currentDebtLabel")}
                      </span>
                      <span
                        className={cn(
                          "font-heading text-2xl font-semibold tabular-nums",
                          debt > 0 ? "text-signal-caution-foreground" : "text-foreground",
                        )}
                      >
                        {formatCurrency(debt, locale)}
                      </span>
                    </div>
                    {/* Checkbox + etiket yerine tek bir durum düğmesi: açıkken
                        yeşil bir onay, kapalıyken soluk bir çan. Aynı tıklama
                        hedefi, ama "şu an açık mı" sorusu tek bakışta
                        cevaplanıyor. role="switch" + aria-checked ile ekran
                        okuyucuda hâlâ bir aç/kapa denetimi. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={card.reminders_enabled}
                      onClick={() => handleToggleReminders(card)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
                        card.reminders_enabled ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {card.reminders_enabled ? (
                        <Check className="size-4" />
                      ) : (
                        <BellOff className="size-4" />
                      )}
                      {card.reminders_enabled ? t("remindersLabel") : t("remindersDisabledLabel")}
                    </button>
                  </div>
                  {/* Ne bu borcun nereden geldiği, ne de nakit akışının bunu
                      ödeme gününde nasıl ele aldığı başka hiçbir yerde
                      açıklanmıyordu — kullanıcı "bu sayı doğru mu, ödersem ne
                      olacak" sorusuna kartın kendisinden başka bir yere
                      bakmadan cevap bulabilsin diye. debt > 0 iken gösterilir,
                      borç yokken bu satırın açıklayacağı bir varsayım da yok. */}
                  {debt > 0 && (
                    <p className="text-xs text-muted-foreground">{t("debtExplanation")}</p>
                  )}
                  {/* Ekstre yükleme diğer ikisinden ayrıldı (dolu buton, sağda):
                      bu kartın asıl işi o, "Borç öde"/"Geçmiş" ise ona bağlı
                      ikincil işler. */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => openPayDebt(card, debt)}>
                        <CircleDollarSign className="size-4" />
                        {t("payDebt.button")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setHistoryCard(card)}>
                        <History className="size-4" />
                        {t("history.button")}
                      </Button>
                    </div>
                    <Button type="button" onClick={() => setUploadCard(card)}>
                      <Upload className="size-4" />
                      {t("uploadStatement")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addDialogTitle")}</DialogTitle>
            <DialogDescription>{t("addDialogDescription")}</DialogDescription>
          </DialogHeader>
          {/* autoComplete="off" her alanda ayrı ayrı — "kart" kelimesi geçen
              bir formun yakınında bir "ad" alanı olması bile tarayıcıların
              (özellikle Chrome) ödeme formu sezgisel algılamasını tetikleyip
              kayıtlı GERÇEK bir kartın bilgisini otomatik doldurmaya
              çalışmasına yol açabiliyor — form seviyesindeki autoComplete tek
              başına bunu her zaman engellemiyor, alan bazında da belirtmek
              gerekiyor. Bu form gerçek bir ödeme aracı değil, sadece bir
              hatırlatma takvimi için bir takma ad saklıyor — kart numarası
              hiçbir zaman istenmiyor/saklanmıyor. */}
          <form action={formAction} className="flex flex-col gap-3" autoComplete="off">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="card-name">{t("nameLabel")}</Label>
              <Input id="card-name" name="name" type="text" maxLength={50} autoComplete="off" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="statement-day">{t("statementDayLabel")}</Label>
                <Input
                  id="statement-day"
                  name="statement_day"
                  type="number"
                  min={1}
                  max={31}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payment-day">{t("paymentDayLabel")}</Label>
                <Input
                  id="payment-day"
                  name="payment_day"
                  type="number"
                  min={1}
                  max={31}
                  autoComplete="off"
                  required
                />
              </div>
            </div>
            {state?.error && <p className="text-sm text-signal-caution-foreground">{state.error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tCommon("saving") : tCommon("add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={payDebtCard !== null} onOpenChange={(open) => !open && setPayDebtCard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("payDebt.dialogTitle", { name: payDebtCard?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("payDebt.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pay-debt-amount">{t("payDebt.amountLabel")}</Label>
                <Input
                  id="pay-debt-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={payDebtAmount}
                  onChange={(e) => setPayDebtAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pay-debt-date">{t("payDebt.dateLabel")}</Label>
                <Input
                  id="pay-debt-date"
                  type="date"
                  value={payDebtDate}
                  onChange={(e) => setPayDebtDate(e.target.value)}
                />
              </div>
            </div>
            {payDebtError && <p className="text-sm text-signal-caution-foreground">{payDebtError}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPayDebtCard(null)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" disabled={payDebtPending} onClick={handlePayDebt}>
              {payDebtPending ? tCommon("saving") : tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyCard !== null} onOpenChange={(open) => !open && setHistoryCard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("history.dialogTitle", { name: historyCard?.name ?? "" })}</DialogTitle>
            <DialogDescription className="sr-only">{t("history.dialogTitle", { name: historyCard?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase">{t("history.statementsTitle")}</h3>
              {(() => {
                const cardHistory = statementImports?.filter((imp) => imp.credit_card_id === historyCard?.id);
                if (!cardHistory || cardHistory.length === 0) {
                  return <p className="text-sm text-muted-foreground">{t("history.empty")}</p>;
                }
                return (
                  <div className="flex flex-col gap-2">
                    {cardHistory.map((imp) => (
                      <div
                        key={imp.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{formatMonthYear(imp.statement_date, locale)}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("history.item", {
                              date: formatDate(imp.created_at, locale),
                              count: imp.imported_count,
                              total: formatCurrency(imp.imported_total, locale),
                            })}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-foreground/70 hover:text-destructive"
                          onClick={() => {
                            setUndoError(undefined);
                            setUndoTarget(imp);
                          }}
                        >
                          {t("history.undoButton")}
                        </Button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            {/* "Borç öde" (ya da ekstre sonrası ödeme adımı) ile kaydedilen
                her ödeme buraya kadar hiçbir yerde listelenmiyordu — yanlış
                bir tutar girildiğinde tek çıkış yolu veritabanına elle
                dokunmaktı. Silme, deleteEntry üzerinden (bkz. yukarıdaki
                handleDeletePayment) tutarı doğrudan kartın borcuna geri
                ekliyor. */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase">{t("history.paymentsTitle")}</h3>
              {(() => {
                const cardPayments = entries
                  ?.filter((e) => e.kind === "card_payment" && e.credit_card_id === historyCard?.id)
                  .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
                if (!cardPayments || cardPayments.length === 0) {
                  return <p className="text-sm text-muted-foreground">{t("history.noPayments")}</p>;
                }
                return (
                  <div className="flex flex-col gap-2">
                    {cardPayments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{formatCurrency(payment.amount, locale)}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(payment.occurred_at, locale)}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-foreground/70 hover:text-destructive"
                          onClick={() => setDeletePaymentTarget(payment)}
                        >
                          <Trash2 className="size-4" />
                          {tCommon("delete")}
                        </Button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletePaymentTarget !== null}
        onOpenChange={(open) => !open && setDeletePaymentTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("history.deletePaymentConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {deletePaymentTarget &&
                t("history.deletePaymentConfirmDescription", {
                  amount: formatCurrency(deletePaymentTarget.amount, locale),
                  date: formatDate(deletePaymentTarget.occurred_at, locale),
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletePaymentTarget(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletePaymentPending}
              onClick={handleDeletePayment}
            >
              {deletePaymentPending ? tCommon("saving") : tCommon("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={undoTarget !== null} onOpenChange={(open) => !open && setUndoTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("history.undoConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {undoTarget &&
                t("history.undoConfirmDescription", {
                  period: formatMonthYear(undoTarget.statement_date, locale),
                  count: undoTarget.imported_count,
                })}
            </DialogDescription>
          </DialogHeader>
          {undoError && <p className="text-sm text-signal-caution-foreground">{undoError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUndoTarget(null)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={undoPending} onClick={handleUndo}>
              {undoPending ? tCommon("saving") : t("history.undoButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {uploadCard && (
        <StatementUploadSheet
          card={uploadCard}
          hasConsent={hasConsent}
          onConsentGranted={() => setHasConsent(true)}
          onClose={() => setUploadCard(null)}
        />
      )}
    </div>
  );
}
