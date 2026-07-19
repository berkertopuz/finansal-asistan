"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateProfile, type UpdateProfileState } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfileForm({
  email,
  displayName,
}: {
  email: string;
  displayName: string | null;
}) {
  const [state, formAction, pending] = useActionState<UpdateProfileState, FormData>(
    updateProfile,
    {},
  );
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t("emailLabel")}</Label>
        <Input id="email" type="email" value={email} disabled readOnly />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="display_name">{t("displayNameLabel")}</Label>
        <Input
          id="display_name"
          name="display_name"
          type="text"
          defaultValue={displayName ?? ""}
          placeholder={t("displayNamePlaceholder")}
          maxLength={80}
        />
      </div>

      {state?.error && <p className="text-sm text-signal-caution-foreground">{state.error}</p>}
      {state?.success && (
        <p className="text-sm text-signal-buy-foreground">{t("saved")}</p>
      )}

      <Button type="submit" size="touch" disabled={pending} className="w-full">
        {pending ? tCommon("saving") : tCommon("save")}
      </Button>
    </form>
  );
}
