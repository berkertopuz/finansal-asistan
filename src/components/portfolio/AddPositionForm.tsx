"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { useTranslations } from "next-intl";
import { addPosition, type AddPositionState } from "@/lib/actions/positions";
import { ASSET_CLASSES, FIXED_SYMBOLS, type AssetClass } from "@/lib/portfolio";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function AddPositionForm({ onSaved }: { onSaved: () => void }) {
  const [assetClass, setAssetClass] = useState<AssetClass>("bist");
  const [fundedFromCash, setFundedFromCash] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const t = useTranslations("portfolio");
  const tAssetClass = useTranslations("assetClass");
  const tCommon = useTranslations("common");

  const [state, formAction, pending] = useActionState(
    async (_prevState: AddPositionState, formData: FormData) => {
      const result = await addPosition(_prevState, formData);
      if (result.success) {
        formRef.current?.reset();
        setAssetClass("bist");
        setFundedFromCash(false);
        mutate("/api/positions");
        router.refresh();
        onSaved();
      }
      return result;
    },
    {},
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4 px-4 pb-6">
      <input type="hidden" name="asset_class" value={assetClass} />

      <div className="flex flex-col gap-1.5">
        <Label>{t("assetClassLabel")}</Label>
        <ToggleGroup
          value={[assetClass]}
          onValueChange={(next) => next[0] && setAssetClass(next[0] as AssetClass)}
          className="w-full flex-nowrap"
        >
          {ASSET_CLASSES.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-touch flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90"
            >
              {tAssetClass(value)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {FIXED_SYMBOLS[assetClass] ? (
        <input type="hidden" name="symbol" value={FIXED_SYMBOLS[assetClass]} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="symbol">{t("symbolLabel")}</Label>
          <Input
            id="symbol"
            name="symbol"
            type="text"
            placeholder={t(assetClass === "manual" ? "symbolPlaceholderManual" : "symbolPlaceholder")}
            autoFocus
            required
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quantity">{t("quantityLabel")}</Label>
        <Input
          id="quantity"
          name="quantity"
          type="number"
          inputMode="decimal"
          step="0.00000001"
          min="0"
          placeholder="0"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="avg_cost_try">{t("avgCostLabel")}</Label>
        <Input
          id="avg_cost_try"
          name="avg_cost_try"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="0,00"
          required
        />
      </div>

      <label className="flex min-h-touch items-center gap-3 rounded-lg py-1">
        <Checkbox
          name="funded_from_cash"
          value="true"
          checked={fundedFromCash}
          onCheckedChange={setFundedFromCash}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{t("fundedFromCashLabel")}</span>
          <span className="text-xs text-muted-foreground">{t("fundedFromCashHint")}</span>
        </span>
      </label>

      {state?.error && (
        <p className="text-sm text-signal-caution-foreground">{state.error}</p>
      )}

      <Button type="submit" size="touch" disabled={pending} className="w-full">
        {pending ? tCommon("saving") : tCommon("save")}
      </Button>
    </form>
  );
}
