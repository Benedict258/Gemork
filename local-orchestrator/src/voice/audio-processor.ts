const WHISPER_SAMPLE_RATE = 16000;

export class AudioProcessor {
  private targetSampleRate = WHISPER_SAMPLE_RATE;

  async processAudioChunk(chunk: ArrayBuffer): Promise<AudioBuffer> {
    const audioCtx = new OfflineAudioContext(1, 1, this.targetSampleRate);
    const audioBuffer = await audioCtx.decodeAudioData(chunk);
    return this.resampleToTarget(audioBuffer);
  }

  private async resampleToTarget(buffer: AudioBuffer): Promise<AudioBuffer> {
    if (buffer.sampleRate === this.targetSampleRate) {
      return buffer;
    }

    const ratio = buffer.sampleRate / this.targetSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const offlineCtx = new OfflineAudioContext(
      buffer.numberOfChannels,
      newLength,
      this.targetSampleRate,
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    return offlineCtx.startRendering();
  }

  trimSilence(buffer: AudioBuffer): AudioBuffer {
    const threshold = 0.01;
    const channelData = buffer.getChannelData(0);

    let start = 0;
    while (start < channelData.length && Math.abs(channelData[start]) < threshold) {
      start++;
    }

    let end = channelData.length - 1;
    while (end > start && Math.abs(channelData[end]) < threshold) {
      end--;
    }

    end++;

    if (start === 0 && end === channelData.length) {
      return buffer;
    }

    const trimmedLength = Math.max(0, end - start);
    if (trimmedLength === 0) {
      const offlineCtx = new OfflineAudioContext(
        buffer.numberOfChannels,
        1,
        buffer.sampleRate,
      );
      const empty = offlineCtx.createBuffer(1, 1, buffer.sampleRate);
      return empty;
    }

    const offlineCtx = new OfflineAudioContext(
      buffer.numberOfChannels,
      trimmedLength,
      buffer.sampleRate,
    );
    const trimmed = offlineCtx.createBuffer(
      buffer.numberOfChannels,
      trimmedLength,
      buffer.sampleRate,
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const sourceData = buffer.getChannelData(ch);
      const destData = trimmed.getChannelData(ch);
      for (let i = 0; i < trimmedLength; i++) {
        destData[i] = sourceData[start + i];
      }
    }

    return trimmed;
  }
}

export async function audioBufferToWav(buffer: AudioBuffer): Promise<ArrayBuffer> {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let resampledBuffer: AudioBuffer = buffer;

  if (sampleRate !== WHISPER_SAMPLE_RATE) {
    const ratio = sampleRate / WHISPER_SAMPLE_RATE;
    const newLength = Math.round(buffer.length / ratio);
    const offlineCtx = new OfflineAudioContext(
      numChannels,
      newLength,
      WHISPER_SAMPLE_RATE,
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
  view.setUint32(24, WHISPER_SAMPLE_RATE, true);
  view.setUint32(28, WHISPER_SAMPLE_RATE * blockAlign, true);
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

export function trimSilence(buffer: AudioBuffer): AudioBuffer {
  const processor = new AudioProcessor();
  return processor.trimSilence(buffer);
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
