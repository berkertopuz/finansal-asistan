import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { safeNextPath, withNextParam } from "@/lib/auth-redirect";

export default async function KayitPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const t = await getTranslations("auth");
  const resolved = safeNextPath((await searchParams).next);
  const next = resolved === "/" ? undefined : resolved;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("register.title")}</CardTitle>
        <CardDescription>{t("register.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm next={next} />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("register.haveAccount")}{" "}
          <Link href={withNextParam("/giris", next)} className="font-medium text-primary">
            {t("register.loginLink")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
