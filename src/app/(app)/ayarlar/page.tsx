import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { DataFreshnessStatus } from "@/components/settings/DataFreshnessStatus";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

export default async function AyarlarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user!.id)
    .maybeSingle();

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profil</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm email={user!.email ?? ""} displayName={profile?.display_name ?? null} />
        </CardContent>
      </Card>

      <DataFreshnessStatus />

      <form action={signOut}>
        <Button
          type="submit"
          variant="outline"
          size="touch"
          className="w-full justify-center gap-2 text-signal-caution-foreground"
        >
          <LogOut className="size-4" />
          Çıkış yap
        </Button>
      </form>
    </div>
  );
}
