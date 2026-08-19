"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const PANEL_WIDTH = 240;
const VIEWPORT_MARGIN = 8;
const GAP = 4;

type PanelPosition = { top: number; left: number; width: number; maxHeight: number };

// Panelin viewport içinde kalacak konumu. Aşağıda yer yoksa yukarı açılıyor,
// yatayda ekran kenarlarına sıkıştırılıyor.
function computePosition(anchor: DOMRect): PanelPosition {
  const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const spaceBelow = window.innerHeight - anchor.bottom - GAP - VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - GAP - VIEWPORT_MARGIN;
  const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(160, Math.min(320, openUp ? spaceAbove : spaceBelow));

  // Sağ kenarı düğmeyle hizala, sonra ekrana sıkıştır.
  const left = Math.min(
    Math.max(anchor.right - width, VIEWPORT_MARGIN),
    window.innerWidth - width - VIEWPORT_MARGIN,
  );
  const top = openUp ? anchor.top - GAP - maxHeight : anchor.bottom + GAP;
  return { top, left, width, maxHeight };
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
//
// Panel PORTAL ile <body>'ye çiziliyor ve position:fixed. İlk sürüm normal bir
// absolute katmandı ve ekrana sığmıyordu: form bir Sheet içinde açılıyor,
// Sheet'in overflow:auto'su paneli hem yanlardan hem alttan kırpıyordu
// (ölçüldü: panelin sol kenarı Sheet'in 31px dışında kalıyordu). Portal, o
// kırpma bağlamının tamamen dışına çıkarıyor; konum da her açılışta
// viewport'a göre hesaplanıp sıkıştırılıyor.
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
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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

  // Konum boyama ÖNCESİ hesaplanıyor — useEffect ile yapılsaydı panel bir kare
  // boyunca yanlış yerde görünüp zıplardı.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (anchor) setPosition(computePosition(anchor));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Sheet içeriği kaydırıldığında panel düğmeden kopmasın diye kapatıyoruz —
    // sabit konumlu bir paneli kaydırma boyunca takip ettirmek, kapatmaktan
    // hem daha pahalı hem de kullanıcı için daha şaşırtıcı olurdu.
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  const panel =
    open && position && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            className="bg-popover border-border fixed z-[60] flex flex-col overflow-hidden rounded-lg border shadow-lg"
          >
            <div className="border-border flex shrink-0 items-center gap-2 border-b px-2">
              <Search className="text-muted-foreground size-3.5 shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("currencySearch")}
                className="min-h-touch w-full bg-transparent text-sm outline-none"
              />
            </div>
            <div className="overflow-y-auto py-1">
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
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen((prev) => !prev);
          // Açılır açılmaz aramaya odaklan: klavyesi açık olan mobil
          // kullanıcı için de, masaüstünde de en hızlı yol yazmak.
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("currencyLabel")}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-muted absolute inset-y-1 right-1 flex items-center gap-1 rounded-md px-2 text-sm font-medium transition-colors",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        {value === "TRY" ? "₺" : value}
        <ChevronDown className="size-3.5" />
      </button>
      {panel}
    </>
  );
}
