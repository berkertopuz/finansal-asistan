// Grup dönem özeti — saf aritmetik.
//
// NEDEN VAR: bu ekranın tek iddiası "kim ne ödedi"yi doğru göstermek.
// Model tek cümle: kim ödediyse gider ona yazılır ve grup toplamına
// eklenir — bölüşme oranı, pay etiketi ve uzlaşma hesabı YOK. Sessizce
// bozulabilecek kısımlar: hiç harcama girmemiş üyenin listede kalması ve
// kategori sıralaması.
//
// Çalıştırma: npm test

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { summarizeGroup } = await jiti.import("../../src/lib/group-summary.ts");

const A = { user_id: "a", display_name: "Ali" };
const B = { user_id: "b", display_name: "Bora" };

function entry(userId, amount, extra = {}) {
  return {
    id: `${userId}-${amount}-${extra.category ?? "x"}`,
    user_id: userId,
    household_id: "h",
    kind: "expense",
    amount,
    category: "market",
    description: null,
    occurred_at: "2026-08-10",
    credit_card_id: null,
    payer_name: null,
    ...extra,
  };
}

test("toplam ve ödeyen kırılımı", () => {
  const s = summarizeGroup([entry("a", 8400), entry("b", 6200)], [A, B]);
  assert.equal(s.total, 14600);
  assert.equal(s.entryCount, 2);
  assert.deepEqual(
    s.byPayer.map((p) => [p.name, p.paid]),
    [
      ["Ali", 8400],
      ["Bora", 6200],
    ],
  );
});

test("hiç harcama girmemiş üye de listede, 0 ile", () => {
  const s = summarizeGroup([entry("a", 500)], [A, B]);
  assert.deepEqual(
    s.byPayer.map((p) => [p.name, p.paid]),
    [
      ["Ali", 500],
      ["Bora", 0],
    ],
  );
});

test("kategori kırılımı büyükten küçüğe, kategorisiz ayrı", () => {
  const s = summarizeGroup(
    [
      entry("a", 100, { category: "market" }),
      entry("b", 900, { category: "fatura" }),
      entry("a", 50, { category: null }),
    ],
    [A, B],
  );
  assert.deepEqual(
    s.byCategory.map((c) => [c.category, c.amount]),
    [
      ["fatura", 900],
      ["market", 100],
      [null, 50],
    ],
  );
});

test("boş ay", () => {
  const s = summarizeGroup([], [A, B]);
  assert.equal(s.total, 0);
  assert.equal(s.entryCount, 0);
  assert.equal(s.byCategory.length, 0);
  assert.deepEqual(
    s.byPayer.map((p) => p.paid),
    [0, 0],
  );
});

// --- Kişiler arası mükerrer ---------------------------------------------
// Ekstre tarafındaki tespit bu sınıfı göremiyor: o yalnızca çağıranın kendi
// kayıtlarına bakıyor ve RLS eşin satırlarını hiç döndürmüyor. Grup
// görünümü iki kişinin satırlarını yan yana getiren TEK yer.

const { findCrossPayerDuplicates } = await jiti.import("../../src/lib/group-summary.ts");

function gEntry(userId, amount, occurred_at, payer_name) {
  return {
    id: `${userId}-${amount}-${occurred_at}`,
    user_id: userId,
    group_id: "g",
    kind: "expense",
    amount,
    category: "market",
    description: null,
    occurred_at,
    credit_card_id: null,
    payer_name,
  };
}

test("iki kişi aynı harcamayı girmişse uyarı üretilir", () => {
  const dups = findCrossPayerDuplicates([
    gEntry("a", 500, "2026-08-10", "Ali"),
    gEntry("b", 500, "2026-08-11", "Bora"),
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].amount, 500);
});

test("AYNI kişinin iki benzer kaydı uyarı üretmez", () => {
  // Aynı kişi gerçekten iki kez aynı tutarı harcamış olabilir; bu sınıfın
  // konusu kişiler ARASI çift sayım.
  const dups = findCrossPayerDuplicates([
    gEntry("a", 500, "2026-08-10", "Ali"),
    gEntry("a", 500, "2026-08-11", "Ali"),
  ]);
  assert.equal(dups.length, 0);
});

test("pencere dışında ya da farklı tutarda uyarı yok", () => {
  assert.equal(
    findCrossPayerDuplicates([
      gEntry("a", 500, "2026-08-10", "Ali"),
      gEntry("b", 500, "2026-08-20", "Bora"),
    ]).length,
    0,
  );
  assert.equal(
    findCrossPayerDuplicates([
      gEntry("a", 500, "2026-08-10", "Ali"),
      gEntry("b", 501, "2026-08-10", "Bora"),
    ]).length,
    0,
  );
});

test("her kayıt en fazla BİR uyarıya girer", () => {
  // Üç kişi aynı tutarı girmişse aynı şey üç kez söylenmemeli.
  const dups = findCrossPayerDuplicates([
    gEntry("a", 500, "2026-08-10", "Ali"),
    gEntry("b", 500, "2026-08-10", "Bora"),
    gEntry("c", 500, "2026-08-10", "Ceren"),
  ]);
  assert.equal(dups.length, 1);
});

test("onaylanmış çift bir daha uyarı üretmez", () => {
  const a = gEntry("a", 500, "2026-08-10", "Ali");
  const b = gEntry("b", 500, "2026-08-11", "Bora");
  const [first, second] = [a.id, b.id].sort();
  const dups = findCrossPayerDuplicates([a, b], [
    { first_entry_id: first, second_entry_id: second },
  ]);
  assert.equal(dups.length, 0);
});

test("onaylanan çiftin üyeleri BAŞKASIYLA yeniden eşleşmez", () => {
  // Onay tüketmeseydi, a-b onaylandıktan sonra a-c eşleşip aynı gürültü
  // geri gelirdi.
  const a = gEntry("a", 500, "2026-08-10", "Ali");
  const b = gEntry("b", 500, "2026-08-10", "Bora");
  const c = gEntry("c", 500, "2026-08-10", "Ceren");
  const [first, second] = [a.id, b.id].sort();
  const dups = findCrossPayerDuplicates([a, b, c], [
    { first_entry_id: first, second_entry_id: second },
  ]);
  assert.equal(dups.length, 0);
});
