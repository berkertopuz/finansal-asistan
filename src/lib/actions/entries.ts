"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CATEGORY } from "@/lib/ledger";
import { buildInstallmentRows } from "@/lib/installments";
import { isSupportedCurrency } from "@/lib/providers/tcmb-fx";

export type AddEntryState = { error?: string; success?: boolean };

// Local date, not toISOString().slice(0,10) — that reads UTC parts, which
// drifts a day off around midnight depending on the server's timezone.
function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Bulunduğumuz ayın 1'i. Bir şablonun takvimi değiştiğinde bayat dönem
// satırlarını temizlemek için kullanılıyor ve tarihi KASITLI olarak burası:
// materializeDueOccurrences (src/lib/recurrence-materialize.ts) da üretime
// tam olarak ayın 1'inden başlıyor ("The lower bound is always the *start of
// the current* month, never the template's own occurred_at"). Temizleme
// penceresi üretme penceresiyle aynı olmak zorunda — aksi halde ikisinin
// arasında kalan günlerde, artık geçerli olmayan bir desenden üretilmiş
// satırlar hayatta kalıyor.
function monthStartDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// GRUP. Artık bir kullanıcı birden çok grupta olabildiği için (bir hane +
// iki tatil) form HANGİ grup olduğunu gönderiyor — "evet/hayır" yetmiyor.
//
// İstemciden gelen bir id'ye GÜVENİLMİYOR, ama kontrol burada DEĞİL: asıl
// kapı RLS. entries_insert_own/entries_update_own'ın with check'i
// "group_id is null or is_group_member(group_id)" diyor
// (20260825140000 + 20260826140000). O policy eklenmeden önce bu gerçekten
// açıktı: oturumu olan biri PostgREST'e doğrudan POST atıp yabancı bir
// grubun görünümüne satır yazabiliyordu (sızma testinde 201 alındı). Yani
// bu fonksiyonun işi güvenlik değil, biçim doğrulama ve kind kuralı.
//
// Yalnızca harcama gruplanabilir: gelir/yatırım grup toplamının anlamını
// bozar ve DB CHECK'i (entries_group_kind_check) zaten reddeder — burada
// erken dönmek o hatayı kullanıcıya "kaydedilemedi" olarak yansıtmaktan
// daha iyi.
function resolveGroupId(rawGroupId: FormDataEntryValue | null, kind: string): string | null {
  if (kind !== "expense" && kind !== "subscription") return null;
  if (typeof rawGroupId !== "string" || !rawGroupId) return null;
  return z.string().uuid().safeParse(rawGroupId).success ? rawGroupId : null;
}

