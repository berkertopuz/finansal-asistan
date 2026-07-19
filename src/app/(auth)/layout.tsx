import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <LocaleSwitcher />
        </div>
        {children}
      </div>
    </main>
  );
}
