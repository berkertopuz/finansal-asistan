import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStatementImports } from "@/lib/statement-imports-data";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await getStatementImports(supabase);
  return NextResponse.json(data);
}
