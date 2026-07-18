import type { NewsContextItem } from "./prompts.ts";
import type { Oneri } from "./schema.ts";

// atif_baslik must string-match a real headline from the context sent to
// the model — an injected instruction inside a headline can't cite a real
// headline it invented (docs/phase1-plan.md F.1). Rows that fail are
// dropped, not fixed up; the caller retries the whole call once.
export function partitionByCitation(
  oneriler: Oneri[],
  news: NewsContextItem[],
): { valid: Oneri[]; invalid: Oneri[] } {
  const headlines = new Set(news.map((n) => n.baslik));
  const valid: Oneri[] = [];
  const invalid: Oneri[] = [];
  for (const oneri of oneriler) {
    (headlines.has(oneri.atif_baslik) ? valid : invalid).push(oneri);
  }
  return { valid, invalid };
}
