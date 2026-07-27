const WS_URL = "ws://localhost:8081";
const RECONNECT_DELAY = 3000;

interface VoiceTranscriptionMessage {
  type: "voice:transcription";
  text: string;
  confidence: number;
}

interface VoiceAcknowledgement {
  type: "voice:ack";
  received: boolean;
}

export class VoiceWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResolve: ((value: boolean) => void) | null = null;

  constructor(url = WS_URL) {
    this.url = url;
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(this.url);

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "voice:ack" && this.pendingResolve) {
          this.pendingResolve(data.received);
          this.pendingResolve = null;
        }
      } catch {
        // ignore non-voice messages
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, RECONNECT_DELAY);
  }

  sendTranscription(text: string, confidence = 1.0): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve(false);
        return;
      }

      this.pendingResolve = resolve;
      const message: VoiceTranscriptionMessage = {
        type: "voice:transcription",
        text,
        confidence,
      };
      this.ws.send(JSON.stringify(message));

      setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
        }
      }, 5000);
    });
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
  }
}
