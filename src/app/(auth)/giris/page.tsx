import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNextPath, withNextParam } from "@/lib/auth-redirect";

// searchParams okumak için async server component oldu (senkron
// useTranslations async componentlerde çalışmıyor, offline sayfasındaki
// gerekçenin aynısı). `next` davet akışından geliyor: /davet/<token>
// oturumsuz açılınca kullanıcı buraya "geri dön" hedefiyle yönlendiriliyor.
export default async function GirisPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const t = await getTranslations("auth");
  // Varsayılan hedefte ("/") gizli alanı hiç basmamak için undefined'a
  // çeviriyoruz — davranış aynı, ama işaretsiz bir URL'de boş markup kalmıyor.
  const resolved = safeNextPath((await searchParams).next);
  const next = resolved === "/" ? undefined : resolved;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("login.title")}</CardTitle>
        <CardDescription>{t("login.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next} />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("login.noAccount")}{" "}
          {/* Hedef kayıt sayfasına da taşınıyor — davetten gelip hesabı
              olmayan kişi buradan kayda geçtiğinde token kaybolmasın. */}
          <Link href={withNextParam("/kayit", next)} className="font-medium text-primary">
            {t("login.registerLink")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
