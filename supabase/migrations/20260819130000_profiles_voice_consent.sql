-- Sesli giriş: ses kaydının Google Gemini'ye gönderilmesi için ayrı, spesifik
-- açık rıza zaman damgası. statement_llm_consent_at'ten AYRI tutuluyor —
-- KVKK'nın 18.02.2026 tarihli 2026/347 sayılı ilke kararı açık rızanın
-- spesifik olmasını istiyor: farklı veri türü (kullanıcının kendi ses kaydı,
-- ekstre metninden farklı olarak biyometrik veriye yakın bir kişisel veri) ve
-- farklı alıcı (Google, OpenAI değil). Ekstre için verilmiş bir onay bunu
-- kapsamaz.
--
-- null = kullanıcı henüz onay vermemiş; ilk sesli giriş denemesinde aydınlatma
-- metni + onay adımı gösterilir (StatementUploadSheet'teki akışın aynısı).
alter table public.profiles
  add column voice_llm_consent_at timestamptz;
