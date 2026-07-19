import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecommendations } from "@/lib/recommendations-data";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await getRecommendations(supabase);
  return NextResponse.json(data);
}
