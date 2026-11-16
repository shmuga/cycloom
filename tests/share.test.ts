import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/state/presets';
import { randomSetup } from '../src/state/randomise';
import { SHARED_TRACK_FIELDS, codeFromHash, decodeShare, encodeShare, packState, shareURL, shareable } from '../src/state/share';
import { type AppState, defaultState, makeTrack } from '../src/state/types';

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deflate = async (b: Uint8Array) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

function samples(): [string, AppState][] {
  const out: [string, AppState][] = PRESETS.map((p) => [p.id, p.build()]);
  for (let seed = 1; seed <= 40; seed++) {
    const s = defaultState();
    s.tracks = randomSetup(seed, 3 + (seed % 7)).tracks;
    s.bpm = 60 + seed * 1.37;
    s.bpm = Math.round(s.bpm * 100) / 100;
    s.harmony.seed = seed * 2654435761 >>> 0;
    s.harmony.holdScale = seed % 2 === 0;
    out.push([`random ${seed}`, s]);
  }
  return out;
}

describe('share links', () => {
  it('round-trip every preset and random setup exactly', async () => {
    for (const [name, s] of samples()) {
      const code = await encodeShare(s);
      expect(code, name).toMatch(/^[bc][A-Za-z0-9_-]+$/);
      const back = await decodeShare(code);
      expect(back && shareable(back), name).toEqual(shareable(s));
    }
  });

  it('are short: a six-track setup fits in about 250 characters (was ~1000 as JSON)', async () => {
    for (const p of PRESETS) {
      const code = await encodeShare(p.build());
      expect(code.length, p.id).toBeLessThan(270);
    }
    expect(packState(defaultState()).length).toBeLessThan(250);
  });

  it('still open old (v1, deflated JSON) links', async () => {
    const s = PRESETS[0].build();
    const old = 'z' + b64url(await deflate(new TextEncoder().encode(JSON.stringify(shareable(s)))));
    const back = await decodeShare(old);
    expect(back && shareable(back)).toEqual(shareable(s));
  });

  it('cover every state field (fails when a new field is added but not shared)', () => {
    const s = defaultState();
    const t = makeTrack(0);
    const F = SHARED_TRACK_FIELDS;
    expect(Object.keys(s).sort()).toEqual([...F.state].sort());
    expect(Object.keys(s.harmony).sort()).toEqual([...F.harmony].sort());
    expect(Object.keys(s.journey).sort()).toEqual([...F.journey].sort());
    expect(Object.keys(t).sort()).toEqual([...F.top].sort());
    for (const k of ['macros', 'notes', 'midi', 'life', 'listen'] as const) expect(Object.keys(t[k]).sort(), k).toEqual([...F[k]].sort());
  });

  it('leave device settings out and keep the receiver’s own', async () => {
    const s = defaultState();
    s.outputId = 'my-cycles';
    s.inputId = 'my-8mu';
    s.latencyMs = 12;
    s.clock = 'external';
    s.tracks[2].mute = true;
    const code = await encodeShare(s);
    const plain = await decodeShare(code);
    expect(plain?.outputId).toBe('');
    expect(plain?.clock).toBe('internal');
    expect(plain?.tracks[2].mute).toBe(false);
    const theirs = await decodeShare(code, { outputId: 'their-port', inputId: '', clock: 'internal', timestamped: 'off', latencyMs: 3 });
    expect(theirs?.outputId).toBe('their-port');
    expect(theirs?.latencyMs).toBe(3);
    expect(new Set(theirs?.tracks.map((x) => x.id)).size).toBe(s.tracks.length);
  });

  it('reject junk and find the code in a hash', async () => {
    expect(await decodeShare('zNOTVALID')).toBe(null);
    expect(await decodeShare('bAAAA')).toBe(null);
    expect(await decodeShare('qabc')).toBe(null);
    const good = await encodeShare(defaultState());
    expect(await decodeShare(good.slice(0, good.length - 6))).toBe(null);
    expect(codeFromHash('#s=zAbC-_9')).toBe('zAbC-_9');
    expect(codeFromHash('#x=1&s=jQQ')).toBe('jQQ');
    expect(codeFromHash('#nothing')).toBe(null);
    expect(shareURL('https://x.test/app/?a=1#old', 'zQ')).toBe('https://x.test/app/?a=1#s=zQ');
  });
});
