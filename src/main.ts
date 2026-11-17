import './ui/styles.css';
import { Engine } from './engine/engine';
import { MidiAccess } from './midi/access';
import { Recorder } from './midi/capture';
import { ClockFollower, WakeLock, createTicker } from './midi/clock';
import { type ActionId, type MapHost, MidiMap, type Target } from './midi/midimap';
import { PreviewSynth } from './midi/preview';
import { OutputRouter } from './midi/router';
import { fromNorm, paramDef, toNorm } from './state/params';
import { Persist } from './state/persist';
import { codeFromHash } from './state/share';
import { Store } from './state/store';
import { defaultState } from './state/types';
import { App } from './ui/app';
import { installTips } from './ui/tips';

const persist = new Persist();
const saved = persist.loadState();
const store = new Store(saved ?? defaultState());
const router = new OutputRouter();
const recorder = new Recorder();
const preview = new PreviewSynth();
const follower = new ClockFollower();
const midi = new MidiAccess();
const wake = new WakeLock();

preview.isDrum = (i) => store.state.tracks[i]?.notes.kind === 'drum';
router.sinks.push(recorder, preview);

const engine = new Engine(store, router, recorder);

let app: App;

// ---------------------------------------------------------------- controller mapping host
const nowSec = () => performance.now() / 1000;
const resolve = (t: Target): { path: string; track: number } | null => {
  if (t.scope === 'focus') return { path: t.param, track: app.view === 'zoom' ? app.focus : app.focus };
  if (t.scope === 'track') return { path: t.param, track: t.track };
  if (t.scope === 'global') return { path: t.param, track: 0 };
  return null;
};

const host: MapHost = {
  getNorm(t) {
    const r = resolve(t);
    if (!r) return null;
    const def = paramDef(r.path, store.state, r.track);
    return def && store.state.tracks[r.track] ? toNorm(def, def.get(store.state, r.track)) : null;
  },
  setNorm(t, v) {
    const r = resolve(t);
    if (!r) return;
    const def = paramDef(r.path, store.state, r.track);
    if (!def || !store.state.tracks[r.track]) return;
    const val = fromNorm(def, v);
    if (val !== def.get(store.state, r.track)) store.update((s) => def.set(s, r.track, val), { coalesce: `midi:${r.path}:${r.track}` });
  },
  setOffset(key, v) {
    engine.offsets[key] = v;
  },
  action(a: ActionId, arg, pressed) {
    if (!pressed && a !== 'holdChord') return;
    const n = store.state.tracks.length;
    switch (a) {
      case 'play':
      case 'stop':
        app.togglePlay();
        break;
      case 'mute':
        app.toggleMute(arg ?? app.focus);
        break;
      case 'solo':
        app.toggleSolo(arg ?? app.focus);
        break;
      case 'snap':
        app.snap();
        break;
      case 'restore':
        app.restore(arg);
        break;
      case 'nextTrack':
        app.view === 'zoom' ? app.setFocus((app.focus + 1) % n) : app.zoom(app.focus);
        break;
      case 'prevTrack':
        app.view === 'zoom' ? app.setFocus((app.focus - 1 + n) % n) : app.zoom(app.focus);
        break;
      case 'holdChord':
        store.update((s) => (s.harmony.holdChord = pressed));
        break;
      case 'panic':
        app.panic();
        break;
    }
  },
};

const map = new MidiMap(host);
map.load(persist.mappings());

// ---------------------------------------------------------------- outputs & clock
function applyOutput(): void {
  const s = store.state;
  const out = midi.output(s.outputId);
  router.out = out;
  preview.enabled = !out;
  router.latencyMs = s.latencyMs;
  router.setTimestampMode(s.timestamped, midi.isShim);
  engine.sendClock = !!out;
  midi.bindInput(s.inputId);
}

follower.onStart = (t) => {
  if (store.state.clock !== 'external') return;
  const now = nowSec();
  engine.start(now, Math.max(now, t || now) + 0.01);
  void wake.acquire();
};
follower.onStop = () => {
  if (store.state.clock !== 'external') return;
  engine.stop(nowSec());
  void wake.release();
};

midi.onMessage = (port, data, t) => {
  if (store.state.clock === 'external') follower.message(data, t || nowSec());
  map.message(port, data);
};
midi.onPorts = () => {
  applyOutput();
  app?.update();
};

const ticker = createTicker(() => {
  const now = nowSec();
  if (store.state.clock === 'external' && follower.tempo && engine.playing) engine.followTempo(follower.tempo);
  engine.tick(now);
});

store.subscribe((s) => {
  engine.sync();
  applyOutput();
  persist.saveSoon(s);
});

// ---------------------------------------------------------------- boot
installTips();
app = new App(document.getElementById('app')!, { store, engine, router, recorder, preview, midi, map, persist, follower });

// share links: #s=… opens a shared setup, then the fragment is cleared so a reload keeps your own edits
const openShared = (): void => {
  const code = codeFromHash(location.hash);
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search);
  void app.loadShared(code);
};
openShared();
window.addEventListener('hashchange', openShared);
app.onPlay = () => void wake.acquire();
app.onStop = () => void wake.release();

ticker.start();
const loop = (t: number) => {
  app.frame(t);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

void midi.init().then((ok) => {
  if (ok && !saved) {
    const guess = midi.guessOutput();
    if (guess) store.update((s) => (s.outputId = guess), { undo: false });
  }
  applyOutput();
  app.update();
  if (!ok && midi.error) app.toast(midi.error);
});

// stop rendering cost when hidden; audio/MIDI keep going via the worker clock
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.playing) void wake.acquire();
});

// unlock audio on a gesture (iOS), and again after iOS suspends it (lock screen, app switch, call)
window.addEventListener('pointerdown', () => preview.resume());
window.addEventListener('touchend', () => preview.resume());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') preview.resume();
});

declare global {
  interface Window {
    nc?: { store: Store; engine: Engine; app: App; map: MidiMap; persist: Persist };
  }
}
window.nc = { store, engine, app, map, persist };
