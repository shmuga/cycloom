import { describe, expect, it } from 'vitest';
import { AudioTape, encodeWav } from '../src/midi/wav';

describe('wav capture', () => {
  it('writes a valid 16-bit stereo PCM header and samples', () => {
    const l = Float32Array.from([0, 0.5, -0.5, 1, -1, 2]);
    const r = Float32Array.from([0, -0.25, 0.25, 0, 0, -2]);
    const w = encodeWav([l, r], 44100);
    const v = new DataView(w.buffer);
    const str = (o: number) => String.fromCharCode(...w.slice(o, o + 4));
    expect(str(0)).toBe('RIFF');
    expect(str(8)).toBe('WAVE');
    expect(str(36)).toBe('data');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(6 * 4);
    expect(v.getUint32(4, true)).toBe(w.length - 8);
    expect(v.getInt16(44 + 4, true)).toBe(Math.round(0.5 * 0x7fff)); // frame 1, left
    expect(v.getInt16(44 + 6, true)).toBe(Math.round(-0.25 * 0x8000)); // frame 1, right
    expect(v.getInt16(44 + 5 * 4, true)).toBe(0x7fff); // clipped
    expect(v.getInt16(44 + 5 * 4 + 2, true)).toBe(-0x8000);
  });

  it('joins blocks and trims silence, keeping a short tail', () => {
    const t = new AudioTape();
    const sr = 1000;
    const silent = () => [new Float32Array(500), new Float32Array(500)];
    t.push(silent());
    const loud = silent();
    loud[0][100] = 0.3;
    loud[1][400] = -0.2;
    t.push(loud);
    t.push(silent());
    t.push(silent());
    const [a, b] = t.join(sr);
    expect(a.length).toBe(301 + 250); // from first sound to last sound, plus 0.25 s tail
    expect(a[0]).toBeCloseTo(0.3);
    expect(b[300]).toBeCloseTo(-0.2);
    expect(new AudioTape().join(sr)[0].length).toBe(0);
  });
});