async function buildEntrySchema() {
  const t = await getTranslations("ledger.form.errors");
  return z
    .object({
      kind: z.enum(["income", "expense", "subscription"]),
      // Absurd-magnitude guard (docs/phase1-plan.md E.d) — the DB CHECK (amount > 0)
      // is the real backstop; this just gives a friendlier error before it gets there.
      amount: z.coerce
        .number()
        .positive({ message: t("amountPositive") })
        .max(10_000_000, { message: t("amountTooHigh") }),
      category: z.string().trim().min(1).max(50).default(DEFAULT_CATEGORY),
      // Only asked for one-off entries (the form hides this field entirely
      // for a recurring one — see next_due_date below) — required there via
      // superRefine, since it's the only date the user can set at all.
      occurred_at: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined)),
      description: z
        .string()
        .trim()
        .max(200, { message: t("descriptionTooLong") })
        .optional()
        .transform((val) => (val ? val : undefined)),
      recurrence: z.enum(["none", "weekly", "monthly", "yearly"]).default("none"),
      // The one date a recurring entry has — both the anchor every future
      // occurrence projects from (src/lib/recurrence.ts, src/lib/cashflow.ts)
      // and what's shown as "the" date for that row (src/lib/ledger.ts's
      // entryDisplayDate). Required via superRefine when recurring, since a
      // recurring entry with no anchor can't be projected forward at all.
      next_due_date: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined)),
      // Taksit sayısı — isInstallment kendisi zod'un dışında, ham FormData'dan
      // okunuyor (updateEntry'deki applyToAllOccurrences ile aynı desen),
      // çünkü z.coerce.boolean() "false" string'ini de truthy sayar. Bu alan
      // sadece isInstallment true iken addEntry içinde elle doğrulanır.
      installmentCount: z.coerce.number().int().min(2).max(36).optional(),
      // Ödeme yöntemi — boş değer "Nakit/Banka" demek (nakit çıkışı hemen
      // olur, bugünkü davranış); bir kart id'si ise o karta borç yazılır
      // (src/lib/cashflow.ts bunu nakitten hemen düşmez, bkz. isCardDebt).
      // "income" için formda hiç gösterilmiyor, boş geçilir.
      credit_card_id: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined)),
      // DÖVİZ — dördü birlikte gelir ya da hiçbiri gelmez (DB'de de CHECK var).
      // `amount` yine TL: form, orijinal tutar × kurdan hesaplayıp gizli
      // input'la gönderiyor. Kur burada YENİDEN ÇEKİLMİYOR — kullanıcı
      // bankasının kestiği gerçek kuru elle yazmış olabilir ve onu ezmek
      // kaydı yanlış yapardı.
      original_amount: z.coerce.number().positive().max(10_000_000).optional(),
      original_currency: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined))
        .refine((v) => v === undefined || isSupportedCurrency(v), { message: t("genericInvalid") }),
      fx_rate: z.coerce.number().positive().max(1_000_000).optional(),
      fx_rate_date: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined)),
      // GRUP alanı burada DEĞİL: ham FormData'dan okunuyor (resolveGroupId),
      // çünkü boş string ile "grup yok" arasındaki fark zod'un optional
      // dönüşümlerinde kolayca kayboluyor ve üyelik doğrulaması zaten RLS'te.
    })
    .superRefine((data, ctx) => {
      const fxFields = [
        data.original_amount,
        data.original_currency,
        data.fx_rate,
        data.fx_rate_date,
      ];
      const filled = fxFields.filter((v) => v !== undefined).length;
      if (filled !== 0 && filled !== 4) {
        ctx.addIssue({ code: "custom", path: ["original_currency"], message: t("fxIncomplete") });
      }
      if (data.recurrence === "none" && !data.occurred_at) {
        ctx.addIssue({ code: "custom", path: ["occurred_at"], message: t("dateRequired") });
      }
      if (data.recurrence !== "none" && !data.next_due_date) {
        ctx.addIssue({ code: "custom", path: ["next_due_date"], message: t("dateRequired") });
      }
      // Abonelikler, bu alanı satırın başlığı olarak gösteriyor
      // (EntryTable titleField="description") — boş bir "abonelik" satırı
      // orada isimsiz görünürdü. Client zaten <input required> ile bunu
      // engelliyor, bu sunucu tarafındaki backstop.
      // TEK SEFERLİK ABONELİK OLAMAZ. Bir "abonelik" ya tekrarlayan bir
      // kuraldır (recurrence <> 'none'), ya da o kuralın ürettiği bir dönem
      // satırıdır (template_id dolu) — ikisi de değilse ortada hiçbir kurala
      // ait olmayan, hiçbir listeye düşmeyen bir satır kalıyor.
      //
      // Gerçek veride tam bu oldu: kullanıcının veritabanında kind='subscription'
      // + recurrence='none' + template_id=null üç satır vardı (ANTHROPIC,
      // GOOGLE One, MCAFEE) ve Abonelikler sayfasının İKİ listesinin de
      // arasından düşüyorlardı (üstteki templatesOnly, alttaki o zaman
      // kind='expense' arıyordu). Kullanıcı onları hiç göremediği hâlde Analiz
      // sayfasının abonelik toplamında görüyordu.
      //
      // Bugünkü form bu durumu zaten üretemiyor (QuickEntryForm kind'ı
      // category+recurrence'tan TÜRETİYOR: "abonelik + tek seferlik" seçilirse
      // kind 'expense' olur) ve ekstre içe aktarma her zaman kind='expense'
      // yazıyor — yani o üç satır eski veri. Bu kontrol formu değil SUNUCU
      // SINIRINI koruyor: bir server action doğrudan çağrılabilir, ve bu
      // sınıfın bir daha oluşmayacağını form katmanına güvenerek varsaymak
      // aynı hatanın ikinci kez birikmesine kapı bırakırdı.
      //
      // template_id burada okunamıyor (bu şema formdan gelen alanları
      // doğruluyor, mevcut satırı değil) — dönem satırlarının düzenlenmesi
      // updateEntry içinde ayrıca ele alınıyor: form o satırlarda tekrar
      // seçicisini canlı göstermiyor (bkz. QuickEntryForm'daki template_id notu).
      if (data.kind === "subscription" && data.recurrence === "none") {
        ctx.addIssue({ code: "custom", path: ["recurrence"], message: t("subscriptionMustRecur") });
      }
      if (data.kind === "subscription" && !data.description) {
        ctx.addIssue({ code: "custom", path: ["description"], message: t("descriptionRequired") });
      }
    });
}

