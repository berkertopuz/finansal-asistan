import { LedgerSubNav } from "@/components/ledger/LedgerSubNav";

export default function DefterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-4 py-6 md:px-6">
      <LedgerSubNav />
      {children}
    </div>
  );
}
