import { useCallback, useEffect, useRef, useState } from "react";

interface UseVoiceInputReturn {
  isListening: boolean;
  startListening: () => Promise<void>;
  stopListening: () => Promise<string>;
  cancel: () => void;
  transcription: string | null;
  error: string | null;
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const cleanup = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    setTranscription(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsListening(true);
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied"
          : "Could not access microphone";
      setError(message);
      throw err;
    }
  }, []);

  const stopListening = useCallback(async (): Promise<string> => {
    return new Promise<string>((resolve) => {
      if (!mediaRecorderRef.current || !isListening) {
        resolve("");
        return;
      }

      const recorder = mediaRecorderRef.current;

      recorder.onstop = async () => {
        setIsListening(false);
        cleanup();

        if (audioChunksRef.current.length === 0) {
          setError("No audio recorded");
          resolve("");
          return;
        }

        try {
          const blob = new Blob(audioChunksRef.current, {
            type: "audio/webm",
          });
          const arrayBuffer = await blob.arrayBuffer();

          const audioCtx = new OfflineAudioContext(1, 1, 16000);
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

          const wavBuffer = await audioBufferToWav(audioBuffer);
          const base64 = arrayBufferToBase64(wavBuffer);

          const response = await fetch("http://localhost:11434/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audio: base64,
              model: "whisper",
              language: "en",
            }),
            signal: AbortSignal.timeout(30_000),
          });

          if (!response.ok) {
            throw new Error(`Transcription failed: ${response.status}`);
          }

          const result = await response.json();
          const text = result.text ?? result.transcription ?? "";
          setTranscription(text);
          resolve(text);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Transcription failed";
          setError(message);
          resolve("");
        }
      };

      recorder.stop();
    });
  }, [isListening, cleanup]);

  const cancel = useCallback(() => {
    if (mediaRecorderRef.current && isListening) {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
    cleanup();
  }, [isListening, cleanup]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      cleanup();
    };
  }, [cleanup]);

  return {
    isListening,
    startListening,
    stopListening,
    cancel,
    transcription,
    error,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function audioBufferToWav(buffer: AudioBuffer): Promise<ArrayBuffer> {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const targetSampleRate = 16000;

  let resampledBuffer: AudioBuffer = buffer;

  if (sampleRate !== targetSampleRate) {
    const ratio = sampleRate / targetSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const offlineCtx = new OfflineAudioContext(
      numChannels,
      newLength,
      targetSampleRate,
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    resampledBuffer = await offlineCtx.startRendering();
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = resampledBuffer.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const wav = new ArrayBuffer(totalSize);
  const view = new DataView(wav);

  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(resampledBuffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < resampledBuffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return wav;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
