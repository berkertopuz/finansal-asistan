import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fetchRssFeed, type RssFeed } from "../_shared/rss.ts";

// Türk RSS beyaz listesi (CLAUDE.md). "Reuters TR" o listede vardı ama
// Reuters artık genel erişime açık bir RSS feed'i sunmuyor (401/404 —
// birkaç yıl önce kapatmışlar); kullanıcı onayıyla NTV Ekonomi ile
// değiştirildi. Hepsi doğrulanmış, çalışan feed'ler.
const FEEDS: RssFeed[] = [
  { source: "AA", url: "https://www.aa.com.tr/tr/rss/default?cat=ekonomi" },
  { source: "Bloomberg HT", url: "https://www.bloomberght.com/rss" },
  { source: "Dünya", url: "https://www.dunya.com/rss" },
  { source: "NTV Ekonomi", url: "https://www.ntv.com.tr/ekonomi.rss" },
];

const TOPIC_KEYWORDS: Record<string, string[]> = {
  borsa: ["borsa", "bist", "hisse", "endeks"],
  kripto: ["kripto", "bitcoin", "ethereum"],
  dolar: ["dolar", "döviz", "kur"],
  faiz: ["faiz", "tcmb", "merkez bankası"],
  enflasyon: ["enflasyon", "tüfe", "üfe"],
};

// No source here provides structured topic tags — keyword match against the
// headline is a T2 heuristic, good enough to route into the LLM context
// filters (docs/phase1-plan.md D) without needing per-source taxonomy work.
function deriveTopics(headline: string): string[] {
  const lower = headline.toLocaleLowerCase("tr");
  const topics = new Set<string>(["ekonomi"]);
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) topics.add(topic);
  }
  return [...topics];
}

export default {
  fetch: withSupabase({ auth: ["secret"], cors: "disabled" }, async (_req, ctx) => {
    const results = await Promise.allSettled(FEEDS.map(fetchRssFeed));

    const fetched = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const failures = FEEDS.map((f, i) => (results[i].status === "rejected" ? f.source : null)).filter(
      (s): s is string => s !== null,
    );

    // Feeds resend their latest N items on every poll — dedupe against every
    // URL already stored, not a recent-published_at window. Some feeds
    // (confirmed live: bloomberght.com) serve stale items with a pubDate
    // days old, which a published_at-windowed check would never catch,
    // silently re-inserting the same article on every poll forever.
    const { data: existing } = await ctx.supabaseAdmin.from("news_items").select("url");
    const seen = new Set((existing ?? []).map((r: { url: string | null }) => r.url).filter(Boolean));

    const fresh = fetched.filter((item) => !item.url || !seen.has(item.url));

    if (fresh.length > 0) {
      await ctx.supabaseAdmin.from("news_items").insert(
        fresh.map((item) => ({
          headline: item.headline,
          source: item.source,
          url: item.url,
          published_at: item.publishedAt,
          topics: deriveTopics(item.headline),
        })),
      );
    }

    return Response.json({ inserted: fresh.length, failures });
  }),
};
