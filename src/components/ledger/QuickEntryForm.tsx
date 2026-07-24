"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useLocale, useTranslations } from "next-intl";
import { addEntry, updateEntry, type AddEntryState } from "@/lib/actions/entries";
import { addCategory } from "@/lib/actions/categories";
import type { Category } from "@/lib/categories-data";
import type { CreditCard } from "@/lib/credit-cards-data";
import {
  DEFAULT_CATEGORY,
  ENTRY_CATEGORIES,
  ENTRY_KINDS,
  ENTRY_RECURRENCES,
  type Entry,
  type EntryKind,
  type EntryRecurrence,
} from "@/lib/ledger";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CATEGORIES_KEY = "/api/categories";
const categoriesFetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch categories");
    return res.json();
  });

const CREDIT_CARDS_KEY = "/api/credit-cards";
const creditCardsFetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch credit cards");
    return res.json();
  });

// Local date, not toISOString().slice(0,10) — that reads UTC parts, which
// drifts a day off around midnight depending on the user's timezone.
function todayDateInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The ≤3-tap flow (docs/phase1-plan.md B): FAB is tap 1 (opens this sheet
// with "Gider" preselected and the amount field auto-focused — typing on
// the numeric keyboard doesn't count against the budget). Category,
// açıklama and sıklık all default sensibly and are skippable, so Kaydet
// right after typing an amount is tap 2; touching any one optional field
// makes Kaydet tap 3.
//
// editingEntry switches the same form into edit mode (pre-filled, calls
// updateEntry instead of addEntry) — EntryTable's row-edit action opens
// this in a Sheet exactly like QuickAddFAB does for a new entry.
export function QuickEntryForm({
  onSaved,
  editingEntry,
  defaultKind = "expense",
}: {
  onSaved: () => void;
  editingEntry?: Entry;
  defaultKind?: EntryKind;
}) {
  // The Gider/Gelir toggle's own state — deliberately NOT the same thing
  // as the `kind` actually sent to the server (computed just below).
  const [giderGelirKind, setGiderGelirKind] = useState<"expense" | "income">(
    editingEntry?.kind === "income" ? "income" : "expense",
  );
  // A fresh subscription defaults straight to the "abonelik" chip instead of
  // "diğer" — same reasoning as the recurrence default just below (kind's
  // toggle is hidden for subscriptions, so there's no user click to set this
  // any other way for a brand-new one).
  const [category, setCategory] = useState<string>(
    editingEntry?.category ?? (defaultKind === "subscription" ? "abonelik" : DEFAULT_CATEGORY),
  );
  // Mirrors the `kind` rule just below — but that only fires on a
  // user-driven toggle switch, which never happens for a fresh subscription
  // (its kind toggle is hidden entirely, see below, so there's no click to
  // trigger it). Without this, a new subscription silently defaulted to
  // "Tek seferlik" instead of "Aylık".
  const [recurrence, setRecurrence] = useState<EntryRecurrence>(
    editingEntry?.recurrence ?? (defaultKind === "subscription" ? "monthly" : "none"),
  );
  // The actual kind sent to the server — always derived, never set
  // directly. "Abonelik kategorisi + herhangi bir tekrar sıklığı = her
  // zaman abonelik" kuralı burada tek bir yerde uygulanıyor, kullanıcının
  // kategoriyi mi sıklığı mı önce değiştirdiğine bakılmaksızın. Önceki
  // tasarım kind'ı ayrı bir state olarak tutup belirli düğme
  // tıklamalarında (ve sadece belirli satırları düzenlerken) elle
  // senkronize etmeye çalışıyordu — kullanıcı sıradan bir gideri kategoriyi
  // "Abonelik" yapıp sıklığı "Aylık" seçerek "aboneliğe çevirmeye"
  // çalıştığında, o satır bu özel senkronizasyonun kapsamında olmadığı için
  // kind='expense' olarak kalıp Abonelikler'in "Kart harcamalarından"
  // bölümünde sessizce birikiyordu. Tek kaynaktan türetmek bu sınıfın
  // tamamını ortadan kaldırıyor — hangi satır, hangi sırayla düzenlenirse
  // düzenlensin aynı kural geçerli.
  const kind: EntryKind = category === "abonelik" && recurrence !== "none" ? "subscription" : giderGelirKind;
  // One shared field for occurred_at/next_due_date — they render as a
  // single input that just relabels itself depending on recurrence (see
  // below), so a date the user already typed carries over instead of
  // vanishing into a blank "Ödeme tarihi" the moment they switch Sıklık to
  // something other than "Tek seferlik".
  const [dateValue, setDateValue] = useState<string>(() => {
    if (!editingEntry) return todayDateInputValue();
    return editingEntry.recurrence === "none"
      ? editingEntry.occurred_at
      : (editingEntry.next_due_date ?? "");
  });
  // Taksit — sadece brand-new bir gider için anlamlı (editingEntry'de hiç
  // gösterilmiyor, aşağıya bkz.): tek bir satırı düzenlemek zaten sıradan
  // bir düzenleme, "seriyi" düzenlemek diye ayrı bir kavram yok.
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentCount, setInstallmentCount] = useState(2);
  // "" = Nakit/Banka (bakiyeyi hemen düşürür, varsayılan — 3-dokunuşluk
  // akışı bozmamak için kart seçmek isteğe bağlı bir dokunuş daha). Dolu bir
  // değer, o karta borç yazar (src/lib/cashflow.ts bunu bakiyeden hemen
  // düşmez, bkz. isCardDebt).
  const [creditCardId, setCreditCardId] = useState<string>(editingEntry?.credit_card_id ?? "");
  // Controlled only so the taksit preview below can read it live — every
  // other field stays uncontrolled (defaultValue) on purpose, this is the
  // one exception.
  const [amountValue, setAmountValue] = useState<string>(
    editingEntry ? String(editingEntry.amount) : "",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const applyToAllRef = useRef<HTMLInputElement>(null);
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addCategoryError, setAddCategoryError] = useState<string | undefined>();
  const [addCategoryPending, setAddCategoryPending] = useState(false);
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const { data: customCategories } = useSWR<Category[]>(CATEGORIES_KEY, categoriesFetcher);
  const { data: creditCards } = useSWR<CreditCard[]>(CREDIT_CARDS_KEY, creditCardsFetcher);

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setAddCategoryPending(true);
    setAddCategoryError(undefined);
    const result = await addCategory(name);
    setAddCategoryPending(false);
    if (result.success && result.category) {
      mutate(CATEGORIES_KEY, (current: Category[] | undefined) => [...(current ?? []), result.category!], {
        revalidate: false,
      });
      setCategory(result.category.name);
      setNewCategoryName("");
      setAddCategoryOpen(false);
    } else {
      setAddCategoryError(result.error);
    }
  }

  const handleGiderGelirChange = (next: "expense" | "income") => {
    setGiderGelirKind(next);
    // Taksit sadece gider için var — Gelir'e geçince checkbox'ın kendisi
    // gizlenir ama state kalırsa gizli input'lar yanlışlıkla "taksitli"
    // göndermeye devam eder.
    if (next !== "expense") setIsInstallment(false);
  };

  const handleRecurrenceChange = (next: EntryRecurrence) => {
    setRecurrence(next);
    // Taksit ve tekrarlayan kayıt birbirini dışlar — biri açılınca öbürünün
    // state'i temizlenir (bkz. yukarıdaki handleGiderGelirChange'in aynı
    // mantığı).
    if (next !== "none") setIsInstallment(false);
  };

  // Sets the hidden field imperatively (not via setState) so the value is
  // guaranteed to be in the DOM before requestSubmit reads the form's
  // FormData in the same call — a state update wouldn't re-render in time.
  function submitWithScope(applyToAll: boolean) {
    if (applyToAllRef.current) {
      applyToAllRef.current.value = applyToAll ? "true" : "false";
    }
    setScopeDialogOpen(false);
    formRef.current?.requestSubmit();
  }

  // Side effects live in the action itself, not a useEffect keyed on
  // `state` — that would fire a setState-cascade on every render (React
  // flags this) for what's really a direct response to the submit.
  const [state, formAction, pending] = useActionState(
    async (_prevState: AddEntryState, formData: FormData) => {
      const result = editingEntry
        ? await updateEntry(_prevState, formData)
        : await addEntry(_prevState, formData);
      if (result.success) {
        if (!editingEntry) {
          formRef.current?.reset();
          setGiderGelirKind(defaultKind === "income" ? "income" : "expense");
          setCategory(DEFAULT_CATEGORY);
          setRecurrence("none");
          setDateValue(todayDateInputValue());
          setIsInstallment(false);
          setInstallmentCount(2);
          setCreditCardId("");
        }
        mutate("/api/entries");
        router.refresh();
        onSaved();
      }
      return result;
    },
    {},
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3 px-4 pb-6">
      {editingEntry && <input type="hidden" name="id" value={editingEntry.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="recurrence" value={recurrence} />
      <input type="hidden" name="isInstallment" value={isInstallment ? "true" : "false"} />
      <input type="hidden" name="installmentCount" value={installmentCount} />
      <input type="hidden" name="credit_card_id" value={giderGelirKind === "income" ? "" : creditCardId} />
      {/* Only ever read by updateEntry, and only when the row being edited
          is itself a recurring rule — set imperatively by submitWithScope
          right before requestSubmit, never via React state (see there). */}
      <input ref={applyToAllRef} type="hidden" name="applyToAllOccurrences" defaultValue="false" />

      {/* Hidden, not just left unselected, when kind (computed above) is
          "subscription" — a pressed toggle would have nothing to show as
          active otherwise, and category="Abonelik" + a Sıklık already
          means subscription regardless of what this toggle says. "Abonelik"
          itself never appears as a pickable option here — an earlier
          version added it as a third option, sitting right next to the
          unrelated "Abonelik" category chip further down (same label, two
          different controls) — clicking the wrong one, or changing category
          to "Abonelik" without touching this toggle at all, could leave a
          row as a recurring EXPENSE tagged abonelik instead of a real
          subscription. Deriving kind from category+recurrence instead of a
          dedicated control removes that ambiguity entirely. */}
      {kind !== "subscription" && (
        <ToggleGroup
          value={[giderGelirKind]}
          onValueChange={(next) => next[0] && handleGiderGelirChange(next[0] as "expense" | "income")}
          className="w-full flex-nowrap"
        >
          {ENTRY_KINDS.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              // aria-pressed here, not a plain conditional class — Base UI's
              // Toggle marks the pressed item aria-pressed="true" (not
              // data-state), and the base style's aria-pressed:bg-muted
              // beats an unconditional class on specificity, not order.
              // A specific hex the user picked directly (not a semantic
              // signal token) — same for both Gider and Gelir, deliberately
              // not yellow/amber.
              className="h-touch flex-1 aria-pressed:bg-[#7c95b0] aria-pressed:text-background aria-pressed:hover:bg-[#7c95b0]/90"
            >
              {t(`kind.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {/* Tutar paired with whichever date field currently applies (never
          both at once — see the comment below) instead of each stacking as
          its own full-width row. This is the main space saving in the
          whole form: one less row of height, on every screen size, without
          hiding anything. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="amount">{t("form.amountLabel")}</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0,00"
            value={amountValue}
            onChange={(e) => setAmountValue(e.target.value)}
            autoFocus
            required
          />
        </div>

        {/* One input standing in for both occurred_at (one-off) and
            next_due_date (recurring) — never both meaningful at once (a
            recurring row's occurred_at is just "added to the ledger on
            this day", not user-facing), so relabeling the same field on
            recurrence change is what keeps a date the user already typed
            from vanishing into a blank field the moment they switch
            Sıklık. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-date">
            {recurrence === "none" ? t("form.dateLabel") : t("form.dueDateLabel")}
          </Label>
          <Input
            id="entry-date"
            name={recurrence === "none" ? "occurred_at" : "next_due_date"}
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* Abonelikler, bu alanı satırın ana başlığı olarak gösteriyor
            (EntryTable'ın titleField="description" modu — kategori zaten
            her satırda "Abonelik" olduğu için ayırt edici olan bu). O yüzden
            kind="subscription" iken zorunlu — boş kalırsa o satırın başlığı
            olmazdı. */}
        <Label htmlFor="description">
          {kind === "subscription" ? t("form.subscriptionNameLabel") : t("form.descriptionLabel")}
        </Label>
        <Input
          id="description"
          name="description"
          type="text"
          maxLength={200}
          placeholder={kind === "subscription" ? t("form.subscriptionNamePlaceholder") : t("form.descriptionPlaceholder")}
          required={kind === "subscription"}
          defaultValue={editingEntry?.description ?? ""}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("form.recurrenceLabel")}</Label>
        {category === "abonelik" && (
          <p className="text-xs text-muted-foreground">{t("form.convertToSubscriptionHint")}</p>
        )}
        <ToggleGroup
          value={[recurrence]}
          onValueChange={(next) =>
            next[0] && handleRecurrenceChange(next[0] as EntryRecurrence)
          }
          className="w-full flex-wrap gap-2"
        >
          {ENTRY_RECURRENCES.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              variant="outline"
              // Neutral, not the same green accent/primary the kind toggle
              // above already uses — every active control sharing one
              // green tone was the "doesn't look pleasant" complaint this
              // is fixing.
              className="h-touch aria-pressed:border-foreground/30 aria-pressed:bg-foreground/10 aria-pressed:text-foreground"
            >
              {t(`recurrence.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {recurrence !== "none" && category !== "abonelik" && (
          <p className="text-xs text-muted-foreground">{t("form.recurrenceNote")}</p>
        )}
      </div>

      {/* Gelir hiçbir zaman bir karta bağlanamaz (DB CHECK) — yalnızca
          gider/abonelik için gösteriliyor. Varsayılan hep "Nakit/Banka"
          (boş değer): kart seçmek isteğe bağlı bir dokunuş daha, 3-dokunuşluk
          akışı bozmuyor. */}
      {giderGelirKind !== "income" && creditCards && creditCards.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-method">{t("form.paymentMethodLabel")}</Label>
          <select
            id="payment-method"
            value={creditCardId}
            onChange={(e) => setCreditCardId(e.target.value)}
            className="min-h-touch rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t("form.paymentMethodCash")}</option>
            {creditCards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Taksit yalnızca yeni, tek seferlik bir gider için anlamlı —
          tekrarlayan bir kuralın (recurrence !== "none") ya da zaten var
          olan bir satırın (editingEntry) "taksitli" hâle getirilmesi diye
          bir kavram yok; ikisi de kavramsal olarak farklı şeyler. */}
      {kind === "expense" && recurrence === "none" && !editingEntry && (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Checkbox checked={isInstallment} onCheckedChange={setIsInstallment} />
            {t("form.installmentLabel")}
          </label>
          {isInstallment && (
            <div className="flex flex-col gap-1.5 pl-1">
              <Label htmlFor="installment-count">{t("form.installmentCountLabel")}</Label>
              <Input
                id="installment-count"
                type="number"
                inputMode="numeric"
                min={2}
                max={36}
                value={installmentCount}
                onChange={(e) => setInstallmentCount(Number(e.target.value) || 2)}
                className="max-w-24"
              />
              {Number(amountValue) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("form.installmentPreview", {
                    count: installmentCount,
                    amount: formatCurrency(Number(amountValue) / installmentCount, locale),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>{t("form.categoryLabel")}</Label>
        <ToggleGroup
          value={[category]}
          onValueChange={(next) => next[0] && setCategory(next[0])}
          className="w-full flex-wrap gap-2"
        >
          {ENTRY_CATEGORIES.map((cat) => (
            <ToggleGroupItem
              key={cat}
              value={cat}
              variant="outline"
              // Same neutral treatment as the recurrence toggle above —
              // see its comment.
              className="h-touch aria-pressed:border-foreground/30 aria-pressed:bg-foreground/10 aria-pressed:text-foreground"
            >
              {t(`category.${cat}`)}
            </ToggleGroupItem>
          ))}
          {/* Kullanıcının kendi eklediği etiketler (Ayarlar'dan da
              yönetilir — src/components/settings/CategoryManager.tsx) —
              ham `name` metniyle basılır, categoryLabel() zaten preset
              olmayan değerleri olduğu gibi gösteriyor (src/lib/ledger.ts). */}
          {customCategories?.map((cat) => (
            <ToggleGroupItem
              key={cat.id}
              value={cat.name}
              variant="outline"
              className="h-touch aria-pressed:border-foreground/30 aria-pressed:bg-foreground/10 aria-pressed:text-foreground"
            >
              {cat.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-touch w-fit text-muted-foreground"
          onClick={() => setAddCategoryOpen(true)}
        >
          {t("categories.addLabel")}
        </Button>
      </div>

      {state?.error && (
        <p className="text-sm text-signal-caution-foreground">{state.error}</p>
      )}

      <Button
        type="submit"
        size="touch"
        disabled={pending}
        className="w-full"
        onClick={(e) => {
          // Editing a recurring rule (not a brand-new one, and not a single
          // month's already-generated row — that never reaches this form
          // with recurrence !== "none") needs the user to pick a scope
          // before anything is actually submitted.
          if (editingEntry && editingEntry.recurrence !== "none") {
            e.preventDefault();
            setScopeDialogOpen(true);
          }
        }}
      >
        {pending ? tCommon("saving") : editingEntry ? t("form.update") : tCommon("save")}
      </Button>

      <Dialog open={scopeDialogOpen} onOpenChange={setScopeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("form.editScopeTitle")}</DialogTitle>
            <DialogDescription>{t("form.editScopeDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-col">
            <Button type="button" variant="outline" className="w-full" onClick={() => submitWithScope(false)}>
              {t("form.editScopeFutureOnly")}
            </Button>
            <Button type="button" variant="default" className="w-full" onClick={() => submitWithScope(true)}>
              {t("form.editScopeAll")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setScopeDialogOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addCategoryOpen}
        onOpenChange={(open) => {
          setAddCategoryOpen(open);
          if (!open) {
            setNewCategoryName("");
            setAddCategoryError(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("categories.addDialogTitle")}</DialogTitle>
            <DialogDescription>{t("categories.addDialogDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            type="text"
            maxLength={50}
            placeholder={t("categories.namePlaceholder")}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCategory();
              }
            }}
            autoFocus
          />
          {addCategoryError && (
            <p className="text-sm text-signal-caution-foreground">{addCategoryError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddCategoryOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" disabled={addCategoryPending} onClick={handleAddCategory}>
              {addCategoryPending ? tCommon("saving") : tCommon("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
