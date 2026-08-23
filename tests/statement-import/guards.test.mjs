// Ekstre ayrıştırıcısının KÖTÜ NİYETLİ girdiye karşı bütçeleri.
//
// corpus.test.mjs'in aksine bu dosya fixture istemiyor: girdileri kendisi
// üretiyor, yani her klonda koşuyor. Korunan şey CLAUDE.md kural 8: kayıt
// herkese açık, dolayısıyla yüklenen dosya kimliği doğrulanmış ama
// GÜVENİLMEYEN bir kaynaktan geliyor ve ayrıştırma paylaşılan Next
// sürecinde koşuyor — bütçesiz bir ayrıştırma tek bir istekle tüm
// kullanıcıları etkiler.

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const extract = await jiti.import("../../src/lib/statement-import/extract.ts");

/**
 * Geçerli, N sayfalık, içeriği boş bir PDF üretir.
 *
 * Elle kuruluyor çünkü test edilen şey tam olarak "çok sayfalı bir PDF" ve
 * bunu bir fixture olarak repoya koymak (ya da bir PDF üretme bağımlılığı
 * eklemek) gereksiz. xref tablosu doğru offset'lerle yazılıyor: pdf.js bozuk
 * xref'i kurtarabiliyor, ama o zaman test bütçeyi değil kurtarma yolunu
 * ölçmüş olurdu.
 */
function buildPdfWithPages(pageCount) {
  const objects = [];
  const kids = Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(" ");
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let i = 0; i < pageCount; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>`);
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf).buffer;
}

test("sayfa bütçesini aşan PDF reddedilir", async () => {
  // 61 sayfa: sınır 60. Gerçek ekstrelerin en büyüğü 5 sayfa.
  await assert.rejects(
    () => extract.extractStatementText(buildPdfWithPages(61)),
    extract.StatementTooComplexError,
    "61 sayfalık PDF bütçeye takılmalıydı",
  );
});

test("sayfa bütçesinin altındaki PDF ayrıştırıcıya girer", async () => {
  // Sınırın kendisi bir regresyon kaynağı: yanlışlıkla 1'e düşerse yukarıdaki
  // test yine geçer ama uygulama tüm gerçek ekstreleri reddeder. Bu test o
  // yönü tutuyor — boş sayfalarda işlem yok, önemli olan HATA ATMAMASI.
  const result = await extract.extractStatementText(buildPdfWithPages(10));
  assert.equal(result.transactionCount, 0);
});

test("PDF olmayan baytlar ayrıştırıcıyı çökertmez, hata olarak döner", async () => {
  const garbage = new TextEncoder().encode("bu bir PDF değil, sadece düz metin").buffer;
  await assert.rejects(() => extract.extractStatementText(garbage));
});

test("boş gövde hata olarak döner", async () => {
  await assert.rejects(() => extract.extractStatementText(new ArrayBuffer(0)));
});
