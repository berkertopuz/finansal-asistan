import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type SnapshotRow = { asset_class: string; fetched_at: string };

// Shared table, no user filter — any authenticated user can read
// market_snapshots (RLS: snapshots_read_authenticated).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("market_snapshots")
    .select("asset_class, fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as SnapshotRow[]) ?? [];

  // Rows are newest-first, so the first hit per class is its latest fetch.
  const latestByClass = new Map<string, string>();
  for (const row of rows) {
    if (!latestByClass.has(row.asset_class)) latestByClass.set(row.asset_class, row.fetched_at);
  }

  return NextResponse.json({
    latest_fetched_at: rows[0]?.fetched_at ?? null,
    by_asset_class: [...latestByClass.entries()].map(([asset_class, fetched_at]) => ({
      asset_class,
      fetched_at,
    })),
  });
}
