// MediaRecorder çıktısını Gemini'nin kabul ettiği bir biçime çevirir.
//
// NEDEN GEREKLİ: Gemini'nin ses biçimi listesi wav/mp3/aiff/aac/ogg/flac —
// webm YOK. Android Chrome'un (ve TWA WebView'ının) MediaRecorder'ı ise
// varsayılan olarak audio/webm;codecs=opus, iOS Safari audio/mp4 üretiyor.
// Yani ham kayıt her iki platformda da reddedilirdi. Tarayıcı kendi ürettiği
// biçimi decodeAudioData ile açabildiği için dönüşümü client'ta yapıyoruz —
// sunucuda ffmpeg/wasm taşımaktan çok daha ucuz.
//
// Konuşma için 16 kHz mono fazlasıyla yeterli (telefon kalitesinin üstü) ve
// yükü küçük tutuyor: 30 sn ≈ 960 KB ham PCM, base64'le ~1.3 MB.
const TARGET_SAMPLE_RATE = 16_000;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function getOfflineAudioContextCtor(): typeof OfflineAudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

// Kanalları tek kanala indirger ve hedef örnekleme hızına yeniden örnekler.
// Yeniden örneklemeyi elle yapmak yerine OfflineAudioContext'e bırakıyoruz —
// tarayıcının kendi (kaliteli, anti-aliasing'li) resampler'ı bu.
async function toMonoAtTargetRate(decoded: AudioBuffer): Promise<Float32Array> {
  if (decoded.sampleRate === TARGET_SAMPLE_RATE && decoded.numberOfChannels === 1) {
    return decoded.getChannelData(0);
  }

  const OfflineCtor = getOfflineAudioContextCtor();
  if (!OfflineCtor) {
    // Yeniden örnekleyemiyorsak ilk kanalı olduğu gibi kullanıyoruz; WAV
    // başlığına gerçek örnekleme hızı yazıldığı için ses yine de doğru
    // çalınır, sadece dosya büyür.
    return decoded.getChannelData(0);
  }

  const frameCount = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offline = new OfflineCtor(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk uzunluğu
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte/sn
  view.setUint16(32, 2, true); // blok hizası
  view.setUint16(34, 16, true); // bit derinliği
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    // Kırpma şart: decode edilmiş örnekler [-1, 1] aralığının biraz dışına
    // taşabiliyor, taşan değer 16-bit'e çevrilirken sarmalanıp cızırtı
    // olurdu.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export class AudioConversionError extends Error {}

export async function blobToWav(blob: Blob): Promise<Blob> {
  const AudioCtor = getAudioContextCtor();
  if (!AudioCtor) {
    throw new AudioConversionError("Web Audio API kullanılamıyor.");
  }

  const context = new AudioCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await context.decodeAudioData(arrayBuffer);
    const samples = await toMonoAtTargetRate(decoded);
    const rate =
      decoded.sampleRate === TARGET_SAMPLE_RATE && decoded.numberOfChannels === 1
        ? decoded.sampleRate
        : (getOfflineAudioContextCtor() ? TARGET_SAMPLE_RATE : decoded.sampleRate);
    return encodeWav(samples, rate);
  } catch (err) {
    if (err instanceof AudioConversionError) throw err;
    throw new AudioConversionError(String(err));
  } finally {
    // Kapatılmayan her AudioContext donanım ses yolunu açık tutuyor; mobilde
    // bu hem pil hem de "bu uygulama ses kullanıyor" göstergesi demek.
    void context.close();
  }
}
