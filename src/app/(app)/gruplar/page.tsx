import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRight, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { GroupCreateForm } from "@/components/groups/GroupCreateForm";
import { createClient, getUser } from "@/lib/supabase/server";
import { getGroupEntries, getGroups } from "@/lib/groups-data";
import { formatCurrency } from "@/lib/format";
import { getLocale } from "next-intl/server";
import type { AppLocale } from "@/lib/locale";

// Grup listesi. Bir grup bir hane olabilir (eşinle ortak giderler), bir
// tatil olabilir ("Yurtdışı 2026"), bir proje olabilir (düğün, tadilat) —
// mekanizma aynı: adı olan bir kova + isteğe bağlı üyeler. Tek kişilik bir
// grup da tamamen geçerli; paylaşım zorunlu değil.
export default async function GruplarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getUser();

  // Next layout ve page'i eşzamanlı render ediyor (CLAUDE.md kural 3).
  if (!user) {
    redirect("/giris");
  }

  const groups = await getGroups(supabase);

  // Her grubun TÜM ZAMANLI toplamı — listede "bu grup toplamda ne tuttu"
  // sorusunun cevabı. Aylık kırılım grubun kendi sayfasında.
  const totals = await Promise.all(
    groups.map(async (group) => {
      const entries = await getGroupEntries(supabase, group.id);
      return entries.reduce((sum, e) => sum + e.amount, 0);
    }),
  );

  const t = await getTranslations("groups");
  const locale = (await getLocale()) as AppLocale;

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-lg font-semibold">{t("pageTitle")}</h1>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <p className="text-sm text-muted-foreground">{t("intro")}</p>
            <GroupCreateForm />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-1 pt-6">
              {groups.map((group, i) => (
                <Link
                  key={group.id}
                  href={`/gruplar/${group.id}`}
                  className="flex min-h-touch items-center gap-3 rounded-lg px-1 py-2 hover:bg-muted/50"
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                  >
                    <Users className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatCurrency(totals[i], locale)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <GroupCreateForm />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
