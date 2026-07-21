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

// Not in the initial bundle — nobody sees this until they tap the FAB.
const AddPositionForm = dynamic(
  () => import("@/components/portfolio/AddPositionForm").then((m) => m.AddPositionForm),
  { loading: () => <div className="h-72" /> },
);

export function AddPositionSheet() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("portfolio");

  return (
    <>
      <Button
        type="button"
        size="icon-touch"
        onClick={() => setOpen(true)}
        aria-label={t("addPosition")}
        className="fixed right-4 bottom-24 z-20 size-14 rounded-full shadow-lg md:right-8 md:bottom-8"
      >
        <Plus className="size-6" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t("addPositionSheetTitle")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("addPositionSheetDescription")}
            </SheetDescription>
          </SheetHeader>
          <AddPositionForm onSaved={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
