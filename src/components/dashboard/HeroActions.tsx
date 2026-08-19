"use client";

import Link from "next/link";
import { Plus, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { VoiceEntryButton } from "@/components/ledger/VoiceEntryButton";
import { StatementUploadButton } from "@/components/statements/StatementUploadButton";
import { cn } from "@/lib/utils";

// Home's own primary "add" entry point — renders as a pill via
// QuickAddFAB's renderTrigger instead of the fixed round FAB used
// elsewhere, so Home doesn't end up with the same action shown twice.
//
// Sesli giriş ve ekstre yükleme de burada, SATIR İÇİ. Önceki sürümde ikisi
// de yüzen FAB yığınındaydı ve içerik alanlarının üstüne biniyordu —
// uygulamanın iki hızlı girdi yolu olduğu için menü arkasına da
// saklanamazlar, o yüzden hero'nun kendi aksiyon satırına alındılar.
// flex-wrap: 375px'te dört düğme tek satıra sığmıyor, ikişerli sarıyor.
export function HeroActions() {
  const t = useTranslations("ledger");
  const tHome = useTranslations("home");

  return (
    <div className="flex flex-wrap gap-2">
      <QuickAddFAB
        renderTrigger={({ onClick }) => (
          <Button
            type="button"
            size="touch"
            onClick={onClick}
            className="min-w-[8rem] flex-1 rounded-full"
          >
            <Plus className="size-4" />
            {t("addEntry")}
          </Button>
        )}
      />
      <VoiceEntryButton variant="secondary" showLabel className="min-w-[8rem] flex-1" />
      {/* A plain Link styled with buttonVariants, not <Button render={<Link/>}> —
          Base UI's Button enforces button semantics (role="button", keyboard
          handling) and its own docs say links shouldn't be passed through
          `render` for that reason; style the anchor directly instead. */}
      <Link
        href="/defter"
        className={cn(
          buttonVariants({ variant: "secondary", size: "touch" }),
          "min-w-[8rem] flex-1 rounded-full",
        )}
      >
        {tHome("viewLedger")}
        <ArrowRight className="size-4" />
      </Link>
      <StatementUploadButton variant="secondary" className="min-w-[8rem] flex-1" />
    </div>
  );
}
