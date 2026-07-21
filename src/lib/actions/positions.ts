"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AddPositionState = { error?: string; success?: boolean };

export async function addPosition(
  _prevState: AddPositionState,
  formData: FormData,
): Promise<AddPositionState> {
  const t = await getTranslations("portfolio.errors");
  const addPositionSchema = z.object({
    asset_class: z.enum(["bist", "gold", "crypto", "fx", "manual"]),
    symbol: z
      .string()
      .trim()
      .min(1, { message: t("symbolRequired") })
      .max(40, { message: t("symbolTooLong") })
      .transform((s) => s.toUpperCase()),
    quantity: z.coerce.number().positive({ message: t("quantityPositive") }),
    avg_cost_try: z.coerce
      .number()
      .nonnegative({ message: t("costNegative") })
      .max(10_000_000, { message: t("costTooHigh") }),
  });

  const parsed = addPositionSchema.safeParse({
    asset_class: formData.get("asset_class"),
    symbol: formData.get("symbol"),
    quantity: formData.get("quantity"),
    avg_cost_try: formData.get("avg_cost_try"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const { asset_class, symbol, quantity, avg_cost_try } = parsed.data;
  // Only meaningful for this submission's own cash outlay — read directly
  // off formData rather than through the zod schema above, same pattern as
  // updateEntry's applyToAllOccurrences (src/lib/actions/entries.ts).
  const fundedFromCash = formData.get("funded_from_cash") === "true";

  let validatedSymbol = symbol;

  // "manual" has no live price anywhere (no market_snapshots row, no Edge
  // Function adapter) — validate-symbol only ever knows the four priced
  // classes, so it's skipped entirely and the typed label is used as-is.
  if (asset_class !== "manual") {
    // Free-text symbol with no check let anyone type "BOK" and get a phantom
    // position that never resolves a price — validate-symbol does a real
    // live-price lookup per asset class before we ever write the row.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) {
      return { error: t("sessionInvalid") };
    }

    try {
      const validateRes = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/validate-symbol`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ asset_class, symbol }),
        },
      );
      const validation: { valid: boolean; symbol?: string; error?: string } =
        await validateRes.json();
      if (!validateRes.ok || !validation.valid) {
        return { error: validation.error ?? t("symbolValidationFailed") };
      }
      validatedSymbol = validation.symbol ?? symbol;
    } catch {
      return { error: t("symbolValidationRetry") };
    }
  }

  // UNIQUE(user_id, asset_class, symbol) — re-adding a held symbol merges
  // into it (weighted-average cost) rather than erroring, matching how a
  // brokerage treats "buy more of something you already hold".
  const { data: existing } = await supabase
    .from("portfolio_positions")
    .select("id, quantity, avg_cost_try")
    .eq("user_id", user.id)
    .eq("asset_class", asset_class)
    .eq("symbol", validatedSymbol)
    .maybeSingle();

  let positionId: string;

  if (existing) {
    const mergedQuantity = Number(existing.quantity) + quantity;
    const mergedAvgCost =
      (Number(existing.quantity) * Number(existing.avg_cost_try) + quantity * avg_cost_try) /
      mergedQuantity;

    const { error } = await supabase
      .from("portfolio_positions")
      .update({ quantity: mergedQuantity, avg_cost_try: mergedAvgCost })
      .eq("id", existing.id);

    if (error) return { error: t("saveFailed") };
    positionId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from("portfolio_positions")
      .insert({
        user_id: user.id,
        asset_class,
        symbol: validatedSymbol,
        quantity,
        avg_cost_try,
      })
      .select("id")
      .single();

    if (error || !inserted) return { error: t("saveFailed") };
    positionId = inserted.id;
  }

  // Records that this submission's cash actually left tracked balance — a
  // separate "investment" kind (not "expense") so it reduces currentBalance
  // (src/lib/cashflow.ts) without counting as gider or skewing net fazla.
  // One row per funded submission, even against an already-existing
  // position — a top-up is its own cash outlay, distinct from the position's
  // running quantity/avg_cost_try (see entries_investment_requires_position
  // in supabase/migrations/20260721120000_investment_kind_and_manual_asset.sql).
  // Skipped when this submission's own cost is 0 — entries.amount must be
  // > 0, and there's no cash outlay to record for a free/gifted addition.
  if (fundedFromCash && quantity * avg_cost_try > 0) {
    const { error: entryError } = await supabase.from("entries").insert({
      user_id: user.id,
      kind: "investment",
      amount: quantity * avg_cost_try,
      portfolio_position_id: positionId,
    });
    if (entryError) {
      console.error("addPosition: failed to record cash-out entry", entryError);
    }
  }

  revalidatePath("/portfoy");
  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true };
}

export async function deletePosition(id: string) {
  const supabase = await createClient();
  // RLS scopes this to the caller's own rows (portfolio_positions_delete_own).
  // Its linked "investment" entry, if any, cascades via
  // entries.portfolio_position_id's ON DELETE CASCADE.
  await supabase.from("portfolio_positions").delete().eq("id", id);
  revalidatePath("/portfoy");
  revalidatePath("/defter");
  revalidatePath("/");
}
