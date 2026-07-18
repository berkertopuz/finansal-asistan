"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Not in the initial bundle — nobody sees this until they tap the FAB.
const QuickEntryForm = dynamic(
  () => import("@/components/ledger/QuickEntryForm").then((m) => m.QuickEntryForm),
  { loading: () => <div className="h-64" /> },
);

export function QuickAddFAB() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="icon-touch"
        onClick={() => setOpen(true)}
        aria-label="Yeni kayıt ekle"
        className="fixed right-4 bottom-24 z-20 size-14 rounded-full shadow-lg md:right-8 md:bottom-8"
      >
        <Plus className="size-6" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="sm:inset-x-auto sm:mx-auto sm:max-w-md sm:rounded-t-2xl"
        >
          <SheetHeader>
            <SheetTitle>Yeni kayıt</SheetTitle>
            <SheetDescription className="sr-only">
              Gelir, gider ya da abonelik ekle.
            </SheetDescription>
          </SheetHeader>
          <QuickEntryForm onSaved={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
