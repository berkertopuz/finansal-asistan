import type { ClassifiedLines } from "./classify";

// LLM'e gönderilen metnin SÖZLEŞMESİ. Eski tasarımda prompt bankaların ham
// metin biçimlerini anlatmak zorundaydı ("QNB'de tutar parantez içinde
// gelebilir, Enpara'da..."); artık prompt yalnızca bu sabit iskeleti anlatıyor
// ve hangi banka olduğu prompt'u hiç ilgilendirmiyor.
//
// İşlem satırları NUMARALANIYOR: prompt'un "çıktıdaki satır sayısı metindeki
// satır sayısına eşit olmalı" kuralı (gerçek bir QNB ekstresinde modelin
// satır atlaması üzerine eklenmişti) artık modelin saymasına değil, bizim
// verdiğimiz numaraya dayanıyor — model kendi çıktısını 1..N'e karşı
// denetleyebiliyor.

export function buildStatementMarkdown(lines: ClassifiedLines): string {
  const sections: string[] = [];

  if (lines.summary.length > 0) {
    sections.push(
      ["## Ekstre özeti", ...lines.summary.map((line) => `- ${line}`)].join("\n"),
    );
  }

  sections.push(
    [
      `## İşlem adayları (${lines.transactions.length} satır)`,
      ...lines.transactions.map((line, i) => `${i + 1}. ${line}`),
    ].join("\n"),
  );

  return sections.join("\n\n");
}
