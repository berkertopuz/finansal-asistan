import { XMLParser } from "npm:fast-xml-parser@^5";

export type RssFeed = { source: string; url: string };

export type NewsFeedItem = {
  headline: string;
  source: string;
  url: string | null;
  publishedAt: string; // ISO
};

const parser = new XMLParser({ ignoreAttributes: false });

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const text = (value as Record<string, unknown>)["#text"];
    if (typeof text === "string") return text.trim();
  }
  return "";
}

export async function fetchRssFeed(feed: RssFeed): Promise<NewsFeedItem[]> {
  const res = await fetch(feed.url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`RSS fetch failed for ${feed.source}: ${res.status}`);

  const xml = await res.text();
  const doc = parser.parse(xml);
  const rawItems = doc?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : [rawItems].filter(Boolean);

  const out: NewsFeedItem[] = [];
  for (const item of items) {
    const headline = textOf(item?.title);
    const pubDateRaw = textOf(item?.pubDate);
    if (!headline || !pubDateRaw) continue;

    const publishedAt = new Date(pubDateRaw);
    if (Number.isNaN(publishedAt.getTime())) continue;

    out.push({
      headline,
      source: feed.source,
      url: textOf(item?.link) || null,
      publishedAt: publishedAt.toISOString(),
    });
  }
  return out;
}
