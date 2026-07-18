import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
// deno-lint-ignore no-explicit-any
type AdminClient = any;

const LOOKBACK_HOURS = 24;
const DEDUP_WINDOW_HOURS = 6;

type EventCandidate = { event_type: string; magnitude: number };

// Latest snapshot vs. the closest one ≥24h old — pure comparison, no
// external calls (docs/phase1-plan.md C, detect-events is "none" on
// external calls by design).
async function detectPriceMove(
  supabaseAdmin: AdminClient,
  assetClass: string,
  symbol: string,
  eventType: string,
  thresholdPct: number,
): Promise<EventCandidate | null> {
  const { data: latestRows } = await supabaseAdmin
    .from("market_snapshots")
    .select("price, fetched_at")
    .eq("asset_class", assetClass)
    .eq("symbol", symbol)
    .order("fetched_at", { ascending: false })
    .limit(1);
  const latest = latestRows?.[0];
  if (!latest) return null;

  const lookbackCutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data: baselineRows } = await supabaseAdmin
    .from("market_snapshots")
    .select("price, fetched_at")
    .eq("asset_class", assetClass)
    .eq("symbol", symbol)
    .lte("fetched_at", lookbackCutoff)
    .order("fetched_at", { ascending: false })
    .limit(1);
  const baseline = baselineRows?.[0];
  if (!baseline || Number(baseline.price) === 0) return null;

  const changePct = ((Number(latest.price) - Number(baseline.price)) / Number(baseline.price)) * 100;
  if (Math.abs(changePct) < thresholdPct) return null;

  return { event_type: eventType, magnitude: Number(changePct.toFixed(2)) };
}

// T2: keyword match against headlines already tagged with the relevant
// topic (poll-news) — good enough to catch "faiz kararı açıklandı" style
// wire copy without a dedicated macro-calendar feed.
const NEWS_EVENT_RULES: { eventType: string; topic: string; keywords: string[] }[] = [
  { eventType: "rate_decision", topic: "faiz", keywords: ["faiz kararı", "politika faizi", "tcmb faiz"] },
  { eventType: "cpi_print", topic: "enflasyon", keywords: ["tüfe", "enflasyon açıkland", "yıllık enflasyon"] },
];

async function detectNewsEvents(supabaseAdmin: AdminClient): Promise<EventCandidate[]> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: news } = await supabaseAdmin
    .from("news_items")
    .select("headline, topics")
    .gte("published_at", since);

  const found: EventCandidate[] = [];
  for (const rule of NEWS_EVENT_RULES) {
    const match = ((news as { headline: string; topics: string[] }[]) ?? []).find(
      (n) =>
        n.topics?.includes(rule.topic) &&
        rule.keywords.some((k) => n.headline.toLocaleLowerCase("tr").includes(k)),
    );
    if (match) found.push({ event_type: rule.eventType, magnitude: 0 });
  }
  return found;
}

// Prevents re-logging the same event on every 15-30 min poll while the
// price stays past threshold for the rest of the day — not a dedup on the
// *condition*, a dedup on *having already told the user*.
async function alreadyLoggedRecently(supabaseAdmin: AdminClient, eventType: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("market_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", eventType)
    .gte("detected_at", cutoff);
  return (count ?? 0) > 0;
}

// Cron/trigger-only (fires from the market_snapshots statement-level
// trigger set up in section 1, plus its own cadence). Inserting a row here
// fires generate-signals for that event via the market_events row trigger.
export default {
  fetch: withSupabase({ auth: ["secret"], cors: "disabled" }, async (_req, ctx) => {
    const candidates: EventCandidate[] = [];

    const bist = await detectPriceMove(ctx.supabaseAdmin, "bist", "XU100", "bist100_move", 2);
    if (bist) candidates.push(bist);

    const fx = await detectPriceMove(ctx.supabaseAdmin, "fx", "USDTRY", "usdtry_move", 1.5);
    if (fx) candidates.push(fx);

    candidates.push(...(await detectNewsEvents(ctx.supabaseAdmin)));

    const toInsert: EventCandidate[] = [];
    for (const candidate of candidates) {
      if (!(await alreadyLoggedRecently(ctx.supabaseAdmin, candidate.event_type))) {
        toInsert.push(candidate);
      }
    }

    if (toInsert.length > 0) {
      await ctx.supabaseAdmin
        .from("market_events")
        .insert(toInsert.map((c) => ({ event_type: c.event_type, magnitude: c.magnitude })));
    }

    return Response.json({ events: toInsert });
  }),
};
