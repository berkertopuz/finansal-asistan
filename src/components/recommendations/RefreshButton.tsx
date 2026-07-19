"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { RECOMMENDATIONS_KEY } from "./RecommendationList";

// POST-based SSE — EventSource can't do POST, so the stream is read by hand
// off res.body. Text arrives as an already-validated reveal (see
// src/app/api/recommendations/stream/route.ts for why it isn't literal
// model-token streaming), one recommendation's gerekçe per line.
export function RefreshButton() {
  const [pending, setPending] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("recommendations");

  async function handleRefresh() {
    setPending(true);
    setError(null);
    setLines([]);

    try {
      const res = await fetch("/api/recommendations/stream", { method: "POST" });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? t("refreshFailed"));
        setPending(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const match = part.match(/^data: (.*)$/m);
          if (!match) continue;
          const payload = JSON.parse(match[1]);
          if (payload.text) setLines((prev) => [...prev, payload.text]);
          if (payload.done && payload.generated > 0) mutate(RECOMMENDATIONS_KEY);
        }
      }
    } catch {
      setError(t("connectionError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-6">
      <Button type="button" size="touch" onClick={handleRefresh} disabled={pending} className="w-full">
        {pending ? t("refreshing") : t("refresh")}
      </Button>
      {lines.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-signal-caution-foreground">{error}</p>}
    </div>
  );
}
