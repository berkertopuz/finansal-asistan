"use client";

import Link from "next/link";
import { Plus, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { cn } from "@/lib/utils";

// Home's own primary "add" entry point — renders as a pill via
// QuickAddFAB's renderTrigger instead of the fixed round FAB used
// elsewhere, so Home doesn't end up with the same action shown twice.
export function HeroActions() {
  const t = useTranslations("ledger");
  const tHome = useTranslations("home");

  return (
    <div className="flex gap-3">
      <QuickAddFAB
        renderTrigger={({ onClick }) => (
          <Button type="button" size="touch" onClick={onClick} className="flex-1 rounded-full">
            <Plus className="size-4" />
            {t("addEntry")}
          </Button>
        )}
      />
      {/* A plain Link styled with buttonVariants, not <Button render={<Link/>}> —
          Base UI's Button enforces button semantics (role="button", keyboard
          handling) and its own docs say links shouldn't be passed through
          `render` for that reason; style the anchor directly instead. */}
      <Link
        href="/defter"
        className={cn(buttonVariants({ variant: "secondary", size: "touch" }), "flex-1 rounded-full")}
      >
        {tHome("viewLedger")}
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
