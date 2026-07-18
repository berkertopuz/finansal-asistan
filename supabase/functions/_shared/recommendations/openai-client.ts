import OpenAI from "npm:openai@^6";
import { zodResponseFormat } from "npm:openai@^6/helpers/zod";
import { llmResponseSchema, type Oneri } from "./schema.ts";
import { partitionByCitation } from "./validate.ts";
import { SYSTEM_PROMPT, type NewsContextItem } from "./prompts.ts";

async function callOnce(client: OpenAI, userPrompt: string): Promise<Oneri[]> {
  const completion = await client.chat.completions.parse({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    // Strict JSON-schema mode guarantees the *shape* (rule 5); citation
    // matching below is the part schema enforcement can't cover.
    response_format: zodResponseFormat(llmResponseSchema, "oneriler_response"),
  });
  return completion.choices[0]?.message.parsed?.oneriler ?? [];
}

function dedupe(oneriler: Oneri[]): Oneri[] {
  const seen = new Set<string>();
  return oneriler.filter((o) => {
    const key = `${o.varlik_sinifi}:${o.sembol}:${o.sinyal ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// atif_baslik mismatch → drop the row, retry the whole call once, drop
// whatever's still unmatched after that (docs/phase1-plan.md D.1 rule 5's
// comment). A full retry, not a per-row patch — the model needs the full
// context to regenerate sensibly.
export async function generateValidatedOneriler(params: {
  apiKey: string;
  userPrompt: string;
  news: NewsContextItem[];
}): Promise<Oneri[]> {
  const client = new OpenAI({ apiKey: params.apiKey });

  const first = await callOnce(client, params.userPrompt);
  const { valid, invalid } = partitionByCitation(first, params.news);

  if (invalid.length === 0) return dedupe(valid);

  const retry = await callOnce(client, params.userPrompt);
  const { valid: retryValid } = partitionByCitation(retry, params.news);

  return dedupe([...valid, ...retryValid]);
}
