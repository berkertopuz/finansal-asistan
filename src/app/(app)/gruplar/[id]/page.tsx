import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { AddEntriesToGroup } from "@/components/groups/AddEntriesToGroup";
import { AddEntryToGroupButton } from "@/components/groups/AddEntryToGroupButton";
import { GroupManager } from "@/components/groups/GroupManager";
import { GroupSummary } from "@/components/groups/GroupSummary";
import { createClient, getUser } from "@/lib/supabase/server";
import {
  getGroup,
  getGroupEntries,
  getGroupMembers,
  getPendingInvites,
  getDuplicateReviews,
} from "@/lib/groups-data";
import { summarizeGroup } from "@/lib/group-summary";

// "YYYY-MM" — düz string olarak sıralanıyor, Date aritmetiği gerekmiyor.
function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  return monthKeyOf(new Date(year, month - 1 + delta, 1));
}

// Ayın ilk ve son günü. Son gün için "sonraki ayın 0. günü" — 28/29/30/31
// ayrımını takvimin kendisi çözüyor, elle tablo yok.
function monthBounds(monthKey: string): { start: string; end: string } {
  const [year, month] = monthKey.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
}

export default async function GrupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ donem?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getUser();

  if (!user) {
    redirect("/giris");
  }

  const { id } = await params;
  const group = await getGroup(supabase, id);
  // Üyesi olmadığın bir grubun id'sini elle yazarsan RLS zaten boş döner —
  // 404 gösteriyoruz, "yetkin yok" değil: grubun VAR OLDUĞU bilgisi de
  // sızdırılmıyor.
  if (!group) {
    notFound();
  }

  const [members, invites, reviewedDuplicates] = await Promise.all([
    getGroupMembers(supabase, id),
    getPendingInvites(supabase, id),
    getDuplicateReviews(supabase, id),
  ]);

  // Dönem: "all" ya da "YYYY-MM". Bir hane aylık ritimde okunur, bir tatil
  // toplamda — ayrı bir tarih aralığı kolonu eklemek yerine dönem seçicisi
  // ikisini de karşılıyor.
  const thisMonth = monthKeyOf(new Date());
  const requested = (await searchParams).donem;
  const period =
    requested === "all" || (requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested))
      ? requested
      : thisMonth;

  const entries =
    period === "all"
      ? await getGroupEntries(supabase, id)
      : await getGroupEntries(supabase, id, monthBounds(period));

  const summary = summarizeGroup(
    entries,
    members.map((m) => ({ user_id: m.user_id, display_name: m.display_name })),
  );

  const t = await getTranslations("groups");

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Link
          href="/gruplar"
          aria-label={t("backToList")}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{group.name}</h1>
        {/* Toplu ekleme grubun kendi ekranında: aday listesi zaten "senin
            gruplanmamış harcamaların" (RLS), yani burada kapsam doğal. */}
        {/* İki ayrı iş: YENİ bir gider girmek (grup kilitli açılıyor) ve
            ZATEN girilmiş harcamaları toplu eklemek. */}
        <AddEntryToGroupButton groupId={group.id} label={t("addEntry")} />
        <AddEntriesToGroup groupId={group.id} />
      </div>

      <GroupSummary
        summary={summary}
        entries={entries}
        showPayerBreakdown={group.show_payer_breakdown}
        reviewedDuplicates={reviewedDuplicates}
        isAdmin={members.some((m) => m.user_id === user.id && m.is_admin)}
        groupId={group.id}
        period={period}
        prevMonthKey={period === "all" ? thisMonth : shiftMonth(period, -1)}
        // Gelecek aya gitmek anlamsız: harcama geçmişe bakılan bir şey.
        nextMonthKey={period !== "all" && period < thisMonth ? shiftMonth(period, 1) : null}
        currentUserId={user.id}
      />

      <GroupManager
        group={group}
        members={members}
        invites={invites}
        currentUserId={user.id}
      />
    </div>
  );
}
