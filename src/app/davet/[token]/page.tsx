import Link from "next/link";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcceptInvite } from "@/components/groups/AcceptInvite";
import { getUser } from "@/lib/supabase/server";
import { withNextParam } from "@/lib/auth-redirect";

// (app) ve (auth) route group'larının DIŞINDA, /offline gibi: davet linkine
// tıklayan kişinin henüz oturumu olmayabilir ve (app) layout'u onu /giris'e
// atıp token'ı kaybettirirdi. Bu sayfa oturumsuz da render oluyor.
//
// Grubun ADI kasıtlı olarak gösterilmiyor: token'ı elinde tutan herkes bu
// sayfayı açabilir, geçersiz bir token da dahil — grup adı bir bilgi
// sızıntısı olurdu. Kabul edilene kadar sayfa hiçbir grup verisi okumuyor.
export default async function DavetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Giriş/kayıt sonrası bu sayfaya geri dönülüyor — token URL'de olduğu
  // için tek taşıyıcı bu.
  const next = `/davet/${encodeURIComponent(token)}`;
  const t = await getTranslations("groups");
  const tAuth = await getTranslations("auth");

  const {
    data: { user },
  } = await getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Users className="mb-2 size-10 text-muted-foreground" aria-hidden />
          <CardTitle className="text-lg">{t("acceptTitle")}</CardTitle>
          <CardDescription>{t("acceptIntro")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {user ? (
            <AcceptInvite token={token} />
          ) : (
            <>
              <p className="text-center text-sm text-muted-foreground">{t("acceptSignInHint")}</p>
              {/* buttonVariants ile stillenmiş düz Link — Base UI'ın Button'ı
                  linkleri `render`'dan geçirmeye karşı uyarıyor (buton
                  semantiğini linkin üstüne bindiriyor). Aynı gerekçe
                  src/components/dashboard/HeroActions.tsx'te yazılı. */}
              <Link
                href={withNextParam("/giris", next)}
                className={cn(buttonVariants({ size: "touch" }), "w-full justify-center")}
              >
                {tAuth("login.title")}
              </Link>
              <Link
                href={withNextParam("/kayit", next)}
                className={cn(
                  buttonVariants({ variant: "outline", size: "touch" }),
                  "w-full justify-center",
                )}
              >
                {tAuth("register.title")}
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
