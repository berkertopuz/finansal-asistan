"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { acceptGroupInvite } from "@/lib/actions/groups";

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations("groups");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  async function handleAccept() {
    setPending(true);
    setError(undefined);
    const result = await acceptGroupInvite(token);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone(true);
    router.push("/ayarlar");
  }

  if (done) {
    return <p className="text-center text-sm">{t("accepted")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Button size="touch" className="w-full justify-center" onClick={handleAccept} disabled={pending}>
        {pending ? tCommon("saving") : t("accept")}
      </Button>
      {error ? (
        <p className="text-center text-sm text-signal-caution-foreground">{error}</p>
      ) : null}
    </div>
  );
}
