import OpenAI from "npm:openai@^6";
import { zodResponseFormat } from "npm:openai@^6/helpers/zod";
import { statementResponseSchema, type StatementResponse } from "./schema.ts";
import { buildStatementSystemPrompt, buildStatementUserPrompt } from "./prompts.ts";

// Artık yalnızca satırları değil, ekstre başlığını (kesim/son ödeme tarihi)
// da döndürüyor — başlık banka başına regex ile bulunmuyor, modelin özet
// adaylarından seçmesiyle geliyor (bkz. schema.ts'teki statementHeaderSchema
// notu).
export async function parseStatement(params: {
  apiKey: string;
  statementMarkdown: string;
}): Promise<StatementResponse> {
  const client = new OpenAI({ apiKey: params.apiKey });

  const completion = await client.chat.completions.parse({
    model: "gpt-4o",
    messages: [
      { role: "system", content: buildStatementSystemPrompt() },
      { role: "user", content: buildStatementUserPrompt(params.statementMarkdown) },
    ],
    response_format: zodResponseFormat(statementResponseSchema, "statement_response"),
  });

  return (
    completion.choices[0]?.message.parsed ?? {
      ekstre: { hesap_kesim_tarihi: null, son_odeme_tarihi: null },
      islemler: [],
    }
  );
}
