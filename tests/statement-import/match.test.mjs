// Ekstre satırı <-> elle girilmiş kayıt eşleştirmesi.
//
// NEDEN VAR: bu eşleştirmenin yanlış yapması SESSİZ. Bir satır hatalı
// "mükerrer" damgası yerse gerçek bir harcama deftere hiç girmiyor ve
// kullanıcı bunu ancak aylar sonra, bakiyesi tutmayınca fark ediyor.
// Buradaki her test gerçek bir kırılma senaryosuna karşılık geliyor.
//
// Çalıştırma: npm test

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { matchStatementRows } = await jiti.import("../../src/lib/statement-import/match.ts");

const CARD = "11111111-1111-1111-1111-111111111111";

function row(tarih, tutar, extra = {}) {
  return {
    tarih,
    aciklama: "X",
    tutar,
    tur: "harcama",
    kategori: "diğer",
    taksit_index: null,
    taksit_sayisi: null,
    ...extra,
  };
}

let seq = 0;
function entry(occurred_at, amount, extra = {}) {
  seq += 1;
  return {
    id: `entry-${seq}`,
    kind: "expense",
    amount,
    currency: "TRY",
    category: "diğer",
    description: null,
    recurrence: "none",
    next_due_date: null,
    occurred_at,
    purchased_at: null,
    original_amount: null,
    original_currency: null,
    fx_rate: null,
    fx_rate_date: null,
    credit_card_id: CARD,
    group_id: null,
    created_at: "",
    template_id: null,
    portfolio_position_id: null,
    installment_group_id: null,
    installment_index: null,
    installment_count: null,
    skip_dates: [],
    ...extra,
  };
}

test("tarih bir gün kaymışsa mükerrer YAKALANIR", () => {
  // Eski davranış: tam tarih eşitliği aranıyordu ve bu satır "yeni harcama"
  // sanılıp deftere ikinci kez ekleniyordu.
  const [m] = matchStatementRows([row("2026-08-25", 250)], [entry("2026-08-26", 250)], CARD);
  assert.equal(m.possibleDuplicate, true);
  assert.deepEqual(m.duplicateOf, { occurred_at: "2026-08-26", amount: 250 });
});

test("pencere dışındaki kayıt eşleşmez", () => {
  const [m] = matchStatementRows([row("2026-08-20", 250)], [entry("2026-08-26", 250)], CARD);
  assert.equal(m.possibleDuplicate, false);
  assert.equal(m.duplicateOf, null);
});

test("HER GÜN AYNI TUTAR: kayıt sayısı kadar eşleşme, fazlası yeni harcama", () => {
  // Kullanıcının bildirdiği senaryo: her gün 125 TL sigara. 6 gün ekstrede,
  // ama kullanıcı yalnızca 2 gününü elle girmiş.
  //
  // Tüketim olmasaydı aynı 2 kayıt 6 satırla da eşleşir, 4 gerçek harcama
  // sessizce deftere girmezdi. Doğru sonuç: TAM 2 eşleşme.
  const rows = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"].map(
    (d) => row(d, 125),
  );
  const existing = [entry("2026-08-01", 125), entry("2026-08-02", 125)];
  const matches = matchStatementRows(rows, existing, CARD);
  assert.equal(matches.filter((m) => m.possibleDuplicate).length, 2);
  assert.equal(matches.filter((m) => !m.possibleDuplicate).length, 4);
});

test("HER GÜN AYNI TUTAR: hepsi girilmişse hepsi mükerrer", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const matches = matchStatementRows(
    days.map((d) => row(d, 125)),
    days.map((d) => entry(d, 125)),
    CARD,
  );
  assert.equal(matches.filter((m) => m.possibleDuplicate).length, 3);
});

