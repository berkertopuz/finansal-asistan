import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDateTimeTR } from "@/lib/format";
import {
  ASSET_CLASS_LABELS,
  CONFIDENCE_HINTS,
  CONFIDENCE_LABELS,
  SIGNAL_LABELS,
  SIGNAL_TONE,
  type Recommendation,
} from "@/lib/recommendations";
import { cn } from "@/lib/utils";

export function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  const r = recommendation;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{ASSET_CLASS_LABELS[r.asset_class]}</Badge>
          <span className="text-sm font-semibold text-foreground">{r.symbol}</span>
        </div>
        <span
          className="text-xs text-muted-foreground"
          title={CONFIDENCE_HINTS[r.confidence]}
        >
          {CONFIDENCE_LABELS[r.confidence]}
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
            {SIGNAL_LABELS[r.signal]}
          </span>
        )}
        <p className="text-sm text-foreground">{r.body_tr}</p>
        <p className="text-xs text-muted-foreground">
          Kaynak:{" "}
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
        <p className="text-xs text-muted-foreground">{formatDateTimeTR(r.created_at)}</p>
      </CardContent>
    </Card>
  );
}
