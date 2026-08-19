"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Ekstre sheet'i (PDF ayrıştırma + inceleme listesi) ilk boyamada hiç
// gerekmiyor — QuickEntryForm ile aynı gerekçe.
const StatementUploadSheet = dynamic(
  () => import("@/components/statements/StatementUploadSheet").then((m) => m.StatementUploadSheet),
  { loading: () => null },
);

// Ekstre yüklemeyi açan tetikleyici. Kart VERİLMİYOR: önce PDF yüklenir, kart
// ayrıştırmadan sonra seçilir/oluşturulur. hasConsent de verilmiyor — sheet
// gerekirse rızayı sunucudan gelen 403 üzerine kendisi istiyor.
//
// Bu düğme kasıtlı olarak yüzen bir FAB DEĞİL, satır içi bir aksiyon:
// yüzen sürüm içerik alanlarının üstüne biniyordu.
export function StatementUploadButton({
  className,
  variant = "outline",
  showLabel = true,
}: {
  className?: string;
  variant?: "outline" | "secondary" | "default";
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("ledger");

  return (
    <>
      <Button
        type="button"
        size={showLabel ? "touch" : "icon-touch"}
        variant={variant}
        onClick={() => setOpen(true)}
        aria-label={t("statementUpload")}
        className={cn("rounded-full", className)}
      >
        <Upload className="size-4" />
        {showLabel ? t("statementUpload") : null}
      </Button>
      {open && (
        <StatementUploadSheet onConsentGranted={() => {}} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
