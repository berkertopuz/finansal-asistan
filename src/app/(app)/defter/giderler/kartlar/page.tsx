import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { createClient, getUser } from "@/lib/supabase/server";
import { getCreditCards } from "@/lib/credit-cards-data";
import { CreditCardsManager } from "@/components/statements/CreditCardsManager";

export default async function KartlarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getUser();

  // Next renders layout.tsx and page.tsx concurrently, not strictly
  // parent-then-child, so the (app) layout's redirect() can't be trusted to
  // land before this page's own queries run. Re-check here (CLAUDE.md rule 3).
  if (!user) {
    redirect("/giris");
  }

  const [initialCards, profileRow] = await Promise.all([
    getCreditCards(supabase),
    supabase.from("profiles").select("statement_llm_consent_at").eq("id", user.id).maybeSingle(),
  ]);

  const hasConsent = Boolean(
    (profileRow.data as { statement_llm_consent_at: string | null } | null)?.statement_llm_consent_at,
  );

  const t = await getTranslations("creditCards");

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6 md:px-0">
      {/* Bu sayfa Giderler özetindeki karttan açılıyor; alt gezinme çubuğu
          hangi sekmede olduğunu söylüyor ama bir üst seviyeye dönüş yolu
          yoktu. */}
      <Link
        href="/defter/giderler"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("backToLedger")}
      </Link>
      <CreditCardsManager initialCards={initialCards} initialHasConsent={hasConsent} />
    </div>
  );
}
