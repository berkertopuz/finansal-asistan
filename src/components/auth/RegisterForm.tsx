"use client";

import { useActionState } from "react";
import { signInWithGoogle, signUpWithPassword } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function RegisterForm() {
  const [state, action, pending] = useActionState(signUpWithPassword, undefined);

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
          <Label htmlFor="email">E-posta</Label>
          <Input id="email" type="email" name="email" required autoComplete="email" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Şifre</Label>
          <Input
            id="password"
            type="password"
            name="password"
            required
            autoComplete="new-password"
          />
          <span className="text-xs text-muted-foreground">En az 8 karakter.</span>
        </div>
        {state?.error && (
          <p className="text-sm text-signal-caution-foreground">{state.error}</p>
        )}
        <Button type="submit" size="touch" disabled={pending} className="w-full">
          {pending ? "Kayıt oluşturuluyor…" : "Kayıt ol"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        veya
        <Separator className="flex-1" />
      </div>

      <form action={signInWithGoogle}>
        <Button type="submit" variant="outline" size="touch" className="w-full">
          Google ile devam et
        </Button>
      </form>
    </div>
  );
}
