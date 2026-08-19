"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { toIntlTag, type AppLocale } from "@/lib/locale";
import { SUPPORTED_CURRENCIES } from "@/lib/providers/tcmb-fx";

// Para birimi adları Intl.DisplayNames'ten geliyor — 21 para birimi için elle
// bir ad tablosu tutmak, üstelik iki dilde, sürekli bakım isteyen ölü bir
// yük olurdu. Tarayıcı zaten biliyor: "EUR" -> "Euro", "USD" -> "ABD Doları".
function currencyNames(locale: AppLocale): Map<string, string> {
  const names = new Map<string, string>();
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([toIntlTag(locale)], { type: "currency" });
  } catch {
    display = null;
  }
  for (const code of ["TRY", ...SUPPORTED_CURRENCIES]) {
    names.set(code, display?.of(code) ?? code);
  }
  return names;
}

// Tutar alanının İÇİNDE, sağ tarafta duran para birimi seçici. Ayrı bir satır
// ya da etiket yanında bir <select> olarak denendi ve kullanıcı haklı olarak
// beğenmedi: sıradan bir TL kaydında bile yer kaplıyor ve forma ikinci bir
// kontrol satırı ekliyordu. Şimdi tek bir alan gibi görünüyor — varsayılan
// "₺" olduğu için TL girişinde hiç fark edilmiyor.
//
// Aranabilir: 21 para birimi bir <select>'te kaydırmayla bulunacak kadar az
// değil, ve kullanıcı "euro" ya da "dolar" yazmayı bilir ama "EUR"/"USD"
// kodunu listede aramak zorunda kalmamalı.
export function CurrencyPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("ledger.form");
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const names = useMemo(() => currencyNames(locale), [locale]);
  const codes = useMemo(() => ["TRY", ...SUPPORTED_CURRENCIES], []);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(toIntlTag(locale));
    if (!q) return codes;
    return codes.filter(
      (code) =>
        code.toLowerCase().includes(q) ||
        (names.get(code) ?? "").toLocaleLowerCase(toIntlTag(locale)).includes(q),
    );
  }, [query, codes, names, locale]);

  // Dışarı tıklama ve Escape ile kapanma — açık bir katmanın kapanmasının iki
  // standart yolu; ikisi de yoksa kullanıcı listeye sıkışıyor.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="absolute inset-y-1 right-1 flex items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((prev) => !prev);
          setQuery("");
          // Açılır açılmaz aramaya odaklan: klavyesi açık olan mobil
          // kullanıcı için de, masaüstünde de en hızlı yol yazmak.
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("currencyLabel")}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-muted flex h-full items-center gap-1 rounded-md px-2 text-sm font-medium transition-colors",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        {value === "TRY" ? "₺" : value}
        <ChevronDown className="size-3.5" />
      </button>

      {open && (
        <div
          role="listbox"
          className="bg-popover border-border absolute top-full right-0 z-50 mt-1 w-60 rounded-lg border shadow-lg"
        >
          <div className="border-border flex items-center gap-2 border-b px-2">
            <Search className="text-muted-foreground size-3.5 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("currencySearch")}
              className="min-h-touch w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-muted-foreground px-3 py-2 text-xs">{t("currencyNoMatch")}</p>
            ) : (
              filtered.map((code) => (
                <button
                  key={code}
                  type="button"
                  role="option"
                  aria-selected={code === value}
                  onClick={() => {
                    onChange(code);
                    setOpen(false);
                  }}
                  className={cn(
                    "hover:bg-muted flex min-h-touch w-full items-center gap-2 px-3 text-left text-sm",
                    code === value && "bg-muted/60",
                  )}
                >
                  <span className="w-10 shrink-0 font-medium">{code === "TRY" ? "₺" : code}</span>
                  <span className="text-muted-foreground truncate text-xs">{names.get(code)}</span>
                  {code === value && <Check className="ml-auto size-3.5 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
