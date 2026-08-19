import { LedgerSubNav } from "@/components/ledger/LedgerSubNav";
import { LedgerQuickActions } from "@/components/ledger/LedgerQuickActions";

export default function DefterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-4 py-6 md:px-6">
      <LedgerSubNav />
      {/* Sesli giriş + ekstre yükleme, defterin her sayfasında satır içi —
          yüzen bir yığın olarak içeriğin üstüne binmesin diye. */}
      <LedgerQuickActions />
      {children}
    </div>
  );
}
