"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createGroup } from "@/lib/actions/groups";

// Grup oluşturma — hem boş durumda (hiç grup yokken) hem listenin altında
// aynı bileşen. Ayrı bir "yeni grup" sayfası açmıyoruz: tek alanlı bir form
// için ayrı bir rota gereksiz bir adım olurdu.
export function GroupCreateForm() {
  const t = useTranslations("groups");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError(undefined);
    const formData = new FormData();
    formData.set("name", trimmed);
    const result = await createGroup({}, formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="group-name">{t("nameLabel")}</Label>
        <Input
          id="group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          maxLength={60}
        />
      </div>
      <Button
        size="touch"
        onClick={handleCreate}
        disabled={pending || !name.trim()}
        className="gap-2"
      >
        <Plus className="size-4" />
        {pending ? tCommon("saving") : t("create")}
      </Button>
      {error ? <p className="text-sm text-signal-caution-foreground">{error}</p> : null}
    </div>
  );
}
