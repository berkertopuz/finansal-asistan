"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signInWithGoogle, signUpWithPassword } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function RegisterForm() {
  const [state, action, pending] = useActionState(signUpWithPassword, undefined);
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");

  if (state?.success) {
    return (
      <div className="mt-6 rounded-lg bg-signal-buy-bg p-4 text-sm text-signal-buy-foreground">
        {state.success}
      </div>
    );
  }

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
            autoComplete="new-password"
          />
          <span className="text-xs text-muted-foreground">{t("passwordHint")}</span>
        </div>
        {state?.error && (
          <p className="text-sm text-signal-caution-foreground">{state.error}</p>
        )}
        <Button type="submit" size="touch" disabled={pending} className="w-full">
          {pending ? t("register.submitPending") : t("register.submit")}
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