export async function addEntry(
  _prevState: AddEntryState,
  formData: FormData,
): Promise<AddEntryState> {
  const t = await getTranslations("ledger.form.errors");
  const schema = await buildEntrySchema();
  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    amount: formData.get("amount"),
    category: formData.get("category") || DEFAULT_CATEGORY,
    occurred_at: formData.get("occurred_at") || undefined,
    description: formData.get("description") || undefined,
    recurrence: formData.get("recurrence") || "none",
    next_due_date: formData.get("next_due_date") || undefined,
    installmentCount: formData.get("installmentCount") || undefined,
    credit_card_id: formData.get("credit_card_id") || undefined,
    original_amount: formData.get("original_amount") || undefined,
    original_currency: formData.get("original_currency") || undefined,
    fx_rate: formData.get("fx_rate") || undefined,
    fx_rate_date: formData.get("fx_rate_date") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const isRecurring = parsed.data.recurrence !== "none";
  const isInstallment = formData.get("isInstallment") === "true";
  const groupId = resolveGroupId(formData.get("group_id"), parsed.data.kind);
  // income can never carry a card (DB CHECK) — the form never shows the
  // selector for it, this is just the same server-side backstop pattern
  // already used elsewhere in this file.
  const creditCardId = parsed.data.kind === "income" ? null : (parsed.data.credit_card_id ?? null);

  // Taksit: bir şablon değil, toplamı ve sayısı baştan belli sabit bir seri —
  // tüm satırlar kayıt anında toplu insert edilir (src/lib/installments.ts),
  // recurrence-materialize.ts'in ay-ay üretimiyle karıştırılmamalı. QuickEntryForm
  // bu checkbox'ı sadece kind=expense && recurrence=none iken gösteriyor, ama
  // form dışından (elle FormData) gelebilecek tutarsız bir kombinasyona karşı
  // burada da doğrulanıyor.
  if (isInstallment) {
    if (parsed.data.kind !== "expense" || isRecurring || !parsed.data.installmentCount) {
      return { error: t("genericInvalid") };
    }

    const rows = buildInstallmentRows(
      parsed.data.amount,
      parsed.data.installmentCount,
      parsed.data.occurred_at!,
    );
    const installmentGroupId = crypto.randomUUID();

    const { error: installmentError } = await supabase.from("entries").insert(
      rows.map((row) => ({
        user_id: user.id,
        kind: "expense" as const,
        amount: row.amount,
        category: parsed.data.category,
        occurred_at: row.occurred_at,
        description: parsed.data.description ?? null,
        recurrence: "none" as const,
        installment_group_id: installmentGroupId,
        installment_index: row.index,
        installment_count: row.count,
        credit_card_id: creditCardId,
        // Taksitli bir ortak alışverişte serinin HER satırı ortak — hane
        // toplamı o ayın taksitini görmek zorunda, sadece ilkini değil.
        group_id: groupId,
      })),
    );

    if (installmentError) {
      return { error: t("saveFailed") };
    }

    revalidatePath("/defter");
    revalidatePath("/");
    return { success: true };
  }

  const { error } = await supabase.from("entries").insert({
    user_id: user.id,
    kind: parsed.data.kind,
    amount: parsed.data.amount,
    // Döviz: `amount` TL kalıyor, bunlar sadece "aslında ne harcandı" kaydı.
    original_amount: parsed.data.original_amount ?? null,
    original_currency: parsed.data.original_currency ?? null,
    fx_rate: parsed.data.fx_rate ?? null,
    fx_rate_date: parsed.data.fx_rate_date ?? null,
    category: parsed.data.category,
    // A brand-new recurring row has no user-chosen occurred_at (the field
    // isn't shown) — "today" just means "added to the ledger today", which
    // is true and doesn't affect anything: currentBalance() sums every row
    // once regardless of its date, and next_due_date alone drives every
    // future projection.
    occurred_at: isRecurring ? todayDateString() : parsed.data.occurred_at!,
    description: parsed.data.description ?? null,
    recurrence: parsed.data.recurrence,
    next_due_date: isRecurring ? parsed.data.next_due_date! : null,
    credit_card_id: creditCardId,
    group_id: groupId,
  });

  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true };
}

