import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPositionsWithPrices } from "@/lib/positions-data";

// One shared endpoint for every position's price + signal (docs/phase1-plan.md
// E.c — "tüm fiyatlar tek SWR key'de", not one request per card).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await getPositionsWithPrices(supabase, user.id);
  return NextResponse.json(result);
}
