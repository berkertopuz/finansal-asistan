"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blobToWav } from "@/lib/audio/wav";

export type VoiceRecorderState = "idle" | "starting" | "recording" | "processing";

// Kaydın üst sınırı. Buton artık aç/kapa çalıştığı için (basılı tutma yok)
// kullanıcının durdurmayı unutması gerçek bir ihtimal — bu sınır olmadan
// kayıt sessizce dakikalarca sürer ve faturalanırdı. 60 sn, birden fazla
// harcamayı arka arkaya saymaya (asıl toplu giriş senaryosu) yetiyor.
const MAX_RECORDING_MS = 60_000;

// Kazara dokunuşu gerçek bir kayıttan ayırır — bunun altındaki her şey
// "yanlışlıkla bastım", sunucuya gönderilmez.
const MIN_RECORDING_MS = 400;

// MediaRecorder'ın gerçekte ürettiği biçim tarayıcıya göre değişiyor ve
// hiçbiri Gemini'nin listesinde değil (Android Chrome: webm/opus, iOS Safari:
// mp4/aac). Bu yüzden burada "en iyi kayıt biçimini" seçip dönüşümü
// blobToWav'a bırakıyoruz — seçim yalnızca kayıt kalitesi/verimliliği için.
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

// Mikrofon hatalarını mesaj kataloğu anahtarlarına çevirir. Ham DOMException
// adı kullanıcıya asla gösterilmiyor (CLAUDE.md kural 1).
function micErrorKey(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "micDenied";
  if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") {
    return "micUnavailable";
  }
  return "recordingFailed";
}

export function useVoiceRecorder({
  onResult,
  onError,
}: {
  onResult: (wav: Blob) => void;
  onError: (messageKey: string) => void;
}) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // start() sırasında kullanıcı butonu bırakırsa (getUserMedia izni beklerken)
  // kaydı hiç başlatmadan iptal etmek için — aksi halde mikrofon açılıp
  // kimsenin durdurmadığı bir kayıt başlardı.
  const abortedRef = useRef(false);

  const releaseStream = useCallback(() => {
    // Track'ler kapatılmazsa mikrofon göstergesi açık kalıyor. Kurulu bir
    // uygulamada (TWA) bu, kullanıcının "beni dinliyor" diye okuduğu şey.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Sayfa kapanırsa/bileşen sökülürse mikrofonu açık bırakma.
  useEffect(() => releaseStream, [releaseStream]);

  const stop = useCallback(() => {
    abortedRef.current = true;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      // Henüz kayıt başlamadıysa (izin diyaloğu açıkken bırakıldı) sadece
      // temizle — hata gösterecek bir şey yok.
      releaseStream();
      setState("idle");
      return;
    }
    recorder.stop();
  }, [releaseStream]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    abortedRef.current = false;
    setState("starting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Konuşma kaydı için tarayıcının kendi ön işlemesi transkripsiyon
          // doğruluğunu belirgin artırıyor (özellikle sokakta/arabada).
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      setState("idle");
      onError(micErrorKey(err));
      return;
    }

    // İzin diyaloğu açıkken kullanıcı butonu bıraktıysa kaydı hiç başlatma.
    if (abortedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      setState("idle");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      const mimeType = pickMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      releaseStream();
      setState("idle");
      onError(micErrorKey(err));
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      const elapsed = Date.now() - startedAtRef.current;
      const recorded = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      releaseStream();

      if (elapsed < MIN_RECORDING_MS || recorded.size === 0) {
        setState("idle");
        onError("tooShort");
        return;
      }

      setState("processing");
      try {
        // Gemini webm/mp4 kabul etmiyor — WAV'a çevirmek zorunlu, isteğe
        // bağlı bir optimizasyon değil (bkz. src/lib/audio/wav.ts).
        onResult(await blobToWav(recorded));
      } catch {
        setState("idle");
        onError("recordingFailed");
      }
    };

    recorder.onerror = () => {
      releaseStream();
      setState("idle");
      onError("recordingFailed");
    };

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start();
    setState("recording");

    timeoutRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, MAX_RECORDING_MS);
  }, [state, onError, onResult, releaseStream]);

  // İstek bittiğinde bileşen çağırır — hook kendi başına "processing"ten
  // çıkmıyor, çünkü yükleme/çözümleme süresi çağıranın işi.
  const reset = useCallback(() => setState("idle"), []);

  return { state, start, stop, reset, maxRecordingMs: MAX_RECORDING_MS };
}
