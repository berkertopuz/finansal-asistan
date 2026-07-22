import { extractText, getDocumentProxy } from "unpdf";

export type StatementHeader = {
  statementDate: string | null; // YYYY-MM-DD
  paymentDueDate: string | null; // YYYY-MM-DD
};

export type ExtractedStatement = {
  header: StatementHeader;
  transactionText: string;
};

// İşlem tablosunun bir sayfadan diğerine geçerken başlığını ("İşlem tarihi
// Açıklama Taksit Tutar") tekrar bastığı gözlemlendi (gerçek bir Enpara
// ekstresi üzerinde doğrulandı) — her tekrarı ayrı bir "segment" olarak
// bulup birleştirmek, çok sayfalı ekstrelerde tabloyu eksiksiz yakalar.
const TABLE_START = /İşlem tarihi\s*Açıklama\s*Taksit\s*Tutar/gi;
const TABLE_END_MARKERS = [
  /Sayfa\s+\d+\s*\/\s*\d+/i,
  /Kart sahibinin T\.C\. kimlik/i,
  /Bir sonraki ekstrenizin tarihi/i,
  /BSMV ve KKDF tutarlarına/i,
];

function toIsoDate(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

function findTableEnd(text: string, from: number): number {
  let earliest = text.length;
  for (const marker of TABLE_END_MARKERS) {
    marker.lastIndex = 0;
    const m = new RegExp(marker.source, marker.flags.replace("g", "")).exec(text.slice(from));
    if (m) earliest = Math.min(earliest, from + m.index);
  }
  return earliest;
}

// PDF'in TÜM metnini (`fullText`) yalnızca bu fonksiyon içinde, yerel olarak
// görür — ad soyad, TC kimlik no, kart numarası, adres dahil hiçbir kısmı bu
// fonksiyonun dışına çıkmaz. Dönen `transactionText` sadece işlem tablosu
// satırlarını, `header` sadece iki tarihi (kimlikle ilişkilendirilemez)
// içerir — çağıran taraf (src/app/api/statements/parse/route.ts) bunun
// dışında hiçbir şeye erişemez, LLM'e yalnızca bu ikisi gider.
export async function extractStatementText(pdfBuffer: ArrayBuffer): Promise<ExtractedStatement> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const { text: fullText } = await extractText(pdf, { mergePages: true });

  const statementDateMatch = fullText.match(/Ekstre tarihi\s+(\d{2}\/\d{2}\/\d{4})/i);
  const dueDateMatch = fullText.match(/Son ödeme tarihi\s+(\d{2}\/\d{2}\/\d{4})/i);

  const segments: string[] = [];
  let match: RegExpExecArray | null;
  TABLE_START.lastIndex = 0;
  while ((match = TABLE_START.exec(fullText))) {
    const segmentStart = match.index + match[0].length;
    const segmentEnd = findTableEnd(fullText, segmentStart);
    // PDF metni satır sonlarını korumadan tek bir düz metne akıyor —
    // "Bir önceki ekstre bakiyeniz 16.163,36 TL 15/06/2026 Ödeme..." gibi bir
    // satırın tutarı, hemen ardından gelen satırın tarihine bitişik kalıyor.
    // Bu, LLM'in "önceki satırın tutarı mı, yoksa bu satırın bir parçası mı"
    // belirsizliğine düşüp bazen bir satırı tamamen atlamasına yol açtı
    // (gerçek PDF üzerinde gözlendi). Her tarihten önce satır sonu ekleyerek
    // her işlemi kendi satırına ayırmak bu belirsizliği kökten kaldırıyor —
    // LLM'e güvenmek yerine deterministik bir düzeltme.
    const segment = fullText.slice(segmentStart, segmentEnd).trim();
    segments.push(segment.replace(/(\d{2}\/\d{2}\/\d{4})/g, "\n$1").trim());
  }

  return {
    header: {
      statementDate: statementDateMatch ? toIsoDate(statementDateMatch[1]) : null,
      paymentDueDate: dueDateMatch ? toIsoDate(dueDateMatch[1]) : null,
    },
    transactionText: segments.join("\n"),
  };
}
