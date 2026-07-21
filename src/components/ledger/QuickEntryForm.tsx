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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  // Mirrors handleKindChange's same rule below — but that only fires on a
  // user-driven toggle switch, which never happens for a fresh subscription
  // (its kind toggle is hidden entirely, see below, so there's no click to
  // trigger it). Without this, a new subscription silently defaulted to
  // "Tek seferlik" instead of "Aylık".
  const [recurrence, setRecurrence] = useState<EntryRecurrence>(
    editingEntry?.recurrence ?? (defaultKind === "subscription" ? "monthly" : "none"),
  );
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
  const recurrenceTouched = useRef(Boolean(editingEntry));
  const formRef = useRef<HTMLFormElement>(null);
  const applyToAllRef = useRef<HTMLInputElement>(null);
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
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
          setKind(defaultKind);
          setCategory(DEFAULT_CATEGORY);
          setRecurrence("none");
          setDateValue(todayDateInputValue());
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
    <form ref={formRef} action={formAction} className="flex flex-col gap-3 px-4 pb-6">
      {editingEntry && <input type="hidden" name="id" value={editingEntry.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="recurrence" value={recurrence} />
      {/* Only ever read by updateEntry, and only when the row being edited
          is itself a recurring rule — set imperatively by submitWithScope
          right before requestSubmit, never via React state (see there). */}
      <input ref={applyToAllRef} type="hidden" name="applyToAllOccurrences" defaultValue="false" />

      {/* Hidden, not just left unselected, when editing/adding a
          subscription — ENTRY_KINDS no longer lists "subscription" (see
          src/lib/ledger.ts), so a pressed toggle would have nothing to
          show as active. Subscriptions only ever come from the Abonelikler
          page's own FAB or its edit sheet, both of which already know the
          kind and don't need a switcher for it. */}
      {kind !== "subscription" && (
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
            defaultValue={editingEntry?.amount}
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
        {recurrence !== "none" && (
          <p className="text-xs text-muted-foreground">{t("form.recurrenceNote")}</p>
        )}
      </div>

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
        </ToggleGroup>
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
    </form>
  );
}
