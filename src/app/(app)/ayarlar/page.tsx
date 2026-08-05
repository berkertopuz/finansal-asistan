import { LogOut } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { DataFreshnessStatus } from "@/components/settings/DataFreshnessStatus";
import { CategoryManager } from "@/components/settings/CategoryManager";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { createClient, getUser } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

export default async function AyarlarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getUser();

  // Next renders layout.tsx and page.tsx concurrently, not strictly
  // parent-then-child, so the (app) layout's redirect() can't be trusted to
  // land before this page's own queries run. Re-check here (CLAUDE.md rule 3).
  if (!user) {
    redirect("/giris");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const t = await getTranslations("settings");
  const tCommon = await getTranslations("common");

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t("profileTitle")}</CardTitle>
          <LocaleSwitcher />
        </CardHeader>
        <CardContent>
          <ProfileForm email={user.email ?? ""} displayName={profile?.display_name ?? null} />
        </CardContent>
      </Card>

      <DataFreshnessStatus />

      <CategoryManager />

      <form action={signOut}>
        <Button
          type="submit"
          variant="outline"
          size="touch"
          className="w-full justify-center gap-2 text-signal-caution-foreground"
        >
          <LogOut className="size-4" />
          {tCommon("logout")}
        </Button>
      </form>
    </div>
  );
}
