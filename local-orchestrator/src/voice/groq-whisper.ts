/**
 * Groq Whisper provider — fast cloud transcription via Groq API
 * Uses whisper-large-v3-turbo model
 * API: https://console.groq.com
 */
import type { TranscriptionProvider } from "./transcription-provider.js";

export class GroqWhisperProvider implements TranscriptionProvider {
  private apiKey: string;
  private model = "whisper-large-v3-turbo";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GROQ_API_KEY || "";
  }

  readonly name = "groq-whisper";

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async transcribe(audio: Float32Array, sampleRate: number = 16000): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Groq API key not configured. Set GROQ_API_KEY env var.");
    }

    const wavBlob = this.float32ToWavBlob(audio, sampleRate);

    const formData = new FormData();
    formData.append("file", wavBlob, "audio.wav");
    formData.append("model", this.model);
    formData.append("temperature", "0");
    formData.append("response_format", "verbose_json");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Groq transcription failed: ${response.status} ${JSON.stringify(err)}`);
    }

    const result = await response.json();
    return result.text ?? "";
  }

  async transcribeBuffer(buffer: ArrayBuffer): Promise<string> {
    const view = new DataView(buffer);
    const numSamples = (buffer.byteLength - 44) / 2;
    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const offset = 44 + i * 2;
      if (offset + 2 <= buffer.byteLength) {
        const int16 = view.getInt16(offset, true);
        samples[i] = int16 / 32768.0;
      }
    }

    return this.transcribe(samples, 16000);
  }

  private float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
    const numChannels = 1;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = samples.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    this.writeString(view, 0, "RIFF");
    view.setUint32(4, totalSize - 8, true);
    this.writeString(view, 8, "WAVE");
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}
