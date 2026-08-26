"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, Unlink2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { CrossPayerDuplicate } from "@/lib/group-summary";
import { detachEntryFromGroup } from "@/lib/actions/entries";
import { confirmNotDuplicate, detachEntryAsAdmin } from "@/lib/actions/groups";

// Mükerrer çiftleri ÖZET SAYFASINDA DEĞİL, kendi yüzeyinde çözülüyor.
//
// Önce her çift uyarı bloğunun içinde bir paragraf + bir düğme olarak
// diziliyordu ve 10 çiftte blok sayfanın tamamını kaplıyordu — özet ekranı
// özet olmaktan çıkıyordu (kullanıcı bildirdi). Uyarının işi HABER VERMEK,
// çözmek değil: sayfada tek satır kalıyor ("N olası mükerrer"), asıl iş
// burada yapılıyor.
//
// Sheet seçilmesinin sebebi sadece yer değil: bir çifti karara bağlamak iki
// kaydı YAN YANA görmeyi gerektiriyor (kim, ne zaman, ne kadar) ve dar bir
// uyarı kutusu bunu 10 kalemde okunaksız hale getiriyordu.
export function DuplicateReviewSheet({
  groupId,
  duplicates,
  isAdmin,
  currentUserId,
}: {
  groupId: string;
  duplicates: CrossPayerDuplicate[];
  isAdmin: boolean;
  currentUserId: string;
}) {
  const t = useTranslations("groups.summary");
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function run(key: string, fn: () => Promise<{ error?: string }>) {
    setPending(key);
    setError(undefined);
    const result = await fn();
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (duplicates.length === 0) return null;

  return (
    <>
      {/* Sayfadaki tüm yer bu: tek satır. Sayı ve tek bir eylem. */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-signal-caution-foreground/30 bg-signal-caution-bg/40 px-3 py-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-signal-caution-foreground">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t("crossPayerCount", { count: duplicates.length })}</span>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-xs"
          onClick={() => {
            setError(undefined);
            setOpen(true);
          }}
        >
          {t("crossPayerReview")}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("crossPayerTitle")}</SheetTitle>
            <SheetDescription>{t("crossPayerSheetIntro")}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-3 px-4 pb-4">
            {duplicates.map((dup) => {
              const sides = [dup.first, dup.second];
              return (
                <div
                  key={dup.first.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                  <p className="text-sm font-medium tabular-nums">
                    {formatCurrency(dup.amount, locale)}
                  </p>

                  {/* İki kayıt YAN YANA: karar bunu görmeden verilemiyor.
                      Her birinin yanında kendi "gruptan çıkar" düğmesi —
                      hangisinin kalacağını kullanıcı seçiyor, uygulama
                      birini kendiliğinden seçmiyor. */}
                  {sides.map((side) => {
                    const mine = side.userId === currentUserId;
                    return (
                      <div key={side.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {side.payerName ?? t("unnamed")} ·{" "}
                          {formatShortDate(side.occurredAt, locale)}
                        </span>
                        {mine || isAdmin ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 gap-1.5 text-xs"
                            disabled={pending === side.id}
                            onClick={() =>
                              run(side.id, () =>
                                mine
                                  ? detachEntryFromGroup(side.id)
                                  : detachEntryAsAdmin(side.id),
                              )
                            }
                          >
                            <Unlink2 className="size-3.5" />
                            {t("detach")}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}

                  {/* "Farklı harcamalar" — uyarı sezgisel ve yanılabilir.
                      Onaylanan çift bir daha sorulmuyor. */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-center gap-1.5 text-xs"
                    disabled={pending === dup.first.id}
                    onClick={() =>
                      run(dup.first.id, () =>
                        confirmNotDuplicate(groupId, dup.first.id, dup.second.id),
                      )
                    }
                  >
                    <Check className="size-3.5" />
                    {t("crossPayerConfirm")}
                  </Button>
                </div>
              );
            })}

            {error ? <p className="text-sm text-signal-caution-foreground">{error}</p> : null}

            <Button
              variant="ghost"
              size="touch"
              className="w-full justify-center"
              onClick={() => setOpen(false)}
            >
              {tCommon("close")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
