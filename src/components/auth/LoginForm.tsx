"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signInWithGoogle, signInWithPassword } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInWithPassword, undefined);
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");

  return (
    <div className="mt-6 flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" type="email" name="email" required autoComplete="email" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            type="password"
            name="password"
            required
            autoComplete="current-password"
          />
        </div>
        {state?.error && (
          <p className="text-sm text-signal-caution-foreground">{state.error}</p>
        )}
        <Button type="submit" size="touch" disabled={pending} className="w-full">
          {pending ? t("login.submitPending") : t("login.submit")}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        {tCommon("or")}
        <Separator className="flex-1" />
      </div>

      <form action={signInWithGoogle}>
        <Button type="submit" variant="outline" size="touch" className="w-full">
          {t("google")}
        </Button>
      </form>
    </div>
  );
}
