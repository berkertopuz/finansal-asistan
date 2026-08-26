"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Filter, Unlink2 } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercentAbs } from "@/lib/format";
import { toIntlTag, type AppLocale } from "@/lib/locale";
import { categoryLabel } from "@/lib/ledger";
import { NEUTRAL_BAR_CLASS, categoryColor } from "@/lib/analysis-colors";
import { formatShortDate } from "@/lib/format";
import type { GroupEntry } from "@/lib/groups-data";
import { findCrossPayerDuplicates, type GroupSummaryData } from "@/lib/group-summary";
import { detachEntryFromGroup } from "@/lib/actions/entries";
import { detachEntryAsAdmin } from "@/lib/actions/groups";
import { DuplicateReviewSheet } from "@/components/groups/DuplicateReviewSheet";

// Ödeyeni bir bakışta ayırt etmek için baş harf rozeti — isim de yazılı
// olduğu için renk/harf TEK BAŞINA kimlik taşımıyor, sadece taramayı
// hızlandırıyor.
function initials(name: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toLocaleUpperCase("tr");
}

// Bu ekran "ay sonu ortak giderler ne tuttu" sorusunun cevabı. KASITLI olarak
// bir uzlaşma/borç ekranı DEĞİL: hiçbir yerde "sen ona şu kadar borçlusun"
// yazmıyor, sadece kimin ne koyduğunu yan yana koyuyor. Bölüşme oranı yok
// (CLAUDE.md: 50/50 önerildi, reddedildi) — adaletin ne olduğu çiftin kendi
// konuşması, uygulamanın hesabı değil.
//
// Grafik kütüphanesi yok: tek seri, yatay bar, doğrudan etiket — Analiz'deki
// CategoryBreakdown ile aynı gerekçe (dataviz form kuralı).
export function GroupSummary({
  summary,
  entries,
  showPayerBreakdown,
  reviewedDuplicates,
  isAdmin,
  groupId,
  period,
  prevMonthKey,
  nextMonthKey,
  currentUserId,
}: {
  summary: GroupSummaryData;
  // Kalem kalem liste: toplam ve kırılım "ne kadar" sorusunu cevaplıyor ama
  // "hangi harcama" sorusunu cevaplamıyordu. Çiftin ay sonu konuşması tek
  // tek kalemler üzerinden yürüyor ("bu 1.200 neydi?"), o yüzden liste
  // özetin bir tamamlayıcısı değil, asıl içeriği.
  entries: GroupEntry[];
  // Hane ayarı (yalnızca kurucu değiştirir). Kapalıyken hem "kim ne ödedi"
  // bölümü hem de kalem listesindeki ödeyen adı/rozeti gizleniyor — ikisi de
  // aynı bilgi, birini gizleyip diğerini bırakmak ayarı anlamsız yapardı.
  showPayerBreakdown: boolean;
  // Onaylanmış ("bunlar farklı") mükerrer çiftleri — bir daha uyarı üretmez.
  reviewedDuplicates: { first_entry_id: string; second_entry_id: string }[];
  // Yönetici, BAŞKASININ kaydını gruptan çıkarabilir (silemez). Asıl kapı
  // detach_entry_as_admin RPC'si; buradaki koşul yalnızca düğmeyi gizliyor.
  isAdmin: boolean;
  groupId: string;
  // "all" ya da "YYYY-MM". Hane aylık ritimde, tatil toplamda okunuyor —
  // tek ekran ikisini de karşılasın diye dönem seçicisi var.
  period: string;
  prevMonthKey: string;
  // Gelecek ay yoksa (bulunduğumuz aydayız) null — ileri gitmek anlamsız.
  nextMonthKey: string | null;
  currentUserId: string;
}) {
  const t = useTranslations("groups.summary");
  const tLedger = useTranslations("ledger");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [detaching, setDetaching] = useState<string | null>(null);
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const isAll = period === "all";
  const monthLabel = isAll
    ? t("allTime")
    : (() => {
        const [year, month] = period.split("-").map(Number);
        return new Intl.DateTimeFormat(toIntlTag(locale), {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(year, month - 1, 1)));
      })();

  const maxCategory = summary.byCategory[0]?.amount ?? 0;
  const crossPayerDuplicates = findCrossPayerDuplicates(entries, reviewedDuplicates);
  // Filtre: "yalnızca olası mükerrerler". Uyarı bloğu çifti söylüyor ama
  // kullanıcı onları LİSTEDE, tutar ve tarihleriyle görmek istiyor —
  // özellikle hangisini çıkaracağına karar verirken.
  const duplicateIds = new Set(
    crossPayerDuplicates.flatMap((d) => [d.first.id, d.second.id]),
  );
  const visibleEntries = onlyDuplicates ? entries.filter((e) => duplicateIds.has(e.id)) : entries;

  return (
    <Card>
      {/* Ay gezinmesi CardAction içinde: CardHeader kendi grid'ini
          has-data-[slot=card-action] ile 1fr_auto'ya çeviriyor. Elle
          flex-row/justify-between vermek o grid'i yenemiyordu ve okları
          başlığın altına düşürüyordu. */}
      <CardHeader>
        <CardTitle className="text-base">{monthLabel}</CardTitle>
        <CardAction>
        {/* buttonVariants ile stillenmiş düz Link — <Button render={<Link/>}>
            DEĞİL. Base UI'ın Button'ı buton semantiği dayatıyor (role="button",
            kendi klavye davranışı) ve kendi dokümanı linkleri `render`'dan
            geçirmemeyi söylüyor; HeroActions.tsx'te aynı gerekçe yazılı. */}
        <div className="flex items-center gap-1">
          {/* "Tümü" bir mod: açıkken ay okları anlamsız olduğu için
              gizleniyor. Hane kullanıcısı aylarda gezinir, tatil kullanıcısı
              tek sayıya bakar — aynı ekran ikisini de karşılıyor. */}
          {!isAll && (
            <>
              <Link
                href={`/gruplar/${groupId}?donem=${prevMonthKey}`}
                aria-label={t("previousMonth")}
                className={cn(buttonVariants({ variant: "ghost", size: "icon-touch" }))}
              >
                <ChevronLeft className="size-4" />
              </Link>
              {nextMonthKey ? (
                <Link
                  href={`/gruplar/${groupId}?donem=${nextMonthKey}`}
                  aria-label={t("nextMonth")}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon-touch" }))}
                >
                  <ChevronRight className="size-4" />
                </Link>
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-touch" }),
                    "pointer-events-none opacity-40",
                  )}
                >
                  <ChevronRight className="size-4" />
                </span>
              )}
            </>
          )}
          <Link
            href={`/gruplar/${groupId}?donem=${isAll ? prevMonthKey : "all"}`}
            aria-pressed={isAll}
            className={cn(
              // inline-flex + items-center: min-h-touch kutuyu 48px'e
              // yükseltiyor ama padding tek başına metni dikeyde
              // ortalamıyordu — yazı yukarıda kalıyordu.
              "inline-flex min-h-touch items-center justify-center rounded-full border px-3 py-1.5 text-xs",
              isAll
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground",
            )}
          >
            {/* Çip bir GEÇİŞ: "Tümü" modundayken kart başlığı zaten "Tümü"
                diyor, çipin de aynı şeyi tekrar etmesi anlamsızdı — o modda
                çip geri dönüş yolunu gösteriyor. */}
            {isAll ? t("backToMonth") : t("allTime")}
          </Link>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {summary.entryCount === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{t("totalLabel")}</p>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {formatCurrency(summary.total, locale)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("entryCount", { count: summary.entryCount })}
              </p>
            </div>

            {/* KİŞİLER ARASI MÜKERRER. Sayfada yalnızca TEK SATIR yer
                kaplıyor; çiftler kendi yüzeyinde (DuplicateReviewSheet)
                çözülüyor. Önce her çift burada paragraf + düğme olarak
                diziliyordu ve 10 çiftte özet ekranı özet olmaktan çıkıyordu.
                Uyarının işi haber vermek, çözmek değil. */}
            <DuplicateReviewSheet
              groupId={groupId}
              duplicates={crossPayerDuplicates}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
            />

            {showPayerBreakdown && (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                {/* Tek sayı: fiilen ödenen. Bir ara sürümde yanında "pay
                    etiketlerinden sonra kime yazıldığı" da vardı ve çelişki
                    gibi okunuyordu ("Neda ₺400,00 · ödedi ₺0,00"); etiketin
                    kendisi kaldırıldı. Model artık tek cümle: kim ödediyse
                    gider ona yazılır, hane toplamına eklenir. */}
                <p className="text-xs text-muted-foreground">{t("byPayer")}</p>
                {summary.byPayer.map((payer) => (
                  <div key={payer.userId} className="flex items-baseline justify-between gap-3">
                    {/* "· Sen" yazısı yok: kendi adın renkle ayrılıyor —
                        üye listesiyle aynı davranış, tekrar eden bir kelime
                        yerine sessiz bir vurgu. */}
                    <span
                      className={cn(
                        "text-sm",
                        payer.userId === currentUserId && "font-medium text-primary",
                      )}
                    >
                      {payer.name ?? t("unnamed")}
                    </span>
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrency(payer.paid, locale)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">{t("byCategory")}</p>
              {summary.byCategory.map((slice) => {
                const color = categoryColor(slice.category);
                return (
                  <div key={slice.category ?? "__none__"} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm">
                        {categoryLabel((k) => tLedger(k), slice.category)}
                      </span>
                      <span className="text-sm tabular-nums">
                        {formatCurrency(slice.amount, locale)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatPercentAbs(
                            summary.total > 0 ? slice.amount / summary.total : 0,
                            locale,
                          )}
                        </span>
                      </span>
                    </div>
                    {/* Renk hiçbir zaman TEK BAŞINA kimlik taşımıyor: kategori
                        adı, tutar ve pay zaten satırda yazılı (Analiz'deki
                        CategoryBreakdown ile aynı erişilebilirlik gerekçesi). */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${color ? "" : NEUTRAL_BAR_CLASS}`}
                        style={{
                          width: `${Math.max(maxCategory > 0 ? (slice.amount / maxCategory) * 100 : 0, 1.5)}%`,
                          backgroundColor: color ?? undefined,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-1 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2 pb-1">
                <p className="text-xs text-muted-foreground">{t("entriesTitle")}</p>
                {/* Filtre yalnızca gösterilecek bir şey varken görünüyor —
                    boş bir "mükerrerleri göster" düğmesi kullanıcıya olmayan
                    bir sorun olduğunu ima ederdi. */}
                {duplicateIds.size > 0 && (
                  <Button
                    variant={onlyDuplicates ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-1.5 text-xs"
                    aria-pressed={onlyDuplicates}
                    onClick={() => setOnlyDuplicates((v) => !v)}
                  >
                    <Filter className="size-3.5" />
                    {onlyDuplicates ? t("showAll") : t("onlyDuplicates")}
                  </Button>
                )}
              </div>
              {/* Elle dizilmiş div'ler değil, projenin kendi Table'ı. Hizalama
                  sorunu yapısaldı: aksiyon düğmesi yalnızca kendi satırlarında
                  basıldığı için o satırların tutarı ötekilerden kayıyordu
                  (kullanıcı bildirdi). Tablo sütunları bunu tanımı gereği
                  çözüyor — aksiyon hücresi HER satırda var, yalnızca içeriği
                  değişiyor. */}
              <Table>
                <TableBody>
                  {visibleEntries.map((entry) => {
                    const mine = entry.user_id === currentUserId;
                    return (
                      <TableRow key={entry.id}>
                        {showPayerBreakdown && (
                          <TableCell className="w-9 min-w-9 pr-0 align-middle">
                            <span
                              aria-hidden
                              className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
                            >
                              {initials(entry.payer_name)}
                            </span>
                          </TableCell>
                        )}
                        {/* w-full + max-w-0: tablo düzeninde bu ikisi birlikte
                            "kalan bütün genişliği bu sütun alsın, ama içerik
                            taşarsa truncate olsun" demek. Yalnızca max-w-0
                            verilince sütun büzüşüyor ve açıklama boş alan
                            varken bile erkenden kırpılıyordu. */}
                        <TableCell className="w-full max-w-0 align-middle">
                          <p className="truncate text-sm">
                            {entry.description || categoryLabel((k) => tLedger(k), entry.category)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {/* Ödeyen adı ayara bağlı; tarih her zaman kalıyor —
                                "hangi harcama" sorusunun cevabı ödeyenden bağımsız. */}
                            {showPayerBreakdown ? `${entry.payer_name ?? t("unnamed")} · ` : ""}
                            {formatShortDate(entry.occurred_at, locale)}
                          </p>
                        </TableCell>
                        <TableCell className="text-right align-middle text-sm font-medium tabular-nums">
                          {formatCurrency(entry.amount, locale)}
                        </TableCell>
                        <TableCell className="w-10 min-w-10 pl-1 pr-0 text-right align-middle">
                          {/* Kendi kaydını her zaman çıkarabilirsin; YÖNETİCİ
                              başkasınınkini de çıkarabilir — ama SİLEMEZ. O
                              satır sahibinin kendi defterinde ve bakiyesinde
                              duruyor; grubun toplamını düzeltmek için
                              çıkarmak yetiyor, silmek gereksiz yan hasar.
                              Yetki iki ayrı yolda: kendi satırın normal
                              policy'den, yabancı satır definer RPC'den. */}
                          {mine || isAdmin ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("detach")}
                              title={t("detach")}
                              disabled={detaching === entry.id}
                              className="text-muted-foreground hover:text-foreground"
                              onClick={async () => {
                                setDetaching(entry.id);
                                const result = mine
                                  ? await detachEntryFromGroup(entry.id)
                                  : await detachEntryAsAdmin(entry.id);
                                setDetaching(null);
                                if (result.error) {
                                  setError(result.error);
                                  return;
                                }
                                router.refresh();
                              }}
                            >
                              {/* Unlink2 — çarpı ya da çöp kutusu DEĞİL: bu eylem
                                  kaydı SİLMİYOR, yalnızca grupla bağını kesiyor.
                                  Çöp kutusu yanlış bir vaat, çarpı ise hiçbir
                                  şey anlatmıyordu. */}
                              <Unlink2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {error ? <p className="text-sm text-signal-caution-foreground">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
