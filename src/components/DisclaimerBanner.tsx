import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Server-rendered and static — deliberately not the LLM's job, so it can
// never be omitted by a bad generation (CLAUDE.md rule 2). Always render
// this above the fold on any recommendation surface. The text itself is
// still a fixed message-catalog string per locale (not LLM output), so the
// legal guarantee holds in either language.
export function DisclaimerBanner({ className }: { className?: string } = {}) {
  const t = useTranslations("disclaimer");

  return (
    <div
      className={cn(
        "border-b border-signal-caution-foreground/20 bg-signal-caution-bg px-4 py-3 text-sm text-signal-caution-foreground",
        className,
      )}
    >
      {t("text")}
    </div>
  );
}