test("bir kayıt yalnızca BİR satır tarafından tüketilir", () => {
  // Aynı gün iki kez 125 TL harcanmış, kullanıcı bir tanesini girmiş.
  const matches = matchStatementRows(
    [row("2026-08-10", 125), row("2026-08-10", 125)],
    [entry("2026-08-10", 125)],
    CARD,
  );
  assert.deepEqual(
    matches.map((m) => m.possibleDuplicate),
    [true, false],
  );
});

test("tarihi en yakın kayıt tercih edilir", () => {
  const far = entry("2026-08-13", 300);
  const near = entry("2026-08-15", 300);
  const [m] = matchStatementRows([row("2026-08-15", 300)], [far, near], CARD);
  assert.equal(m.duplicateOf.occurred_at, "2026-08-15");
});

test("tutar toleransı dar — 1 TL fark eşleşmez", () => {
  const [m] = matchStatementRows([row("2026-08-15", 300)], [entry("2026-08-15", 301)], CARD);
  assert.equal(m.possibleDuplicate, false);
});

test("başka bir karta yazılmış kayıt eşleşmez, kartsız kayıt eşleşir", () => {
  const other = matchStatementRows(
    [row("2026-08-15", 300)],
    [entry("2026-08-15", 300, { credit_card_id: "22222222-2222-2222-2222-222222222222" })],
    CARD,
  );
  assert.equal(other[0].possibleDuplicate, false);

  // Kartı seçilmeden girilmiş bir kayıt (nakit/belirtilmemiş) aday sayılıyor:
  // kullanıcı kaydı girerken kartı işaretlemeyi atlamış olabilir.
  const cashless = matchStatementRows(
    [row("2026-08-15", 300)],
    [entry("2026-08-15", 300, { credit_card_id: null })],
    CARD,
  );
  assert.equal(cashless[0].possibleDuplicate, true);
});

test("dövizli kayıt MÜKERRER değil, ÜSTÜNE YAZILACAK olarak işaretlenir", () => {
  // 5 € TCMB kuruyla ~278 TL girilmiş, banka komisyonuyla 285 kesmiş.
  const fx = entry("2026-08-15", 278, { original_amount: 5, original_currency: "EUR", fx_rate: 55.6 });
  const [m] = matchStatementRows([row("2026-08-16", 285)], [fx], CARD);
  assert.equal(m.possibleDuplicate, false);
  assert.equal(m.replaces.id, fx.id);
  assert.equal(m.duplicateOf, null);
});

test("dövizli eşleşme de tüketiliyor — aynı kayıt iki satıra yazılmaz", () => {
  const fx = entry("2026-08-15", 278, { original_amount: 5, original_currency: "EUR", fx_rate: 55.6 });
  const matches = matchStatementRows([row("2026-08-15", 285), row("2026-08-16", 285)], [fx], CARD);
  assert.equal(matches.filter((m) => m.replaces !== null).length, 1);
});

test("taksit: tarih değil seri kimliği eşleşiyor", () => {
  // Banka her ekstrede ORİJİNAL alışveriş tarihini yazıyor, kullanıcının
  // satırı ise ardışık aylara dağılmış — tarih penceresi bunu yakalayamaz.
  const installment = entry("2026-06-21", 833.33, {
    installment_group_id: "g",
    installment_index: 2,
    installment_count: 6,
  });
  const [m] = matchStatementRows(
    [row("2026-04-21", 833.33, { taksit_index: 2, taksit_sayisi: 6 })],
    [installment],
    CARD,
  );
  assert.equal(m.possibleDuplicate, true);
});

test("çıktı sırası girdi sırasını korur", () => {
  // İçeride tarihe göre işleniyor; arayüz satırları ekstredeki sırayla
  // listelediği için çıktı sırası bozulmamalı.
  const rows = [row("2026-08-20", 10), row("2026-08-01", 20), row("2026-08-10", 30)];
  const matches = matchStatementRows(rows, [entry("2026-08-01", 20)], CARD);
  assert.deepEqual(
    matches.map((m) => m.possibleDuplicate),
    [false, true, false],
  );
});
