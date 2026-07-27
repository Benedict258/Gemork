/**
 * Local Whisper provider using faster-whisper (Python subprocess)
 * Runs whisper-large-v3-turbo entirely on-device
 * No API, no cloud, fully local
 */
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import type { TranscriptionProvider } from "./transcription-provider.js";

export class LocalWhisperProvider implements TranscriptionProvider {
  private serverProcess: ChildProcess | null = null;
  private serverPort = 8765;
  private serverReady = false;
  private starting = false;

  readonly name = "local-whisper";

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`http://127.0.0.1:${this.serverPort}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        this.serverReady = true;
        return true;
      }
    } catch {
      // Server not running — try to start it
    }

    if (this.starting) return false;
    return this.startServer();
  }

  private async startServer(): Promise<boolean> {
    this.starting = true;
    try {
      const venvPython = path.resolve(
        process.env.HOME || "/home/ubuntu",
        "Workspace/Gemork/.venv/bin/python3"
      );
      const scriptPath = path.resolve(
        process.env.PROJECT_ROOT || process.cwd(),
        "whisper-server.py"
      );

      console.log("[whisper] Starting local whisper server...");
      this.serverProcess = spawn(venvPython, [scriptPath, String(this.serverPort)], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      this.serverProcess.stdout?.on("data", (data: Buffer) => {
        const msg = data.toString();
        console.log("[whisper]", msg.trim());
        if (msg.includes("Listening on")) {
          this.serverReady = true;
        }
      });

      this.serverProcess.stderr?.on("data", (data: Buffer) => {
        console.error("[whisper]", data.toString().trim());
      });

      this.serverProcess.on("exit", () => {
        this.serverReady = false;
        this.serverProcess = null;
        console.log("[whisper] Server exited");
      });

      // Wait for server to be ready (up to 30s for model loading)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (this.serverReady) {
          console.log("[whisper] Server ready");
          return true;
        }
      }

      console.error("[whisper] Server failed to start within 30s");
      return false;
    } catch (err: any) {
      console.error("[whisper] Failed to start server:", err.message);
      return false;
    } finally {
      this.starting = false;
    }
  }

  async transcribe(audio: Float32Array, sampleRate: number = 16000): Promise<string> {
    if (!this.serverReady) {
      throw new Error("Whisper server not ready");
    }

    // Convert Float32Array to WAV base64
    const wavBase64 = this.float32ToWavBase64(audio, sampleRate);

    const response = await fetch(`http://127.0.0.1:${this.serverPort}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: wavBase64,
        language: "en",
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Whisper transcription failed: ${response.status}`);
    }

    const result = await response.json();
    return result.text ?? "";
  }

  async transcribeBuffer(buffer: ArrayBuffer): Promise<string> {
    // Convert ArrayBuffer (WAV) to Float32Array
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

  private float32ToWavBase64(samples: Float32Array, sampleRate: number): string {
    const numChannels = 1;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = samples.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = Buffer.alloc(totalSize);
    const view = new DataView(buffer.buffer);

    // RIFF header
    buffer.write("RIFF", 0);
    view.setUint32(4, totalSize - 8, true);
    buffer.write("WAVE", 8);

    // fmt chunk
    buffer.write("fmt ", 12);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    // data chunk
    buffer.write("data", 36);
    view.setUint32(40, dataSize, true);

    // Write samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }

    return buffer.toString("base64");
  }

  stop(): void {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
      this.serverReady = false;
    }
  }
}
