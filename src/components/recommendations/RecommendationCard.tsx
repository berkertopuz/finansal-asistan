import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { SIGNAL_TONE, type Recommendation } from "@/lib/recommendations";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  const r = recommendation;
  const locale = useLocale() as AppLocale;
  const tAssetClass = useTranslations("assetClass");
  const tRec = useTranslations("recommendations");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{tAssetClass(r.asset_class)}</Badge>
          <span className="text-sm font-semibold text-foreground">{r.symbol}</span>
        </div>
        <span
          className="text-xs text-muted-foreground"
          title={tRec(`confidenceHint.${r.confidence}`)}
        >
          {tRec(`confidence.${r.confidence}`)}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {r.signal && (
          <span
            className={cn(
              "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium",
              SIGNAL_TONE[r.signal],
            )}
          >
            {tRec(`signal.${r.signal}`)}
          </span>
        )}
        <p className="text-sm text-foreground">{r.body}</p>
        <p className="text-xs text-muted-foreground">
          {tRec("source")}{" "}
          {r.cited_url ? (
            <a
              href={r.cited_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {r.cited_headline}
            </a>
          ) : (
            r.cited_headline
          )}
        </p>
        <p className="text-xs text-muted-foreground">{formatDateTime(r.created_at, locale)}</p>
      </CardContent>
    </Card>
  );
}