export async function updateEntry(
  _prevState: AddEntryState,
  formData: FormData,
): Promise<AddEntryState> {
  const t = await getTranslations("ledger.form.errors");
  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    return { error: t("notFound") };
  }

  const schema = await buildEntrySchema();
  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    amount: formData.get("amount"),
    category: formData.get("category") || DEFAULT_CATEGORY,
    occurred_at: formData.get("occurred_at") || undefined,
    description: formData.get("description") || undefined,
    recurrence: formData.get("recurrence") || "none",
    next_due_date: formData.get("next_due_date") || undefined,
    credit_card_id: formData.get("credit_card_id") || undefined,
    original_amount: formData.get("original_amount") || undefined,
    original_currency: formData.get("original_currency") || undefined,
    fx_rate: formData.get("fx_rate") || undefined,
    fx_rate_date: formData.get("fx_rate_date") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const isRecurring = parsed.data.recurrence !== "none";
  // Only meaningful when editing a recurring rule (template) — the edit
  // sheet asks the user to choose this via a confirmation dialog rather
  // than silently picking one (src/components/ledger/QuickEntryForm.tsx).
  const applyToAllOccurrences = formData.get("applyToAllOccurrences") === "true";
  // Same backstop as addEntry — income can never carry a card (DB CHECK).
  const creditCardId = parsed.data.kind === "income" ? null : (parsed.data.credit_card_id ?? null);

  // Read before the update below, which nulls this row's own template_id
  // once it turns recurring — need the *previous* value to know whether
  // it's currently a materialized occurrence of some other template.
  // next_due_date/recurrence are read too, to detect a schedule change on
  // a template edit (see the cleanup after the update below). occurred_at
  // is read to detect a materialized row's own date moving (see the
  // skip_dates backfill after the update below).
  const { data: rowBeforeUpdate } = await supabase
    .from("entries")
    .select("template_id, next_due_date, recurrence, occurred_at")
    .eq("id", id)
    .maybeSingle();
  const groupId = resolveGroupId(formData.get("group_id"), parsed.data.kind);
  const previousTemplateId = rowBeforeUpdate?.template_id ?? null;
  const previousOccurredAt = rowBeforeUpdate?.occurred_at ?? null;
  const scheduleChanged =
    isRecurring &&
    rowBeforeUpdate !== null &&
    (rowBeforeUpdate.next_due_date !== (parsed.data.next_due_date ?? null) ||
      rowBeforeUpdate.recurrence !== parsed.data.recurrence);

  // No explicit .eq("user_id", ...) needed beyond RLS (entries_update_own)
  // scoping the update to the caller's own rows — matching this codebase's
  // established pattern (see deleteEntry below).
  const { error } = await supabase
    .from("entries")
    .update({
      kind: parsed.data.kind,
      amount: parsed.data.amount,
      category: parsed.data.category,
      // Recurring entries don't show the occurred_at field, so there's
      // nothing submitted to update it with — omitting the key here (rather
      // than defaulting to today, like a brand-new row) leaves whatever was
      // already stored untouched instead of quietly overwriting it on every
      // edit.
      ...(isRecurring ? {} : { occurred_at: parsed.data.occurred_at! }),
      description: parsed.data.description ?? null,
      recurrence: parsed.data.recurrence,
      next_due_date: isRecurring ? parsed.data.next_due_date! : null,
      credit_card_id: creditCardId,
      // Ortak işareti düzenlemede de YAZILIYOR, atlanmıyor: kullanıcı
      // anahtarı kapattığında (ya da satırı gelire çevirdiğinde)
      // resolveGroupId null döner ve işaret gerçekten kalkar.
      // Anahtarı "sadece doluysa yaz" yapmak, bir kez ortak işaretlenen
      // satırı geri alınamaz hale getirirdi.
      group_id: groupId,
      // Döviz alanları düzenlemede de yazılıyor: kullanıcı para birimini
      // TL'ye çevirdiyse ÜÇÜ DE null olmalı, yoksa DB CHECK'i (dördü birlikte)
      // ihlal olur ve kayıt reddedilir.
      original_amount: parsed.data.original_amount ?? null,
      original_currency: parsed.data.original_currency ?? null,
      fx_rate: parsed.data.fx_rate ?? null,
      fx_rate_date: parsed.data.fx_rate_date ?? null,
      // A row turning recurring becomes a template in its own right, which
      // can't also be a generated occurrence of another template — the DB
      // enforces this (entries_template_id_only_when_concrete: recurrence
      // <> 'none' requires template_id null). Without this, converting e.g.
      // a materialized "abonelik"-category charge (template_id already set
      // from whatever recurring rule produced it) into a new subscription
      // rule fails outright.
      ...(isRecurring ? { template_id: null } : {}),
      // Same idea for entries_installment_requires_expense_and_concrete:
      // a taksit row must stay kind='expense' and recurrence='none' as long
      // as it carries installment_group_id — converting it to another kind
      // or into a recurring rule has to detach it from that series first,
      // or the same constraint rejects the update.
      ...(parsed.data.kind !== "expense" || isRecurring
        ? { installment_group_id: null, installment_index: null, installment_count: null }
        : {}),
    })
    .eq("id", id);

  if (error) {
    return { error: t("saveFailed") };
  }

  // This row was a materialized occurrence of some other template and just
  // turned into a recurring rule of its own (the "kart harcamalarından"
  // charge → real subscription conversion, src/components/ledger/QuickEntryForm.tsx) —
  // the original template must stop generating too, or the same real-world
  // charge stays tracked twice forever (once via the old rule, once via
  // this new one). Deleted outright rather than left running: past rows it
  // already produced keep their own data regardless (ON DELETE SET NULL on
  // template_id), only future generation stops — the same effect as the
  // delete dialog's "Sadece gelecekte durdur" option.
  if (isRecurring && previousTemplateId) {
    const { error: stopError } = await supabase
      .from("entries")
      .delete()
      .eq("id", previousTemplateId);
    if (stopError) {
      console.error("updateEntry: failed to stop original template after conversion", stopError);
    }
  }

  // Bug: editing a single materialized occurrence's own date (the
  // QuickEntryForm "Tek seferlik" note path — template_id stays set,
  // recurrence stays 'none', see isMaterializedOccurrence in
  // QuickEntryForm.tsx) used to just move this row's occurred_at and leave
  // it there. That freed up the (template_id, old occurred_at) slot without
  // telling the template — the next materializeDueOccurrences pass
  // (src/lib/recurrence-materialize.ts) saw that slot empty again and
  // regenerated a fresh row on the original date, so the rule ended up with
  // two rows: this one on its new (edited) date, plus a freshly regenerated
  // one on the old date. Recording the old date on the template's
  // skip_dates — the same mechanism deleteEntry already uses for a deleted
  // single occurrence — stops that regeneration.
  if (!isRecurring && previousTemplateId && previousOccurredAt && parsed.data.occurred_at !== previousOccurredAt) {
    const { data: template } = await supabase
      .from("entries")
      .select("skip_dates")
      .eq("id", previousTemplateId)
      .maybeSingle();
    const skipDates = (template as { skip_dates: string[] } | null)?.skip_dates ?? [];
    if (!skipDates.includes(previousOccurredAt)) {
      const { error: skipError } = await supabase
        .from("entries")
        .update({ skip_dates: [...skipDates, previousOccurredAt] })
        .eq("id", previousTemplateId);
      if (skipError) {
        console.error("updateEntry: failed to record old date as skipped after moving occurrence", skipError);
      }
    }
  }

  // Bug: editing a template's own schedule (next_due_date and/or recurrence)
  // used to leave every already-materialized future row exactly where it
  // was — materializeDueOccurrences (src/lib/recurrence-materialize.ts)
  // then computed the NEW occurrence dates from the changed anchor and
  // inserted those too (its (template_id, occurred_at) unique constraint
  // only blocks re-inserting the *same* date, not the old ones), so the
  // rule ended up with two full sets of future rows — the stale old-pattern
  // ones and the fresh new-pattern ones. A schedule change is inherently
  // forward-looking (past rows already happened on their real dates, that
  // shouldn't get rewritten), so this always deletes future rows regardless
  // of applyToAllOccurrences — materializeDueOccurrences regenerates them
  // on the next fetch, already carrying this request's new field values too.
  //
  // PENCERE AYIN 1'İ, "bugün" DEĞİL. Eskiden `>= todayDateString()` idi ve
  // bu, bulunduğumuz ayın ERKEN günlerine düşmüş bayat satırları hayatta
  // bırakıyordu. Gerçek veride yaşandı: ekstreden gelen tek seferlik bir
  // Apple aboneliği (₺537,59, 4 Mayıs tarihli) önce aylığa çevrildi ->
  // materialization 4 Ağustos için bir dönem satırı üretti, aylık toplam
  // doğru şekilde ₺537,59 oldu. Sonra aynı kural YILLIĞA çevrildi: yeni desen
  // Ağustos'ta hiçbir şey üretmiyor (yıldönümü mayısta), ama 4 Ağustos
  // satırı bugünden (19 Ağustos) önce olduğu için silinmedi ve v_monthly_surplus
  // yalnızca bu aya tarihli somut satırları topladığı için aylık toplam HİÇ
  // DEĞİŞMEDİ — kullanıcı bildirdi.
  //
  // Doğru pencere materialization'ın ürettiği pencerenin aynısı olmak zorunda:
  // o da ayın 1'inden başlıyor (bkz. recurrence-materialize.ts'teki rangeStart
  // notu). Aynı pencereyi silip aynı pencereyi yeniden üretmek, iki tarafın
  // asla ayrışamamasını garanti ediyor. Geçmiş AYLAR dokunulmadan kalıyor —
  // onlar gerçekten olmuş dönemler.
  if (scheduleChanged) {
    const { error: rescheduleError } = await supabase
      .from("entries")
      .delete()
      .eq("template_id", id)
      .gte("occurred_at", monthStartDateString());
    if (rescheduleError) {
      console.error("updateEntry: failed to clear stale occurrences after schedule change", rescheduleError);
    }
  }

  // Propagate to rows this template already generated (each keeps its own
  // occurred_at — only what the user actually edited here changes). Not
  // part of the same request's error path: the template itself already
  // saved successfully, so a failure here shouldn't read to the user as
  // "the edit failed".
  //
  // materializeDueOccurrences pre-generates FUTURE_HORIZON_YEARS of
  // occurrences as real rows (src/lib/recurrence-materialize.ts), so
  // "gelecek kayıtlar" (future records) already exist as concrete rows the
  // moment the template does — "Sadece gelecek kayıtlar" has to actively
  // update the not-yet-occurred ones (occurred_at >= today) rather than
  // leaving them stuck on the old value, while "Tüm kayıtlar (geçmiş
  // dahil)" still reaches every row regardless of date.
  if (isRecurring) {
    let cascadeQuery = supabase
      .from("entries")
      .update({
        kind: parsed.data.kind,
        amount: parsed.data.amount,
        category: parsed.data.category,
        description: parsed.data.description ?? null,
        // A card-tagged subscription's already-materialized future rows
        // need to follow if the user changes which card it's charged to
        // (or clears it back to nakit/banka) — otherwise src/lib/cashflow.ts's
        // creditCardDebtBalance and future-cycle projection would keep
        // reading the old card for months already generated before the edit.
        credit_card_id: creditCardId,
        // Ortak işareti de aynı gerekçeyle taşınıyor: kirayı ortak
        // işaretlemek (ya da işareti kaldırmak) yalnızca şablona yazılsaydı,
        // ZATEN ÜRETİLMİŞ aylar eski haliyle kalır ve hane toplamı
        // aylarca yanlış görünürdü.
        group_id: groupId,
      })
      .eq("template_id", id);
    if (!applyToAllOccurrences) {
      cascadeQuery = cascadeQuery.gte("occurred_at", todayDateString());
    }
    const { error: cascadeError } = await cascadeQuery;
    if (cascadeError) {
      console.error("updateEntry: failed to propagate to generated rows", cascadeError);
    }
  } else if (applyToAllOccurrences && rowBeforeUpdate?.recurrence !== "none") {
    // TEKRARLAYAN BİR KURAL TEK SEFERLİĞE ÇEVRİLDİ ve kullanıcı "Tüm kayıtlar
    // (geçmiş dahil)" dedi -> o kuralın ÜRETTİĞİ satırların hepsi silinir.
    //
    // Eskiden bu dal hiç yoktu: yukarıdaki cascade `if (isRecurring)` ile
    // korunuyor, tek seferliğe çevirmek isRecurring'i false yaptığı için blok
    // tamamen atlanıyordu. scheduleChanged (yukarıda) yalnızca GELECEK
    // satırları siliyor, dolayısıyla geçmiş dönem satırları yerinde kalıyor ve
    // template_id'leri artık şablon olmayan bir satırı gösteriyordu — yani
    // ortada, hiçbir kurala ait olmayan, kullanıcının "tek bir gider" olarak
    // gördüğü kaydın onlarca kopyası kalıyordu. Kullanıcı bildirdi:
    // "tek seferlik yaptığımda tüm kayıtlara uygula dediğimde diğer kayıtları
    // silmesi gerekmez mi? çünkü artık tek seferlik bir gider olmuş oldu."
    //
    // "Sadece gelecek kayıtlar" seçildiğinde GEÇMİŞ satırlar KORUNUYOR: onlar
    // gerçekten olmuş ödemeler, tarihleriyle birlikte defterin geçmişi.
    // Silmek muhasebe geçmişini yok etmek olurdu.
    const { error: dropError } = await supabase.from("entries").delete().eq("template_id", id);
    if (dropError) {
      console.error("updateEntry: failed to drop generated rows after converting to one-off", dropError);
    }
  }

  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true };
}

