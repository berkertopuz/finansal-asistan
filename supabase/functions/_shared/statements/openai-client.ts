import OpenAI from "npm:openai@^6";
import { zodResponseFormat } from "npm:openai@^6/helpers/zod";
import { statementResponseSchema, type StatementRow } from "./schema.ts";
import { buildStatementSystemPrompt, buildStatementUserPrompt } from "./prompts.ts";

export async function parseStatementTransactions(params: {
  apiKey: string;
  transactionText: string;
}): Promise<StatementRow[]> {
  const client = new OpenAI({ apiKey: params.apiKey });

  const completion = await client.chat.completions.parse({
    model: "gpt-4o",
    messages: [
      { role: "system", content: buildStatementSystemPrompt() },
      { role: "user", content: buildStatementUserPrompt(params.transactionText) },
    ],
    response_format: zodResponseFormat(statementResponseSchema, "statement_response"),
  });

  return completion.choices[0]?.message.parsed?.islemler ?? [];
}
