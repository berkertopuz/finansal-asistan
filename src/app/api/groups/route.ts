import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroups } from "@/lib/groups-data";

// QuickEntryForm'un grup seçicisini çizebilmesi için — kategoriler ve
// kartlarla aynı SWR deseni. Yalnızca id/ad dönüyor; kaydederken seçilen
// id'nin geçerliliğini RLS doğruluyor (entries_insert_own'ın with check'i
// is_group_member çağırıyor), bu rota bir yetki kapısı değil.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const groups = await getGroups(supabase);
  return NextResponse.json(groups);
}
