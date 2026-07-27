export interface TranscriptionProvider {
  transcribe(audio: AudioBuffer | Float32Array, sampleRate?: number): Promise<string>;
  isAvailable(): Promise<boolean>;
}

import { GroqWhisperProvider } from "./groq-whisper.js";
import { LocalWhisperProvider } from "./local-whisper.js";

export { GroqWhisperProvider } from "./groq-whisper.js";
export { LocalWhisperProvider } from "./local-whisper.js";

const WHISPER_LOCAL_URL = "http://localhost:11434/api/transcribe";

export class WhisperLocalProvider implements TranscriptionProvider {
  private baseUrl: string;

  constructor(baseUrl = WHISPER_LOCAL_URL) {
    this.baseUrl = baseUrl;
  }

  async transcribe(audio: AudioBuffer): Promise<string> {
    const wavBuffer = await audioBufferToWav(audio);
    const base64 = arrayBufferToBase64(wavBuffer);

    const response = await fetch(this.baseUrl, {
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
      throw new Error(`Whisper transcription failed: ${response.status}`);
    }

    const result = await response.json();
    return result.text ?? result.transcription ?? "";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: "", model: "whisper" }),
        signal: AbortSignal.timeout(3000),
      });
      return response.ok || response.status === 422;
    } catch {
      return false;
    }
  }
}

export class WebSpeechFallbackProvider implements TranscriptionProvider {
  async transcribe(_audio: AudioBuffer): Promise<string> {
    return new Promise((_, reject) => {
      reject(
        new Error(
          "WebSpeechFallback is only available in browser context. Use LocalWhisperProvider for production.",
        ),
      );
    });
  }

  async isAvailable(): Promise<boolean> {
    return typeof window !== "undefined" && "webkitSpeechRecognition" in window;
  }
}

async function resolveProvider(): Promise<TranscriptionProvider> {
  // Priority 1: Groq whisper (fast, free tier, cloud)
  const groq = new GroqWhisperProvider();
  if (await groq.isAvailable()) {
    console.log("[voice] Using Groq whisper (cloud, fast)");
    return groq;
  }

  // Priority 2: Local whisper via @xenova/transformers (on-device)
  const localWhisper = new LocalWhisperProvider();
  if (await localWhisper.isAvailable()) {
    console.log("[voice] Using local Whisper (onnx)");
    return localWhisper;
  }

  // Priority 3: Ollama whisper endpoint (if available)
  const whisperOllama = new WhisperLocalProvider();
  if (await whisperOllama.isAvailable()) {
    console.log("[voice] Using Ollama whisper endpoint");
    return whisperOllama;
  }

  // Priority 4: Web Speech API (browser only, fallback)
  const webSpeech = new WebSpeechFallbackProvider();
  if (await webSpeech.isAvailable()) {
    console.log("[voice] Using WebSpeech API (fallback)");
    return webSpeech;
  }

  throw new Error(
    "No transcription provider available. Set GROQ_API_KEY env var for Groq whisper.",
  );
}

export async function createTranscriptionProvider(): Promise<TranscriptionProvider> {
  return resolveProvider();
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
  const format = 1; // PCM
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

export { audioBufferToWav };
