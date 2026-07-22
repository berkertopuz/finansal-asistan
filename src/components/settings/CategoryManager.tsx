"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addCategory, deleteCategory } from "@/lib/actions/categories";
import type { Category } from "@/lib/categories-data";

const CATEGORIES_KEY = "/api/categories";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch categories");
    return res.json();
  });

// Kaydı formundaki (QuickEntryForm.tsx) chip listesiyle aynı SWR key'i
// paylaşır — biri mutate edince diğeri de otomatik tazelenir.
export function CategoryManager() {
  const { data } = useSWR<Category[]>(CATEGORIES_KEY, fetcher);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const t = useTranslations("ledger.categories");
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError(undefined);
    const result = await addCategory(trimmed);
    setPending(false);
    if (result.success && result.category) {
      mutate(CATEGORIES_KEY, (current: Category[] | undefined) => [...(current ?? []), result.category!], {
        revalidate: false,
      });
      setName("");
    } else {
      setError(result.error);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingCategory) return;
    const id = deletingCategory.id;
    setDeletingCategory(null);
    mutate(CATEGORIES_KEY, (current: Category[] | undefined) => current?.filter((c) => c.id !== id), false);
    await deleteCategory(id);
    mutate(CATEGORIES_KEY);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">
          {tSettings("categoriesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.map((cat) => (
              <span
                key={cat.id}
                className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground"
              >
                {cat.name}
                <button
                  type="button"
                  aria-label={tCommon("delete")}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeletingCategory(cat)}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            type="text"
            maxLength={50}
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Button type="button" variant="outline" disabled={pending} onClick={handleAdd}>
            {pending ? tCommon("saving") : tCommon("add")}
          </Button>
        </div>
        {error && <p className="text-sm text-signal-caution-foreground">{error}</p>}
      </CardContent>

      <Dialog open={deletingCategory !== null} onOpenChange={(open) => !open && setDeletingCategory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCommon("delete")}</DialogTitle>
            <DialogDescription>{t("deleteConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletingCategory(null)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmDelete}>
              {tCommon("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
