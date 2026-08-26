import type { GroupEntry } from "@/lib/groups-data";

// Hane ekranının bütün aritmetiği — saf, I/O yok, bu yüzden testi ucuz
// (tests/household/summary.test.mjs). analysis.ts'teki desenle aynı: sorgu
// bir yerde, hesap başka yerde.
//
// Model tek cümle: KİM ÖDEDİYSE GİDER ONA YAZILIR ve hane toplamına eklenir.
// Bölüşme oranı yok, pay etiketi yok, uzlaşma hesabı yok. Bir ara sürümde
// kayıt başına "karşı tarafın payı" etiketi vardı (counterpart_share) ve
// kaldırıldı: hiçbir toplamı değiştirmiyor, borç doğurmuyordu — yani
// çıktısını tüketen bir şey yoktu — ama karşılığında formda bir alan,
// burada "yalnızca tam iki kişilik hanede atfedilebilir" özel durumu ve
// arayüzde çelişki gibi okunan bir satır getiriyordu
// ("Neda ₺400,00 · ödedi ₺0,00"). Bkz. 20260826120000_drop_counterpart_share.sql.

export type PayerSlice = {
  userId: string;
  name: string | null;
  paid: number;
};

export type GroupCategorySlice = {
  category: string | null;
  amount: number;
};

export type GroupSummaryData = {
  total: number;
  entryCount: number;
  byPayer: PayerSlice[];
  byCategory: GroupCategorySlice[];
};

type MemberRef = { user_id: string; display_name: string | null };

export function summarizeGroup(
  entries: GroupEntry[],
  members: MemberRef[],
): GroupSummaryData {
  const total = entries.reduce((sum, e) => sum + e.amount, 0);

  // Her üye listede görünsün — bu ay hiç ortak harcama girmemiş olan da.
  // "0 ₺ koydu" bir bilgi; satırı hiç göstermemek onu görünmez yapardı.
  const paid = new Map<string, number>();
  for (const m of members) paid.set(m.user_id, 0);
  for (const entry of entries) {
    paid.set(entry.user_id, (paid.get(entry.user_id) ?? 0) + entry.amount);
  }

  const nameOf = new Map(members.map((m) => [m.user_id, m.display_name]));
  const byPayer: PayerSlice[] = [...paid.entries()]
    .map(([userId, amount]) => ({ userId, name: nameOf.get(userId) ?? null, paid: amount }))
    .sort((a, b) => b.paid - a.paid);

  const categoryTotals = new Map<string | null, number>();
  for (const entry of entries) {
    const key = entry.category ?? null;
    categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + entry.amount);
  }
  const byCategory: GroupCategorySlice[] = [...categoryTotals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { total, entryCount: entries.length, byPayer, byCategory };
}

// KİŞİLER ARASI MÜKERRER.
//
// Ekstre tarafındaki mükerrer tespiti (src/lib/statement-import/match.ts)
// bu sınıfı GÖREMİYOR: o yalnızca çağıranın kendi kayıtlarına bakıyor ve
// RLS zaten eşin satırlarını döndürmüyor. Ama grup görünümünde iki kişinin
// satırları yan yana geliyor — aynı market alışverişini ikisi de girdiyse
// grup toplamı o harcamayı iki kez sayıyor.
//
// ASLA otomatik birleştirme veya silme yok: iki farklı kullanıcının satırını
// uygulama kendiliğinden silemez. Bir çift bütçesi uygulamasında "eşimin
// kaydını sildi" güveni bitiren hata sınıfı; burada yapılan tek şey
// göstermek, karar onların.
const CROSS_PAYER_DATE_WINDOW_DAYS = 3;
const CROSS_PAYER_AMOUNT_TOLERANCE = 0.01;

type DuplicateSide = {
  id: string;
  // Kaydın SAHİBİ: inceleme ekranı "bu benim kaydım mı" sorusuna göre farklı
  // yetki gösteriyor (kendi kaydını herkes, başkasınınkini yalnızca yönetici
  // çıkarabiliyor).
  userId: string;
  payerName: string | null;
  occurredAt: string;
};

export type CrossPayerDuplicate = {
  amount: number;
  first: DuplicateSide;
  second: DuplicateSide;
};

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(a + "T00:00:00") - Date.parse(b + "T00:00:00")) / 86_400_000;
}

// Her kayıt en fazla BİR uyarıya giriyor (tüketimli). Aksi halde üç kişinin
// aynı tutarı girdiği bir durumda üç ayrı çift üretilip aynı şey üç kez
// söylenirdi.
export function findCrossPayerDuplicates(
  entries: GroupEntry[],
  // Kullanıcının "bunlar farklı harcamalar" diye onayladığı çiftler. Uyarı
  // sezgisel olduğu için gerçekten iki ayrı harcama olabilir; onaylanmış bir
  // çift bir daha sorulmuyor, yoksa uyarı kalıcı gürültüye döner.
  reviewed: { first_entry_id: string; second_entry_id: string }[] = [],
): CrossPayerDuplicate[] {
  const reviewedKeys = new Set(
    reviewed.map((r) => [r.first_entry_id, r.second_entry_id].sort().join("|")),
  );
  const sorted = [...entries].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const paired = new Set<string>();
  const found: CrossPayerDuplicate[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (paired.has(a.id)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (paired.has(b.id)) continue;
      if (a.user_id === b.user_id) continue;
      if (Math.abs(a.amount - b.amount) >= CROSS_PAYER_AMOUNT_TOLERANCE) continue;
      if (dayDistance(a.occurred_at, b.occurred_at) > CROSS_PAYER_DATE_WINDOW_DAYS) continue;
      // Onaylanmış çift: eşleşme sayılıyor ama uyarı ÜRETİLMİYOR — ve ikisi
      // de tüketiliyor, yoksa onaylanan çiftin bir üyesi başka biriyle
      // yeniden eşleşip aynı gürültüyü geri getirirdi.
      if (reviewedKeys.has([a.id, b.id].sort().join("|"))) {
        paired.add(a.id);
        paired.add(b.id);
        break;
      }
      paired.add(a.id);
      paired.add(b.id);
      found.push({
        amount: a.amount,
        first: { id: a.id, userId: a.user_id, payerName: a.payer_name, occurredAt: a.occurred_at },
        second: { id: b.id, userId: b.user_id, payerName: b.payer_name, occurredAt: b.occurred_at },
      });
      break;
    }
  }

  return found;
}
