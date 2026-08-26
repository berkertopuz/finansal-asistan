"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";

// QuickAddFAB'ın renderTrigger'ı bir FONKSİYON prop'u ve sunucu
// bileşeninden istemci bileşenine fonksiyon geçirilemiyor ("Functions cannot
// be passed directly to Client Components"). O yüzden sarmalayıcı yalnızca
// düğmeyi değil, QuickAddFAB'ın KENDİSİNİ render ediyor: sınırı burada,
// istemci tarafında geçiyoruz ve sayfaya yalnızca string prop kalıyor.
//
// Sheet/açılma durumu yine tek yerde (QuickAddFAB) — burada kopyalanmıyor.
export function AddEntryToGroupButton({ groupId, label }: { groupId: string; label: string }) {
  return (
    <QuickAddFAB
      lockedGroupId={groupId}
      renderTrigger={({ onClick }) => (
        <Button type="button" size="touch" className="gap-2" onClick={onClick}>
          <Plus className="size-4" />
          {label}
        </Button>
      )}
    />
  );
}
