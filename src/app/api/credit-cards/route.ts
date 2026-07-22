import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCreditCards } from "@/lib/credit-cards-data";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await getCreditCards(supabase);
  return NextResponse.json(data);
}
