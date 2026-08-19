import { ENTRY_CATEGORIES, DEFAULT_CATEGORY, type EntryKind, type EntryRecurrence } from "@/lib/ledger";
import type { CreditCard } from "@/lib/credit-cards-data";
import { isSupportedCurrency } from "@/lib/providers/tcmb-fx";

// supabase/functions/_shared/voice/schema.ts ile elle senkron tutulan ikiz —
// iki runtime, ortak paket yok (statements tarafındaki aynı desen).
export type VoiceDraft = {
  kind: EntryKind;
  amount: number | null;
  /** ISO kodu; "TRY" ya da desteklenen bir döviz. */
  currency: string;
  category: string;
  description: string;
  occurred_at: string | null;
  recurrence: EntryRecurrence;
  installmentCount: number | null;
  // "" = nakit/banka (QuickEntryForm'daki aynı konvansiyon). Model kart ADI
  // döndürüyor, burada id'ye çevriliyor — arayüzde seçici zaten id ile
  // çalışıyor ve addEntry de id bekliyor.
  credit_card_id: string;
  // Kuru rota ekliyor (model değil) — bkz. src/app/api/voice/route.ts.
  // Bulunamazsa null: form kullanıcıdan kuru ister, uydurulmaz.
  fx_rate: number | null;
  fx_rate_date: string | null;
};

export type VoiceResult = {
  understood: boolean;
  items: VoiceDraft[];
  // Modelin duyduğu ham cümle — inceleme ekranında gösteriliyor ki kullanıcı
  // "ben 1700 demiştim" dediğinde sorunun duymada mı çıkarımda mı olduğu
  // tek bakışta görünsün.
  transcript: string;
};

const KINDS: readonly string[] = ["income", "expense", "subscription"];
const RECURRENCES: readonly string[] = ["none", "weekly", "monthly", "yearly"];

function parseItem(
  value: unknown,
  knownCategories: readonly string[],
  cards: readonly CreditCard[],
): VoiceDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const amount = typeof raw.amount === "number" && Number.isFinite(raw.amount) ? raw.amount : null;
  // Tutarsız bir kalem forma da listeye de girmemeli — modele "tutarını
  // duymadığın kalemi ekleme" deniyor (prompt kural 2), bu onun ağı.
  if (amount === null || amount <= 0) return null;

  const kind = (typeof raw.kind === "string" && KINDS.includes(raw.kind) ? raw.kind : "expense") as EntryKind;
  const recurrence = (
    typeof raw.recurrence === "string" && RECURRENCES.includes(raw.recurrence) ? raw.recurrence : "none"
  ) as EntryRecurrence;

  // Model şema enum'u sayesinde listenin dışına çıkamıyor, ama kullanıcı
  // arada bir kategoriyi silmiş olabilir — tanımadığımız her değer "diğer".
  const category =
    typeof raw.category === "string" &&
    (knownCategories.includes(raw.category) || (ENTRY_CATEGORIES as readonly string[]).includes(raw.category))
      ? raw.category
      : DEFAULT_CATEGORY;

  const occurredAt =
    typeof raw.occurred_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.occurred_at)
      ? raw.occurred_at
      : null;

  const installmentCount =
    typeof raw.installmentCount === "number" &&
    Number.isInteger(raw.installmentCount) &&
    raw.installmentCount >= 2 &&
    raw.installmentCount <= 36
      ? raw.installmentCount
      : null;

  // Kart adı -> id. Tanımadığımız her ad nakit/banka'ya düşer; gelirde kart
  // olamaz (DB CHECK entries_credit_card_id_kind_check).
  const cardName = typeof raw.creditCardName === "string" ? raw.creditCardName : null;
  const matchedCard =
    kind === "income" || !cardName
      ? undefined
      : cards.find((c) => c.name.toLocaleLowerCase("tr") === cardName.toLocaleLowerCase("tr"));

  return {
    kind,
    amount,
    // Tanımadığımız her kod TRY'ye düşer — form yanlış bir para birimiyle
    // açılıp uydurma bir kur çekmesin.
    currency:
      typeof raw.currency === "string" && isSupportedCurrency(raw.currency) ? raw.currency : "TRY",
    category,
    description: typeof raw.description === "string" ? raw.description.slice(0, 200) : "",
    occurred_at: occurredAt,
    recurrence,
    installmentCount,
    credit_card_id: matchedCard?.id ?? "",
    fx_rate: typeof raw.fx_rate === "number" && raw.fx_rate > 0 ? raw.fx_rate : null,
    fx_rate_date:
      typeof raw.fx_rate_date === "string" && /^d{4}-d{2}-d{2}$/.test(raw.fx_rate_date)
        ? raw.fx_rate_date
        : null,
  };
}

// Edge function zaten zod ile doğruluyor, ama bu değerler kullanıcının
// defterine yazılacak — bozuk bir alanın sessizce sızmasındansa burada
// güvenli bir varsayılana düşmek ya da o kalemi elemek daha iyi.
export function parseVoiceResult(
  value: unknown,
  knownCategories: readonly string[],
  cards: readonly CreditCard[] = [],
): VoiceResult {
  if (!value || typeof value !== "object") return { understood: false, items: [], transcript: "" };
  const raw = value as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? raw.items
        .map((item) => parseItem(item, knownCategories, cards))
        .filter((i): i is VoiceDraft => i !== null)
    : [];
  return {
    understood: raw.understood === true && items.length > 0,
    items,
    transcript: typeof raw.transcript === "string" ? raw.transcript : "",
  };
}
