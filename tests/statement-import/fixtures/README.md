# Ekstre test korpusu

Bu dizin **repoya girmez** (`.gitignore`). İçindeki PDF'ler gerçek kişilere ait
gerçek kredi kartı hesap özetleri — ad, adres, kart numarası, harcama geçmişi
taşıyorlar. Korpusu olmayan bir çalışma kopyasında `npm test` testi ATLAR,
başarısız olmaz.

## Kurulum

1. Ekstre PDF'lerini bu dizine kopyala. Dosya adında kişi adı olmasın
   (bankaların indirdiği ad sıklıkla içeriyor) — `qnb-2026-06.pdf` gibi.
2. Yanına `manifest.json` yaz.

## manifest.json

```json
{
  "statements": [
    {
      "name": "QNB — bozuk alt-küme fontu, sayısal tarih",
      "file": "qnb-2026-06.pdf",
      "transactions": 99,
      "summaryFields": 18,
      "mustContain": ["İST.ANADOLUHİSARICSA"],
      "mustNotContain": ["AD SOYAD", "Sokak adı"]
    }
  ]
}
```

| alan | anlamı |
| --- | --- |
| `name` | Test çıktısında görünen ad. Bankayı DEĞİL, hangi biçim eksenini temsil ettiğini yaz — korpusun amacı bu. |
| `transactions` | `extractStatementText`'in döndürmesi gereken TAM sayı. Alt sınır değil: kaybedilen satır kadar uydurulan satır da regresyon. |
| `summaryFields` | Markdown'daki `- ` ile başlayan özet alanı sayısı. |
| `mustContain` | Metin katmanının doğru çözüldüğünü kanıtlayan örnek. Türkçe harf içeren bir merchant adı iyi bir seçim: EBCDIC çözücüsü ya da font kalibrasyonu bozulursa sayılar tutmaya devam ederken bu düşer. |
| `mustNotContain` | Bu ekstredeki gerçek kişisel veriler. Çıktının hiçbirini içermemesi gerekir. Bu dizin gitignore'da olduğu için buraya gerçek değerleri yazmak güvenli. |

## Beklenen sayılar değişince

Bir düzeltme sayıları bilerek değiştiriyorsa (yeni bir biçim ekseni desteklendi,
eskiden düşen satırlar artık yakalanıyor) `transactions`/`summaryFields`
güncellenir — ama önce çıktı gözle okunup **yeni satırların gerçek olduğu**
doğrulanmalı. Testin asıl işi, sayının SESSİZCE değişmesini engellemek.

## Kapsam

Korpus banka değil **biçim ekseni** biriktirir. Yeni bir ekstre eklemeye değip
değmediğinin ölçüsü şu: mevcutlardan hangi eksende ayrılıyor?

- metin kodlaması: Unicode / bozuk alt-küme fontu / EBCDIC
- tarih biçimi: `27/07/2026` / `27 Temmuz 2026`
- sayı biçimi: `1.234,56` / `1,234.56`
- satır yapısı: glyph akışı satır sonu taşıyor mu, işlem tablosu kaç kolonlu
- döviz: orijinal tutar + kur kuyruğu taşıyan satırlar

Hiçbirinde ayrılmıyorsa eklemek regresyon gücü katmaz.
