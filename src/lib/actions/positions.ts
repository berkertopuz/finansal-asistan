"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const addPositionSchema = z.object({
  asset_class: z.enum(["bist", "gold", "crypto", "fx"]),
  symbol: z
    .string()
    .trim()
    .min(1, { message: "Sembol gerekli." })
    .max(20, { message: "Sembol çok uzun." })
    .transform((s) => s.toUpperCase()),
  quantity: z.coerce.number().positive({ message: "Adet 0'dan büyük olmalı." }),
  avg_cost_try: z.coerce
    .number()
    .nonnegative({ message: "Maliyet negatif olamaz." })
    .max(10_000_000, { message: "Maliyet çok yüksek görünüyor." }),
});

export type AddPositionState = { error?: string; success?: boolean };

export async function addPosition(
  _prevState: AddPositionState,
  formData: FormData,
): Promise<AddPositionState> {
  const parsed = addPositionSchema.safeParse({
    asset_class: formData.get("asset_class"),
    symbol: formData.get("symbol"),
    quantity: formData.get("quantity"),
    avg_cost_try: formData.get("avg_cost_try"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Geçersiz bilgiler." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Oturum bulunamadı, tekrar giriş yap." };
  }

  const { asset_class, symbol, quantity, avg_cost_try } = parsed.data;

  // UNIQUE(user_id, asset_class, symbol) — re-adding a held symbol merges
  // into it (weighted-average cost) rather than erroring, matching how a
  // brokerage treats "buy more of something you already hold".
  const { data: existing } = await supabase
    .from("portfolio_positions")
    .select("id, quantity, avg_cost_try")
    .eq("user_id", user.id)
    .eq("asset_class", asset_class)
    .eq("symbol", symbol)
    .maybeSingle();

  if (existing) {
    const mergedQuantity = Number(existing.quantity) + quantity;
    const mergedAvgCost =
      (Number(existing.quantity) * Number(existing.avg_cost_try) + quantity * avg_cost_try) /
      mergedQuantity;

    const { error } = await supabase
      .from("portfolio_positions")
      .update({ quantity: mergedQuantity, avg_cost_try: mergedAvgCost })
      .eq("id", existing.id);

    if (error) return { error: "Kaydedilemedi, tekrar dene." };
  } else {
    const { error } = await supabase.from("portfolio_positions").insert({
      user_id: user.id,
      asset_class,
      symbol,
      quantity,
      avg_cost_try,
    });

    if (error) return { error: "Kaydedilemedi, tekrar dene." };
  }

  revalidatePath("/portfoy");
  return { success: true };
}

export async function deletePosition(id: string) {
  const supabase = await createClient();
  // RLS scopes this to the caller's own rows (portfolio_positions_delete_own).
  await supabase.from("portfolio_positions").delete().eq("id", id);
  revalidatePath("/portfoy");
}
