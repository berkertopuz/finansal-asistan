// Sesli giriş için Gemini tarafını tek komutla teşhis eder:
//   node scripts/gemini-check.mjs
//   node scripts/gemini-check.mjs gemini-3.5-flash-lite   (başka model dene)
//
// Neden var: "Yapay zekâ servisine ulaşılamadı" mesajı üç ayrı sebepten
// çıkabiliyor (anahtar, kota, kod/şema) ve uygulamanın içinden hangisi
// olduğu görünmüyor. Bu script üçünü ayırıyor — uygulamaya, Supabase'e ya da
// deploy'a hiç dokunmadan doğrudan Google'a soruyor.
import fs from "node:fs";
import path from "node:path";

const ENV_FILE = ".env.local";
const DEFAULT_MODEL = "gemini-3.7-flash";
const API = "https://generativelanguage.googleapis.com/v1beta/models";

function readKey() {
  const file = path.resolve(process.cwd(), ENV_FILE);
  if (!fs.existsSync(file)) {
    console.error(`${ENV_FILE} bulunamadı. Bu script'i proje kökünden çalıştır.`);
    process.exit(1);
  }
  const line = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("GEMINI_API_KEY="));
  if (!line) {
    console.error(`${ENV_FILE} içinde GEMINI_API_KEY yok.`);
    process.exit(1);
  }
  return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
}

// Ses girdisi yolunu gerçekten sınamak için 1 sn'lik 16 kHz mono WAV —
// client'ın ürettiğiyle aynı biçim (src/lib/audio/wav.ts).
function makeWav(seconds = 1, rate = 16000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 300 * i) / rate)), 44 + i * 2);
  }
  return buf;
}

const key = readKey();
const model = process.argv[2] || DEFAULT_MODEL;

console.log(`Anahtar: ${key.length} karakter (${key.slice(0, 6)}…)`);
console.log(`Model:   ${model}\n`);

// 1) Anahtar geçerli mi, model erişilebilir mi?
const listRes = await fetch(API, { headers: { "x-goog-api-key": key } });
if (!listRes.ok) {
  console.log(`1) ANAHTAR — GEÇERSİZ (HTTP ${listRes.status})`);
  console.log((await listRes.text()).slice(0, 400));
  process.exit(1);
}
const models = (await listRes.json()).models ?? [];
const names = models.map((m) => m.name.replace("models/", ""));
console.log(`1) ANAHTAR — geçerli (${names.length} model görünüyor)`);
console.log(`   ${model} erişilebilir mi: ${names.includes(model) ? "EVET" : "HAYIR"}`);

// 2) Gerçek çağrı: ses + JSON şema + düşünme ayarı (uygulamanın yaptığının aynısı)
const schema = {
  type: "OBJECT",
  properties: {
    understood: { type: "BOOLEAN" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { amount: { type: "NUMBER", nullable: true }, description: { type: "STRING" } },
        required: ["amount", "description"],
      },
    },
  },
  required: ["understood", "items"],
};

const res = await fetch(`${API}/${model}:generateContent`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-goog-api-key": key },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { text: "Bu ses kaydındaki harcamaları çıkar." },
          { inline_data: { mime_type: "audio/wav", data: makeWav().toString("base64") } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: "low" },
    },
  }),
});

const raw = await res.text();
console.log(`\n2) ÇAĞRI — HTTP ${res.status}`);

if (res.status === 429) {
  const limit = raw.split("\n").find((l) => l.includes("limit:"));
  console.log("   KOTA DOLDU. Kod ya da şema sorunu YOK.");
  console.log(`  ${limit ? limit.trim() : raw.slice(0, 300)}`);
  console.log("   → Faturalandırmayı aç ya da daha yüksek limitli bir model dene:");
  console.log("     node scripts/gemini-check.mjs gemini-3.5-flash-lite");
  process.exit(0);
}

if (!res.ok) {
  console.log("   BAŞARISIZ — bu bir kod/şema/model sorunu:");
  console.log(raw.slice(0, 700));
  process.exit(1);
}

const candidate = JSON.parse(raw).candidates?.[0];
const parts = candidate?.content?.parts ?? [];
const answer = parts
  .filter((p) => p.thought !== true)
  .map((p) => p.text)
  .filter(Boolean)
  .join("");

console.log(`   finishReason: ${candidate?.finishReason}`);
console.log(`   parts: ${parts.length} (düşünce işaretli: ${parts.filter((p) => p.thought).length})`);
console.log(`   cevap: ${answer || "(BOŞ)"}`);

if (!answer) {
  console.log(
    "\n   BOŞ CEVAP — düşünme çıktı bütçesini yemiş olabilir (finishReason=MAX_TOKENS).",
  );
  process.exit(1);
}
console.log("\n   HER ŞEY ÇALIŞIYOR: anahtar, model, ses girdisi, JSON şema.");
