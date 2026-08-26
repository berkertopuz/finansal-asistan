"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { assignEntriesToGroup } from "@/lib/actions/entries";
import { categoryLabel, type Entry } from "@/lib/ledger";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";

const ENTRIES_KEY = "/api/entries";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch entries");
    return res.json();
  });

// En fazla bu kadar aday gösteriliyor. Defter yıllara yayılabiliyor ve
// "gruba eklenecek harcama" pratikte hep yakın geçmişte — sınırsız bir liste
// hem taranamaz hem de mobilde ağır olurdu. Arama kutusu daha eskisine
// ulaşmak için var.
const MAX_CANDIDATES = 60;

// Gruba toplu harcama ekleme. Neden defterin kendi tablosunda çoklu seçim
// DEĞİL: bir kayıt yalnızca SAHİBİ tarafından gruba yazılabiliyor (RLS), yani
// aday listesi zaten "senin gruplanmamış harcamaların" — bu ekranda o kapsam
// doğal, defterde ise ayrıca filtrelenmesi gereken bir şey olurdu. Ayrıca
// defterin ana akışına kalıcı bir "seçim modu" borcu binmiyor.
export function AddEntriesToGroup({ groupId }: { groupId: string }) {
  const t = useTranslations("groups.addEntries");
  const tCommon = useTranslations("common");
  const tLedger = useTranslations("ledger");
  const locale = useLocale() as AppLocale;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const { data: entries } = useSWR<Entry[]>(open ? ENTRIES_KEY : null, fetcher);

  // Aday: kendi defterindeki, HENÜZ BİR GRUBA AİT OLMAYAN gerçek harcamalar.
  // Tekrarlayan ŞABLONLAR dışarıda (recurrence !== "none"): şablonun kendisi
  // bir işlem değil, kural — onu gruba yazmak istiyorsan kaydı düzenleyip
  // yapıyorsun, çünkü o seçim üretilmiş bütün aylara cascade ediyor
  // (src/lib/actions/entries.ts). Buradan toplu atama yalnızca somut
  // satırlara.
  const candidates = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLocaleLowerCase("tr");
    return entries
      .filter(
        (e) =>
          e.group_id === null &&
          e.recurrence === "none" &&
          (e.kind === "expense" || e.kind === "subscription"),
      )
      .filter((e) => {
        if (!q) return true;
        const haystack = `${e.description ?? ""} ${e.category ?? ""}`.toLocaleLowerCase("tr");
        return haystack.includes(q);
      })
      .slice(0, MAX_CANDIDATES);
  }, [entries, query]);

  const selectedTotal = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => selected.has(e.id))
        .reduce((sum, e) => sum + e.amount, 0),
    [entries, selected],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (selected.size === 0) return;
    setPending(true);
    setError(undefined);
    const result = await assignEntriesToGroup(groupId, [...selected]);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSelected(new Set());
    setQuery("");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        size="touch"
        className="gap-2"
        onClick={() => {
          setSelected(new Set());
          setError(undefined);
          setOpen(true);
        }}
      >
        <Plus className="size-4" />
        {t("trigger")}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-3 px-4 pb-4">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
            />

            {!entries ? (
              <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <Table>
                <TableBody>
                  {candidates.map((entry) => (
                    <TableRow
                      key={entry.id}
                      onClick={() => toggle(entry.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="w-9 min-w-9 pr-0 align-middle">
                        {/* Checkbox bir FLEX KAPSAYICI içinde olmak zorunda.
                            Base UI onu display:inline olarak render ediyor ve
                            inline elemanda genişlik geçmiyor — doğrudan
                            hücreye konunca size-5'in yüksekliği uyguluyor
                            ama genişliği 2px'e düşüyordu. Uygulamanın diğer
                            kullanımlarında bu görünmüyor çünkü hepsi
                            `<label className="flex …">` içinde; flex öğesi
                            olmak elemanı blok hâline getiriyor. */}
                        <div className="flex items-center">
                          <Checkbox
                            checked={selected.has(entry.id)}
                            onCheckedChange={() => toggle(entry.id)}
                            aria-label={entry.description ?? undefined}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="w-full max-w-0 align-middle">
                        <p className="truncate text-sm">
                          {entry.description || categoryLabel((k) => tLedger(k), entry.category)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {categoryLabel((k) => tLedger(k), entry.category)} ·{" "}
                          {formatShortDate(entry.occurred_at, locale)}
                        </p>
                      </TableCell>
                      <TableCell className="text-right align-middle text-sm font-medium tabular-nums">
                        {formatCurrency(entry.amount, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {error ? <p className="text-sm text-signal-caution-foreground">{error}</p> : null}

            {/* Seçim özeti kaydetme düğmesinin ÜSTÜNDE: kaç kalem ve ne kadar
                tutar eklendiğini onaydan önce görmek, yanlış seçimi geri
                almaktan ucuz. */}
            <div className="sticky bottom-0 flex flex-col gap-2 bg-background pt-2">
              <p className="text-xs text-muted-foreground">
                {t("selectedSummary", {
                  count: selected.size,
                  amount: formatCurrency(selectedTotal, locale),
                })}
              </p>
              <Button
                size="touch"
                className="w-full justify-center"
                disabled={pending || selected.size === 0}
                onClick={handleSave}
              >
                {pending ? tCommon("saving") : t("submit")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
