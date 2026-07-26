import { AudioProcessor, audioBufferToWav, trimSilence } from "./audio-processor.js";
import {
  type TranscriptionProvider,
  createTranscriptionProvider,
} from "./transcription-provider.js";

export class VoiceHandler {
  private provider: TranscriptionProvider | null = null;
  private processor: AudioProcessor;
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private _isListening = false;
  private audioContext: AudioContext | null = null;

  constructor() {
    this.processor = new AudioProcessor();
  }

  private async ensureProvider(): Promise<TranscriptionProvider> {
    if (!this.provider) {
      this.provider = await createTranscriptionProvider();
    }
    return this.provider;
  }

  async startListening(): Promise<void> {
    if (this._isListening) {
      return;
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    });

    this.audioChunks = [];
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: "audio/webm;codecs=opus",
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start(100);
    this._isListening = true;
  }

  async stopListening(): Promise<string> {
    if (!this._isListening || !this.mediaRecorder) {
      return "";
    }

    return new Promise<string>((resolve, reject) => {
      const recorder = this.mediaRecorder!;

      recorder.onstop = async () => {
        try {
          this._isListening = false;

          if (this.audioChunks.length === 0) {
            resolve("");
            return;
          }

          const blob = new Blob(this.audioChunks, { type: "audio/webm" });
          const arrayBuffer = await blob.arrayBuffer();

          const audioCtx = new OfflineAudioContext(1, 1, 16000);
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

          const trimmedBuffer = trimSilence(audioBuffer);

          const provider = await this.ensureProvider();
          const text = await provider.transcribe(trimmedBuffer);
          resolve(text);
        } catch (error) {
          reject(error);
        } finally {
          this.cleanup();
        }
      };

      recorder.stop();
    });
  }

  cancel(): void {
    if (this.mediaRecorder && this._isListening) {
      this.mediaRecorder.stop();
    }
    this._isListening = false;
    this.audioChunks = [];
    this.cleanup();
  }

  isListening(): boolean {
    return this._isListening;
  }

  private cleanup(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.mediaRecorder = null;
  }
}
