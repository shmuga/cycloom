/** 16-bit PCM WAV from planar float channels (−1…1). Peaks above full scale are clipped. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const nch = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytesPerFrame = nch * 2;
  const dataLen = frames * bytesPerFrame;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bytesPerFrame, true);
  v.setUint16(32, bytesPerFrame, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataLen, true);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[f] ?? 0));
      v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Collects audio blocks while recording, then joins them. */
export class AudioTape {
  private blocks: Float32Array[][] = [];
  frames = 0;

  push(block: Float32Array[]): void {
    this.blocks.push(block.map((ch) => ch.slice()));
    this.frames += block[0]?.length ?? 0;
  }

  /** Planar channels with leading/trailing silence trimmed (keeps a short tail). */
  join(sampleRate: number): Float32Array[] {
    const nch = this.blocks[0]?.length ?? 2;
    const out = Array.from({ length: nch }, () => new Float32Array(this.frames));
    let o = 0;
    for (const b of this.blocks) {
      for (let c = 0; c < nch; c++) out[c].set(b[c] ?? b[0], o);
      o += b[0].length;
    }
    const loud = (f: number) => out.some((ch) => Math.abs(ch[f]) > 1e-4);
    let a = 0;
    while (a < this.frames && !loud(a)) a++;
    let z = this.frames - 1;
    while (z > a && !loud(z)) z--;
    if (a >= this.frames) return out.map(() => new Float32Array(0));
    const end = Math.min(this.frames, z + 1 + Math.round(sampleRate * 0.25));
    return out.map((ch) => ch.slice(a, end));
  }
}
