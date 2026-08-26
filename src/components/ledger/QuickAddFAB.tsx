"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { EntryKind } from "@/lib/ledger";

// Not in the initial bundle — nobody sees this until they tap the FAB.
const QuickEntryForm = dynamic(
  () => import("@/components/ledger/QuickEntryForm").then((m) => m.QuickEntryForm),
  { loading: () => <div className="h-64" /> },
);

// Tek düğme, yığın değil. Sesli giriş ve ekstre yükleme bir ara buraya
// (yüzen bir yığın olarak) eklenmişti; üç yüzen düğme içerik alanlarının
// üstüne biniyordu. İkisi de artık satır içi: LedgerQuickActions
// (defter sayfaları) ve HeroActions (ana sayfa).
export function QuickAddFAB({
  defaultKind,
  lockedGroupId,
  renderTrigger,
}: {
  defaultKind?: EntryKind;
  // Grup ekranından açıldığında o grup SEÇİLİ ve DEĞİŞTİRİLEMEZ gelir:
  // kullanıcı zaten "bu gruba gider ekle" diyerek buraya geldi, seçiciyi
  // tekrar sunmak hem gereksiz bir adım hem de yanlış gruba yazma riski.
  lockedGroupId?: string;
  // Lets a caller (e.g. the Home hero's pill button) open this exact same
  // Sheet with its own trigger markup instead of the fixed round FAB below —
  // keeps the Sheet/open-state wiring in one place instead of duplicating
  // it. Omitted entirely, behavior is identical to before.
  renderTrigger?: (props: { onClick: () => void }) => React.ReactNode;
} = {}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("ledger");

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onClick: () => setOpen(true) })
      ) : (
        <Button
          type="button"
          size="icon-touch"
          onClick={() => setOpen(true)}
          aria-label={t("addEntry")}
          className="fixed right-4 bottom-24 z-20 size-14 rounded-2xl shadow-lg md:right-8 md:bottom-8"
        >
          <Plus className="size-6" />
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t("form.addSheetTitle")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("form.addSheetDescription")}
            </SheetDescription>
          </SheetHeader>
          <QuickEntryForm
            onSaved={() => setOpen(false)}
            defaultKind={defaultKind}
            lockedGroupId={lockedGroupId}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
