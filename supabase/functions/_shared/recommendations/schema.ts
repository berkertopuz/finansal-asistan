import { z } from "npm:zod@^4";

// Mirrors docs/phase1-plan.md D.1 rule 5's JSON shape exactly — kept in
// sync by hand with src/lib/recommendations/schema.ts (Next.js side, used
// by the manual-refresh streaming route). Two runtimes (Deno vs Node), no
// shared package for a project this size, so: same shape, two files.
export const oneriSchema = z.object({
  varlik_sinifi: z.enum(["bist", "gold", "crypto", "fx"]),
  sembol: z.string(),
  sinyal: z.enum(["al", "tut", "sat"]).nullable(),
  gerekce: z.string(),
  atif_baslik: z.string(),
  atif_url: z.string(),
  guven: z.enum(["yuksek", "orta", "dusuk"]),
});

export const llmResponseSchema = z.object({
  oneriler: z.array(oneriSchema),
});

export type Oneri = z.infer<typeof oneriSchema>;
export type LlmResponse = z.infer<typeof llmResponseSchema>;

// guven (LLM-facing) -> confidence (DB enum, also reused as the T1/T2/T3
// vocabulary already used for code-confidence elsewhere in the project —
// see migration 20260718120000, recommendations.confidence comment).
export function guvenToConfidence(guven: Oneri["guven"]): "T1" | "T2" | "T3" {
  return { yuksek: "T1", orta: "T2", dusuk: "T3" }[guven] as "T1" | "T2" | "T3";
}
