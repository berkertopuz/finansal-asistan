"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { addEntry, type AddEntryState } from "@/lib/actions/entries";
import {
  DEFAULT_CATEGORY,
  ENTRY_CATEGORIES,
  ENTRY_KINDS,
  ENTRY_RECURRENCES,
  type EntryKind,
  type EntryRecurrence,
} from "@/lib/ledger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// The ≤3-tap flow (docs/phase1-plan.md B): FAB is tap 1 (opens this sheet
// with "Gider" preselected and the amount field auto-focused — typing on
// the numeric keyboard doesn't count against the budget). Category,
// açıklama and sıklık all default sensibly and are skippable, so Kaydet
// right after typing an amount is tap 2; touching any one optional field
// makes Kaydet tap 3.
export function QuickEntryForm({ onSaved }: { onSaved: () => void }) {
  const [kind, setKind] = useState<EntryKind>("expense");
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [recurrence, setRecurrence] = useState<EntryRecurrence>("none");
  const recurrenceTouched = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

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
      const result = await addEntry(_prevState, formData);
      if (result.success) {
        formRef.current?.reset();
        setKind("expense");
        setCategory(DEFAULT_CATEGORY);
        setRecurrence("none");
        recurrenceTouched.current = false;
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
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="recurrence" value={recurrence} />

      <ToggleGroup
        value={[kind]}
        onValueChange={(next) => next[0] && handleKindChange(next[0] as EntryKind)}
        className="w-full flex-nowrap"
      >
        {ENTRY_KINDS.map(({ value, label }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            // aria-pressed here, not a plain conditional class — Base UI's
            // Toggle marks the pressed item aria-pressed="true" (not
            // data-state), and the base style's aria-pressed:bg-muted
            // beats an unconditional class on specificity, not order.
            className="h-touch flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="amount">Tutar</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="0,00"
          autoFocus
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Açıklama (opsiyonel)</Label>
        <Input
          id="description"
          name="description"
          type="text"
          maxLength={200}
          placeholder="örn. Temmuz kirası"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Sıklık</Label>
        <ToggleGroup
          value={[recurrence]}
          onValueChange={(next) =>
            next[0] && handleRecurrenceChange(next[0] as EntryRecurrence)
          }
          className="w-full flex-wrap gap-2"
        >
          {ENTRY_RECURRENCES.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              variant="outline"
              className="h-touch aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {recurrence !== "none" && (
          <p className="text-xs text-muted-foreground">
            Bu kayıt her ay otomatik olarak fazla hesabına dahil edilir, tekrar
            girmen gerekmez.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Kategori</Label>
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
              {cat}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {state?.error && (
        <p className="text-sm text-signal-caution-foreground">{state.error}</p>
      )}

      <Button type="submit" size="touch" disabled={pending} className="w-full">
        {pending ? "Kaydediliyor…" : "Kaydet"}
      </Button>
    </form>
  );
}
