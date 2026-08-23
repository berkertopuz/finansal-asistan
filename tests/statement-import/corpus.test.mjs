// Ekstre ayrıştırma regresyon korpusu.
//
// NEDEN VAR: statement-import boru hattı üç eksende (metin kodlaması, tarih
// biçimi, satır yapısı) her banka için farklı davranan gerçek PDF'lere karşı
// yazıldı ve her yeni banka bir ayar değişikliği getiriyor. Bu değişikliklerin
// hiçbirinin bir ÖNCEKİ bankayı bozmadığını elle doğrulamak sürdürülebilir
// değil — üç PDF'i her seferinde tek tek çalıştırmak gerekiyordu. Bu koşucu
// onu tek komuta indiriyor.
//
// GİZLİLİK: Korpusun kendisi (PDF'ler + manifest) repoya GİRMEZ; bunlar
// gerçek kişilere ait gerçek hesap özetleri. fixtures/ dizini .gitignore'da
// ve dosya yoksa test ATLANIR (fail etmez) — yani repoyu klonlayan biri için
// yeşil, korpusu olan geliştirici için anlamlı. Kurulum: fixtures/README.md.
//
// Çalıştırma: npm test

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const manifestPath = path.join(fixturesDir, "manifest.json");

// jiti ile yükleniyor çünkü test edilen kod TypeScript ve projede bir test
// derleyicisi yok. Node'un yerel type-stripping'i uzantısız göreli import'ları
// (`from "./classify"`) çözemiyor, jiti çözüyor — ve zaten bir bağımlılık.
const jiti = createJiti(import.meta.url);

function loadManifest() {
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

const manifest = loadManifest();

test("ekstre korpusu", { skip: manifest ? false : "fixtures/manifest.json yok — bkz. fixtures/README.md" }, async (t) => {
  const { extractStatementText } = await jiti.import("../../src/lib/statement-import/extract.ts");

  for (const entry of manifest.statements) {
    const pdfPath = path.join(fixturesDir, entry.file);

    await t.test(entry.name, { skip: fs.existsSync(pdfPath) ? false : `${entry.file} yok` }, async () => {
      const buffer = fs.readFileSync(pdfPath);
      const result = await extractStatementText(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      );

      // 1. İşlem sayısı. Tam eşitlik isteniyor, ">= n" değil: bu boru hattının
      //    en sinsi regresyonu satır KAYBETMEK (bir filtre fazla eliyor) ve
      //    satır UYDURMAK (bir bölme kuralı fazla bölüyor) — alt sınır
      //    ikincisini hiç yakalamaz.
      assert.equal(
        result.transactionCount,
        entry.transactions,
        `işlem sayısı ${result.transactionCount}, beklenen ${entry.transactions}`,
      );

      const summaryLines = result.markdown
        .split("\n")
        .filter((line) => line.startsWith("- "));
      assert.equal(summaryLines.length, entry.summaryFields, "özet alanı sayısı");

      // 2. Maskeleyicinin bıraktığı etiketler LLM'e gitmemeli. İşlem
      //    kuyruğundaki bir [KART] kimlik bloğunun başlangıcıdır ve
      //    trimIdentityTail'in orada kesmiş olması gerekir.
      assert.equal(
        result.markdown.match(/\[(?:TCKN|KART|IBAN|TELEFON|EPOSTA|AD|NO)\]/g)?.length ?? 0,
        0,
        "çıktıda maske etiketi kalmış — kimlik bloğu kesilmemiş olabilir",
      );

      // 3. Bu ekstreye ait gerçek kişisel veriler (ad, adres parçaları, kart
      //    no) çıktının hiçbir yerinde geçmemeli. Bu diziler manifest'te,
      //    yani repo DIŞINDA duruyor.
      for (const secret of entry.mustNotContain ?? []) {
        assert.ok(
          !result.markdown.includes(secret),
          `kişisel veri sızdı: ${JSON.stringify(secret)}`,
        );
      }

      // 4. Metin katmanının doğru çözüldüğünü kanıtlayan örnek satırlar
      //    (EBCDIC çözücüsü ya da alt-küme fontu kalibrasyonu bozulursa bu
      //    düşer, sayılar hâlâ tutuyor olsa bile).
      for (const needle of entry.mustContain ?? []) {
        assert.ok(
          result.markdown.includes(needle),
          `beklenen metin yok: ${JSON.stringify(needle)}`,
        );
      }
    });
  }
});
