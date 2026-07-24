"use client";

import { useActionState, useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CreditCard as CardIcon, Plus, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  addCreditCard,
  deleteCreditCard,
  payCreditCardDebt,
  updateCreditCard,
  type CreditCardState,
} from "@/lib/actions/credit-cards";
import { subscribeToPush } from "@/lib/actions/push";
import type { CreditCard } from "@/lib/credit-cards-data";
import { creditCardDebtBalance } from "@/lib/cashflow";
import { formatCurrency } from "@/lib/format";
import { toDateString, type Entry } from "@/lib/ledger";
import type { AppLocale } from "@/lib/locale";
import { StatementUploadSheet } from "@/components/statements/StatementUploadSheet";

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
  const [hasConsent, setHasConsent] = useState(initialHasConsent);
  const [addOpen, setAddOpen] = useState(false);
  const [uploadCard, setUploadCard] = useState<CreditCard | null>(null);
  const [payDebtCard, setPayDebtCard] = useState<CreditCard | null>(null);
  const [payDebtAmount, setPayDebtAmount] = useState("");
  const [payDebtDate, setPayDebtDate] = useState(() => toDateString(new Date()));
  const [payDebtError, setPayDebtError] = useState<string | undefined>();
  const [payDebtPending, setPayDebtPending] = useState(false);
  const [notifState, setNotifState] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("creditCards");
  const tCommon = useTranslations("common");

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
    setNotifState(permission);
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

  return (
    <div className="flex flex-col gap-4">
      {notifState !== "unsupported" && notifState !== "granted" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">
              {t("notificationsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-sm text-foreground">
              {notifState === "denied" ? t("notificationsDenied") : t("notificationsDescription")}
            </p>
            {notifState !== "denied" && (
              <Button type="button" variant="outline" size="sm" onClick={handleEnableNotifications}>
                {t("notificationsEnable")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("title")}</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
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
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <CardIcon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{card.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("statementDayShort", { day: card.statement_day })} ·{" "}
                        {t("paymentDayShort", { day: card.payment_day })}
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
                  <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                    <span className="text-xs text-muted-foreground">{t("currentDebtLabel")}</span>
                    <span
                      className={
                        debt > 0 ? "text-sm font-semibold text-signal-caution-foreground" : "text-sm font-semibold text-foreground"
                      }
                    >
                      {formatCurrency(debt, locale)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={card.reminders_enabled}
                        onCheckedChange={() => handleToggleReminders(card)}
                      />
                      {t("remindersLabel")}
                    </label>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => openPayDebt(card, debt)}>
                        {t("payDebt.button")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setUploadCard(card)}>
                        <Upload className="size-4" />
                        {t("uploadStatement")}
                      </Button>
                    </div>
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
