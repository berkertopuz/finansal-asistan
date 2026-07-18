import { formatCurrencyTRY, formatDateTR } from "@/lib/format";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-background px-6 py-16 text-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">
          Finansal Asistan
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          İskele hazır: {formatDateTR(new Date())} · örnek tutar{" "}
          {formatCurrencyTRY(12450.5)}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Giriş, defter, portföy ve öneri ekranları sonraki bölümlerde
          eklenecek.
        </p>
      </div>
    </div>
  );
}
