import { createClient, getUser } from "@/lib/supabase/server";
import { getCreditCards } from "@/lib/credit-cards-data";
import { CreditCardsManager } from "@/components/statements/CreditCardsManager";

export default async function KartlarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getUser();

  const [initialCards, profileRow] = await Promise.all([
    getCreditCards(supabase),
    supabase.from("profiles").select("statement_llm_consent_at").eq("id", user!.id).maybeSingle(),
  ]);

  const hasConsent = Boolean(
    (profileRow.data as { statement_llm_consent_at: string | null } | null)?.statement_llm_consent_at,
  );

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6 md:px-0">
      <CreditCardsManager initialCards={initialCards} initialHasConsent={hasConsent} />
    </div>
  );
}