// Bir kaydın grupla ilişkisini kes — grup ekranından, kaydın SAHİBİ
// tarafından. Kayıt SİLİNMİYOR: kendi defterinde kişisel bir harcama olarak
// aynen kalıyor, yalnızca grubun toplamından çıkıyor.
//
// Başkasının kaydını gruptan çıkaramazsın ve bu RLS'te duruyor:
// entries_update_own'ın USING'i auth.uid() = user_id diyor, yani yabancı bir
// satır için update 0 satır etkiler. Arayüz de zaten çıkarma düğmesini
// yalnızca kendi satırlarında gösteriyor — ama asıl kapı policy.
// Bir çift bütçesi uygulamasında "eşimin kaydını sildi/çıkardı" güveni
// bitiren hata sınıfı (CLAUDE.md, kişiler arası mükerrer notuyla aynı
// gerekçe), o yüzden bu sınır UI'da değil DB'de tutuluyor.
export async function detachEntryFromGroup(id: string): Promise<AddEntryState> {
  const t = await getTranslations("ledger.form.errors");
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { error: t("genericInvalid") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entries")
    .update({ group_id: null })
    .eq("id", parsed.data)
    .select("id");

  if (error) {
    console.error("detachEntryFromGroup: güncellenemedi", error);
    return { error: t("saveFailed") };
  }
  // 0 satır = başkasının kaydı (RLS sessizce eledi). Hata vermemesi normal,
  // kullanıcıya net bir sebep söylüyoruz.
  if (!data || data.length === 0) {
    return { error: t("notFound") };
  }

  revalidatePath("/gruplar", "layout");
  revalidatePath("/defter");
  return { success: true };
}

// Toplu grup atama — grup ekranındaki "harcama ekle" akışı.
//
// Ekstreden 40 satır geldikten sonra bunları tek tek düzenleme formundan
// açmak yorucu; bu akış aynı işi tek onayla yapıyor. Çoklu seçimi defterin
// kendi tablosuna monte etmek yerine grup ekranına koymanın sebebi: zaten
// yalnızca KENDİ kayıtlarını atayabiliyorsun (RLS), yani liste doğal olarak
// sana kapsanıyor ve defterin ana akışına bir "seçim modu" borcu binmiyor.
//
// Yetki tek yerde: entries_insert/update_own'ın with check'i hem satırın
// senin olmasını hem de group_id'nin ÜYESİ OLDUĞUN bir grup olmasını
// doğruluyor. Yabancı bir satır ya da yabancı bir grup için update sessizce
// 0 satır etkiler; dönen satır sayısını sayıp kullanıcıya kaçının
// yazıldığını söylüyoruz.
export async function assignEntriesToGroup(
  groupId: string,
  entryIds: string[],
): Promise<AddEntryState & { assigned?: number }> {
  const t = await getTranslations("ledger.form.errors");
  const parsedGroup = z.string().uuid().safeParse(groupId);
  const parsedIds = z.array(z.string().uuid()).min(1).max(200).safeParse(entryIds);
  if (!parsedGroup.success || !parsedIds.success) {
    return { error: t("genericInvalid") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entries")
    .update({ group_id: parsedGroup.data })
    .in("id", parsedIds.data)
    .select("id");

  if (error) {
    console.error("assignEntriesToGroup: güncellenemedi", error);
    return { error: t("saveFailed") };
  }

  revalidatePath("/gruplar", "layout");
  revalidatePath("/defter");
  return { success: true, assigned: data?.length ?? 0 };
}

export async function deleteEntry(
  id: string,
  deleteGeneratedRows = false,
  deleteFutureInstallments = false,
) {
  const supabase = await createClient();
  // No explicit user_id check needed — RLS already scopes deletes to the
  // caller's own rows (entries_delete_own policy).
  //
  // deleteGeneratedRows is only meaningful when `id` is a recurring
  // template — the delete dialog asks the user to choose between stopping
  // future generation or wiping every row this template ever produced too.
  //
  // "Stopping future generation" used to be a no-op here (nothing had been
  // generated past the current month yet) — materializeDueOccurrences now
  // pre-generates FUTURE_HORIZON_YEARS ahead as real rows
  // (src/lib/recurrence-materialize.ts), so those not-yet-occurred rows
  // already exist and have to be actively removed, or they'd keep counting
  // as real future expenses/income even though the rule that produced them
  // no longer exists. Past rows are untouched either way — their
  // template_id just goes null via ON DELETE SET NULL below.
  if (deleteGeneratedRows) {
    await supabase.from("entries").delete().eq("template_id", id);
  } else {
    await supabase.from("entries").delete().eq("template_id", id).gte("occurred_at", todayDateString());
  }
  // deleteFutureInstallments is only meaningful when `id` is one row of a
  // taksit series — unlike deleteGeneratedRows above, this deliberately
  // never touches PAST installments (occurred_at <= this row's own date):
  // those months' money is already spent, deleting them would retroactively
  // rewrite history that already happened. Only this row and whatever's
  // still ahead of it get removed.
  if (deleteFutureInstallments) {
    const { data: row } = await supabase
      .from("entries")
      .select("installment_group_id, occurred_at")
      .eq("id", id)
      .maybeSingle();
    if (row?.installment_group_id) {
      await supabase
        .from("entries")
        .delete()
        .eq("installment_group_id", row.installment_group_id)
        .gt("occurred_at", row.occurred_at);
    }
  }

  // Deleting a single materialized occurrence (template_id set, this isn't
  // the deleteGeneratedRows path) would otherwise come back on the next
  // page load: materializeDueOccurrences (src/lib/recurrence-materialize.ts)
  // just sees an empty (template_id, occurred_at) slot and regenerates it.
  // Recording the date on the template's skip_dates is what makes a single
  // delete actually stick.
  if (!deleteGeneratedRows) {
    const { data: row } = await supabase
      .from("entries")
      .select("template_id, occurred_at")
      .eq("id", id)
      .maybeSingle();
    if (row?.template_id) {
      const { data: template } = await supabase
        .from("entries")
        .select("skip_dates")
        .eq("id", row.template_id)
        .maybeSingle();
      const skipDates = (template as { skip_dates: string[] } | null)?.skip_dates ?? [];
      if (!skipDates.includes(row.occurred_at)) {
        await supabase
          .from("entries")
          .update({ skip_dates: [...skipDates, row.occurred_at] })
          .eq("id", row.template_id);
      }
    }
  }

  await supabase.from("entries").delete().eq("id", id);
  revalidatePath("/defter");
  revalidatePath("/");
}
