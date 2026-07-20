import { WifiOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Not inside (app) or (auth) — this route is precached (see
// additionalPrecacheEntries in src/app/serwist/[path]/route.ts) and served
// by sw.ts's navigation fallback when a page request fails with no network,
// so it must render standalone with no auth/session dependency.
export default async function OfflinePage() {
  const t = await getTranslations("offline");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <WifiOff className="mb-2 size-10 text-muted-foreground" aria-hidden />
          <CardTitle className="text-lg">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button render={<a href="/" />} size="touch">
            {t("retry")}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
