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

export function QuickAddFAB({
  defaultKind,
  renderTrigger,
}: {
  defaultKind?: EntryKind;
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
          <QuickEntryForm onSaved={() => setOpen(false)} defaultKind={defaultKind} />
        </SheetContent>
      </Sheet>
    </>
  );
}
