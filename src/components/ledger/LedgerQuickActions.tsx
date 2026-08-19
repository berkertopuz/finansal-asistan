"use client";

import { usePathname } from "next/navigation";
import { VoiceEntryButton } from "@/components/ledger/VoiceEntryButton";
import { StatementUploadButton } from "@/components/statements/StatementUploadButton";

// Defter sayfalarının satır içi hızlı girdi çubuğu — ana sayfadaki
// HeroActions'ın karşılığı. Sesli giriş ve ekstre yükleme uygulamanın iki
// can alıcı girdi yolu, o yüzden ne menü arkasında ne de yüzen bir yığında
// duruyorlar: içerik akışının içinde, sayfa başında.
//
// Ekstre düğmesi gelir sayfalarında gizleniyor (showStatement=false) —
// kredi kartı ekstresi orada anlamsız.
export function LedgerQuickActions() {
  const pathname = usePathname();
  // Kredi kartı ekstresi gelir sayfalarında anlamsız.
  const showStatement = !pathname.startsWith("/defter/gelirler");

  return (
    <div className="flex flex-wrap gap-2 px-4 md:px-0">
      <VoiceEntryButton variant="secondary" showLabel className="min-w-[9rem] flex-1 md:flex-none" />
      {showStatement && (
        <StatementUploadButton variant="secondary" className="min-w-[9rem] flex-1 md:flex-none" />
      )}
    </div>
  );
}
