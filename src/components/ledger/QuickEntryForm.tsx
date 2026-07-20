"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { useTranslations } from "next-intl";
import { addEntry, updateEntry, type AddEntryState } from "@/lib/actions/entries";
import {
  DEFAULT_CATEGORY,
  ENTRY_CATEGORIES,
  ENTRY_KINDS,
  ENTRY_RECURRENCES,
  type Entry,
  type EntryKind,
  type EntryRecurrence,
} from "@/lib/ledger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
  const [kind, setKind] = useState<EntryKind>(editingEntry?.kind ?? defaultKind);
  const [category, setCategory] = useState<string>(editingEntry?.category ?? DEFAULT_CATEGORY);
  const [recurrence, setRecurrence] = useState<EntryRecurrence>(
    editingEntry?.recurrence ?? "none",
  );
  const recurrenceTouched = useRef(Boolean(editingEntry));
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const t = useTranslations("ledger");
  const tCommon = useTranslations("common");

  const handleKindChange = (nextKind: EntryKind) => {
    setKind(nextKind);
    // Abonelikler varsayılan olarak aylık tekrar eder — kullanıcı sıklığı
    // kendi eliyle değiştirmediyse bu varsayılanı ezmiyoruz.
    if (!recurrenceTouched.current) {
      setRecurrence(nextKind === "subscription" ? "monthly" : "none");
    }
  };

  const handleRecurrenceChange = (next: EntryRecurrence) => {
    recurrenceTouched.current = true;
    setRecurrence(next);
  };

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
          setKind(defaultKind);
          setCategory(DEFAULT_CATEGORY);
          setRecurrence("none");
          recurrenceTouched.current = false;
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
    <form ref={formRef} action={formAction} className="flex flex-col gap-4 px-4 pb-6">
      {editingEntry && <input type="hidden" name="id" value={editingEntry.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="recurrence" value={recurrence} />

      <ToggleGroup
        value={[kind]}
        onValueChange={(next) => next[0] && handleKindChange(next[0] as EntryKind)}
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
            className="h-touch flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90"
          >
            {t(`kind.${value}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

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
          defaultValue={editingEntry?.amount}
          autoFocus
          required
        />
      </div>

      {/* Only for one-off entries — a recurring entry's single meaningful
          date is the due date below (next_due_date), which anchors every
          future occurrence. Showing both here was confusing: which one is
          "the" date? occurred_at for a recurring row just means "added to
          the ledger on this day" and isn't user-facing at all now. */}
      {recurrence === "none" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="occurred_at">{t("form.dateLabel")}</Label>
          <Input
            id="occurred_at"
            name="occurred_at"
            type="date"
            defaultValue={editingEntry?.occurred_at ?? todayDateInputValue()}
            required
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">{t("form.descriptionLabel")}</Label>
        <Input
          id="description"
          name="description"
          type="text"
          maxLength={200}
          placeholder={t("form.descriptionPlaceholder")}
          defaultValue={editingEntry?.description ?? ""}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("form.recurrenceLabel")}</Label>
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
              className="h-touch aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            >
              {t(`recurrence.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {recurrence !== "none" && (
          <p className="text-xs text-muted-foreground">{t("form.recurrenceNote")}</p>
        )}
      </div>

      {recurrence !== "none" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="next_due_date">{t("form.dueDateLabel")}</Label>
          <Input
            id="next_due_date"
            name="next_due_date"
            type="date"
            defaultValue={editingEntry?.next_due_date ?? ""}
            required
          />
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
              className="h-touch aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            >
              {t(`category.${cat}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {state?.error && (
        <p className="text-sm text-signal-caution-foreground">{state.error}</p>
      )}

      <Button type="submit" size="touch" disabled={pending} className="w-full">
        {pending ? tCommon("saving") : editingEntry ? t("form.update") : tCommon("save")}
      </Button>
    </form>
  );
}
