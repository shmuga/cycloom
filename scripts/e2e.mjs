// End-to-end checks in real Chrome with a stubbed Web MIDI device.
// Usage: npm run e2e   (starts its own Vite server)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({ server: { port: 5399, strictPort: true }, logLevel: 'error' });
await server.listen();
const url = 'http://localhost:5399/';

// Fake MIDIAccess: one output (Model:Cycles) and one input (8mu) we can drive from the test.
const MIDI_STUB = () => {
  const sent = [];
  window.__sent = sent;
  const out = { id: 'out1', name: 'Elektron Model:Cycles', send: (d, ts) => sent.push({ d: Array.from(d), ts }), clear: () => sent.push({ d: ['clear'] }) };
  const inp = { id: 'in1', name: '8mu', onmidimessage: null };
  window.__midiIn = (bytes) => inp.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: performance.now() });
  const access = { outputs: new Map([['out1', out]]), inputs: new Map([['in1', inp]]), onstatechange: null };
  navigator.requestMIDIAccess = async () => access;
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};

async function newPage(w = 1440, h = 1000, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  await ctx.addInitScript(MIDI_STUB);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForTimeout(800);
  return { p, errors };
}

try {
  // ---------------------------------------------------------------- desktop
  const { p, errors } = await newPage();
  check('auto-selects the Model:Cycles output', (await p.textContent('.hdr-right .pill')).includes('Model:Cycles'));

  await p.click('button.play');
  await p.waitForTimeout(5000);
  const sent = await p.evaluate(() => window.__sent);
  const notes = sent.filter((m) => typeof m.d[0] === 'number' && (m.d[0] & 0xf0) === 0x90);
  const chans = new Set(notes.map((m) => (m.d[0] & 0x0f) + 1));
  check('sends MIDI start', sent.some((m) => m.d[0] === 0xfa));
  check('sends 24ppqn clock', sent.filter((m) => m.d[0] === 0xf8).length > 150);
  check('sends notes on several channels', chans.size >= 3, [...chans].join(','));
  check('shim detected → just-in-time sending (no timestamps)', notes.every((m) => m.ts === undefined));
  await p.evaluate(() => window.nc.store.update((s) => (s.timestamped = 'on'), { undo: false }));
  await p.evaluate(() => (window.__sent.length = 0));
  await p.waitForTimeout(1500);
  const tsNotes = await p.evaluate(() => window.__sent.filter((m) => (m.d[0] & 0xf0) === 0x90));
  check('timestamped mode schedules notes ahead of now', tsNotes.length > 0 && tsNotes.every((m) => typeof m.ts === 'number'), String(tsNotes.length));
  {
    await p.evaluate(() => window.nc.store.update((s) => (s.timestamped = 'off'), { undo: false }));
    await p.evaluate(() => (window.__sent.length = 0));
    await p.waitForTimeout(3000);
    await p.click('button.play'); // stop
    const all = await p.evaluate(() => window.__sent.filter((m) => typeof m.d[0] === 'number'));
    const lastOn = new Map();
    const lastOff = new Map();
    all.forEach((m, i) => {
      const k = `${m.d[0] & 15}:${m.d[1]}`;
      if ((m.d[0] & 0xf0) === 0x90) lastOn.set(k, i);
      if ((m.d[0] & 0xf0) === 0x80) lastOff.set(k, i);
    });
    const hanging = [...lastOn].filter(([k, i]) => !((lastOff.get(k) ?? -1) > i));
    check('after stop, every sounding note received a note-off', lastOn.size > 0 && hanging.length === 0, JSON.stringify(hanging));
    await p.click('button.play'); // play again
    await p.waitForTimeout(3000);
  }
  check('bar readout advances', /bar [2-9]/.test(await p.textContent('.transport .sub')));
  check('elapsed time runs', (await p.textContent('.journey .time')) !== '0:00:00');

  // mute via card button
  await p.click('.card >> nth=0 >> button:has-text("M")');
  check('mute button toggles state', await p.evaluate(() => window.nc.store.state.tracks[0].mute));
  check('muted card dims', await p.locator('.card.muted').count() === 1);

  // zoom by clicking a card
  await p.click('.card >> nth=3');
  await p.waitForTimeout(800);
  check('card click zooms into the track', await p.evaluate(() => document.body.dataset.view === 'zoom' && window.nc.app.focus === 3));
  check('zoom title shows 04 wind', (await p.textContent('.crumbs .tname')).replace(/\s+/g, ' ').trim() === '04 wind');

  // fader drag (relative)
  const before = await p.evaluate(() => window.nc.store.state.tracks[3].macros.intensity);
  const bar = p.locator('.col-motion .fb').first();
  const box = await bar.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height - 10 - box.height * 0.25, { steps: 6 });
  await p.mouse.up();
  const after = await p.evaluate(() => window.nc.store.state.tracks[3].macros.intensity);
  check('fader drag is relative and moves the value up', after > before + 0.15 && after < before + 0.35, `${before} → ${after}`);
  await p.dblclick('.col-motion .fb >> nth=0');
  check('double-click resets fader to default', (await p.evaluate(() => window.nc.store.state.tracks[3].macros.intensity)) === 0.5);
  await p.keyboard.press('Meta+z');
  check('undo restores previous value', Math.abs((await p.evaluate(() => window.nc.store.state.tracks[3].macros.intensity)) - after) < 1e-9);

  // mode switch & drum toggle
  await p.click('.col-mode .chips button:has-text("orbits")');
  check('mode chip switches the voice', await p.evaluate(() => window.nc.engine.voices[3].mode === 'orbits'));
  await p.click('.col-notes .seg button:has-text("drum")');
  check('notes column switches to drum settings', (await p.locator('.col-notes .bl:has-text("base note")').count()) === 1);
  await p.selectOption('.col-midi select[aria-label="channel"]', '9');
  check('channel box changes channel', await p.evaluate(() => window.nc.store.state.tracks[3].midi.channel === 9));

  // tab jump + keyboard
  await p.click('.tabs .tab:has-text("02")');
  check('track tabs move focus', await p.evaluate(() => window.nc.app.focus === 1));
  await p.keyboard.press('Escape');
  check('Esc returns to the island', await p.evaluate(() => document.body.dataset.view === 'overview'));

  // island click zoom
  const canvas = await p.locator('.island-wrap canvas').boundingBox();
  const hit = await p.evaluate(({ w, h }) => {
    for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 6) if (window.nc.app['overview'].pick(x, y) === 5) return { x, y };
    return null;
  }, { w: canvas.width, h: canvas.height });
  await p.mouse.click(canvas.x + hit.x, canvas.y + hit.y);
  await p.waitForTimeout(300);
  check('clicking a plinth zooms into it', await p.evaluate(() => window.nc.app.focus === 5 && document.body.dataset.view === 'zoom'));
  await p.click('.crumbs button:has-text("island")');

  // harmony band controls
  await p.click('.band .settings [aria-label="Hold"] button:has-text("chord")');
  check('hold chord toggles', await p.evaluate(() => window.nc.store.state.harmony.holdChord));
  await p.click('.band .settings [aria-label="Hold"] button:has-text("chord")');
  await p.click('.band .settings .cyc:has-text("chord every")');
  check('chord length cycles', await p.evaluate(() => window.nc.store.state.harmony.barsPerChord === 4));
  await p.click('.band .drift .rel');
  check('relation cycles', await p.evaluate(() => window.nc.store.state.harmony.relation === 'brightness'));
  await p.waitForTimeout(4000);
  const histCount = await p.locator('.band .hist button').count();
  check('history dots appear as chords change', histCount >= 1, String(histCount));
  if (histCount) {
    await p.click('.band .hist button >> nth=0');
    check('clicking history requests a rewind', await p.evaluate(() => window.nc.engine.harmony.rewindPending || document.querySelector('.toast')?.textContent.startsWith('back to')));
  }

  // snap / restore
  await p.click('.hdr-right [aria-label="Snap"]');
  await p.evaluate(() => window.nc.store.update((s) => (s.bpm = 90)));
  await p.click('.snap-pill .restore-dots button.full');
  check('restore brings back the snapped state', await p.evaluate(() => window.nc.store.state.bpm === 112));
  await p.evaluate(() => window.nc.store.update((s) => (s.bpm = 91)));
  await p.click('.hdr-right [aria-label="Restore last snap"]');
  await p.waitForTimeout(2500);
  check('restore icon brings back the last snap', await p.evaluate(() => window.nc.store.state.bpm === 112));

  // MIDI learn with the 8mu
  await p.evaluate(() => window.nc.store.update((s) => (s.inputId = 'in1'), { undo: false }));
  await p.keyboard.press('l');
  check('L enters learn mode', await p.evaluate(() => document.body.classList.contains('learning')));
  await p.click('.journey .fb >> nth=0');
  await p.evaluate(() => window.__midiIn([0xb0, 34, 10]));
  check('learn binds the incoming CC', await p.evaluate(() => window.nc.map.mappings.some((m) => m.src.num === 34 && m.target.param === 'journey.pace')));
  await p.keyboard.press('Escape');
  const pace0 = await p.evaluate(() => window.nc.store.state.journey.pace);
  await p.evaluate(() => window.__midiIn([0xb0, 34, 5]));
  check('pickup: far-away CC does not jump the value', (await p.evaluate(() => window.nc.store.state.journey.pace)) === pace0);
  check('ghost line shows hardware position', await p.locator('.journey .fd >> nth=0 >> .ghost:not([hidden])').count() === 1);
  await p.evaluate(() => window.__midiIn([0xb0, 34, 120]));
  check('pickup: crossing the value takes over', Math.abs((await p.evaluate(() => window.nc.store.state.journey.pace)) - 120 / 127) < 0.011);
  check('mapped fader shows a badge', (await p.textContent('.journey .fd >> nth=0 >> .badge')).includes('CC 34'));

  // external clock
  await p.evaluate(() => window.nc.app.setClock('external'));
  await p.evaluate(async () => {
    window.__midiIn([0xfa]);
    for (let i = 0; i < 48; i++) {
      window.__midiIn([0xf8]);
      await new Promise((r) => setTimeout(r, 1000 * (60 / 100 / 24)));
    }
  });
  const ext = await p.evaluate(() => ({ playing: window.nc.engine.playing, bpm: 60 / window.nc.engine.beatSec }));
  check('external clock start begins playback', ext.playing);
  check('external clock tempo is followed (~100 bpm)', Math.abs(ext.bpm - 100) < 8, String(ext.bpm));
  await p.evaluate(() => window.__midiIn([0xfc]));
  check('external stop stops playback', !(await p.evaluate(() => window.nc.engine.playing)));
  await p.evaluate(() => window.nc.app.setClock('internal'));

  // capture
  await p.click('button.play');
  await p.click('.hdr-right [aria-label="Record"]');
  await p.waitForTimeout(2500);
  const dl = p.waitForEvent('download');
  await p.click('.hdr-right [aria-label="Record"]');
  const file = await dl;
  check('rec stops into a .mid download', file.suggestedFilename().endsWith('.mid'), file.suggestedFilename());

  // with no device, rec records the sine preview to .wav
  await p.click('button.play');
  const outBefore = await p.evaluate(() => window.nc.store.state.outputId);
  await p.evaluate(() => window.nc.app.selectOutput(''));
  await p.waitForTimeout(200);
  check('rec says it will record audio without a device', (await p.textContent('.hdr-right [aria-label="Record"]')).includes('wav'));
  await p.click('.hdr-right [aria-label="Record"]');
  await p.waitForTimeout(3500);
  const dlw = p.waitForEvent('download');
  await p.click('.hdr-right [aria-label="Record"]');
  const wavFile = await dlw;
  const wavPath = await wavFile.path();
  const { readFileSync } = await import('node:fs');
  const wavBytes = readFileSync(wavPath);
  const peak = (() => { let m = 0; for (let i = 44; i + 1 < wavBytes.length; i += 2) m = Math.max(m, Math.abs(wavBytes.readInt16LE(i))); return m; })();
  check('without a device rec saves a .wav with sound in it', wavFile.suggestedFilename().endsWith('.wav') && wavBytes.toString('ascii', 0, 4) === 'RIFF' && peak > 500, `${wavFile.suggestedFilename()} ${wavBytes.length}B peak ${peak}`);
  await p.click('button.play');
  await p.evaluate((id) => window.nc.app.selectOutput(id), outBefore);

  // panic
  await p.click('.hdr-right [aria-label="More"]');
  await p.click('.sheet button:has-text("panic")');
  await p.keyboard.press('Escape');
  check('panic sends all-notes-off on 16 channels', (await p.evaluate(() => window.__sent.filter((m) => (m.d[0] & 0xf0) === 0xb0 && m.d[1] === 123).length)) >= 16);

  // add / remove plinth
  await p.click('button:has-text("+ add plinth")');
  check('add plinth adds a 7th track', (await p.locator('.card').count()) === 7);
  await p.waitForTimeout(200);
  check('the island grows a third row', await p.evaluate(() => window.nc.app['overview'].layout.d === 10));
  await p.click('.card >> nth=6');
  await p.click('button:has-text("remove plinth")');
  check('remove plinth removes it', await p.evaluate(() => window.nc.store.state.tracks.length === 6));

  // randomise
  if (await p.evaluate(() => document.body.dataset.view === 'zoom')) await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const beforeRnd = await p.evaluate(() => JSON.stringify(window.nc.store.state.tracks.map((t) => [t.mode, t.notes])));
  await p.click('.hdr-right [aria-label="Randomise tracks"]');
  const rnd = await p.evaluate(() => {
    const ts = window.nc.store.state.tracks;
    return { json: JSON.stringify(ts.map((t) => [t.mode, t.notes])), drums: ts.filter((t) => t.notes.kind === 'drum').length, mel: ts.filter((t) => t.notes.kind === 'tonal').length, n: ts.length };
  });
  check('randomise makes a new setup of 2+ drum and 2+ melodic voices', rnd.json !== beforeRnd && rnd.drums >= 2 && rnd.mel >= 2 && rnd.n === 6, JSON.stringify({ d: rnd.drums, m: rnd.mel }));
  if (!(await p.evaluate(() => window.nc.engine.playing))) await p.click('button.play');
  const sent0 = await p.evaluate(() => window.__sent.length);
  await p.waitForTimeout(3000);
  check('the random setup plays notes', (await p.evaluate((n) => window.__sent.slice(n).filter((m) => (m.d[0] & 0xf0) === 0x90 && m.d[2] > 0).length, sent0)) > 0);
  await p.keyboard.press('Meta+z');
  check('undo brings the previous tracks back', (await p.evaluate(() => JSON.stringify(window.nc.store.state.tracks.map((t) => [t.mode, t.notes])))) === beforeRnd);
  await p.click('button.play');

  // presets
  await p.click('.hdr-right [aria-label="Presets"]');
  await p.click('.sheet .preset:has-text("airports")');
  const air = await p.evaluate(() => ({ bpm: window.nc.store.state.bpm, n: window.nc.store.state.tracks.length, swell: window.nc.store.state.tracks.every((t) => t.life.swell > 0.5), out: window.nc.store.state.outputId }));
  check('airports preset loads (60 bpm, swelling tonal loops, port kept)', air.bpm === 60 && air.n === 6 && air.swell && air.out !== '', JSON.stringify(air));
  await p.click('.hdr-right [aria-label="Presets"]');
  await p.click('.sheet .preset:has-text("drone")');
  await p.click('button.play');
  const sentD = await p.evaluate(() => window.__sent.length);
  await p.waitForTimeout(9000); // ambient: voices enter over several seconds
  check('drone preset plays', (await p.evaluate((n) => window.__sent.slice(n).filter((m) => (m.d[0] & 0xf0) === 0x90 && m.d[2] > 0).length, sentD)) > 0);
  await p.click('button.play');
  await p.keyboard.press('Meta+z');
  await p.keyboard.press('Meta+z');
  check('undo walks back through presets', await p.evaluate(() => window.nc.store.state.bpm === 112));

  // save / load scenes
  await p.click('.hdr-right [aria-label="More"]');
  await p.click('.sheet button:has-text("save scene")');
  await p.fill('.sheet input[aria-label="Scene name"]', 'dusk');
  await p.click('.sheet button.on:has-text("save scene")');
  check('save scene stores a named scene', await p.evaluate(() => 'dusk' in window.nc.persist.scenes()));
  const bpmSaved = await p.evaluate(() => window.nc.store.state.bpm);
  await p.evaluate(() => window.nc.store.update((s) => (s.bpm = 77)));
  await p.click('.hdr-right [aria-label="More"]');
  await p.click('.sheet button:has-text("load scene")');
  await p.click('.sheet .scene:has-text("dusk") button:has-text("load")');
  check('load scene restores it', await p.evaluate((b) => window.nc.store.state.bpm === b, bpmSaved));

  // tooltips: every control explains itself
  const untipped = async () =>
    p.evaluate(() =>
      [...document.querySelectorAll('header button, header .readout, .band button, .journey .fd, .strip-head button, .card .ms, .crumbs button, .panel .fd, .panel .box, .panel .seg, .panel .chips button, .panel .steps')]
        .filter((el) => el.offsetParent && !el.closest('[data-tip]'))
        .map((el) => el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20)),
    );
  const missOver = await untipped();
  check('every overview control has a tooltip', missOver.length === 0, missOver.join(', '));
  await p.evaluate(() => window.nc.app.zoom(2));
  await p.waitForTimeout(400);
  const missZoom = await untipped();
  check('every zoomed-track control has a tooltip', missZoom.length === 0, missZoom.join(', '));
  await p.hover('.col-motion .fd >> nth=2');
  await p.waitForTimeout(700);
  const tipText = await p.evaluate(() => { const t = document.querySelector('.tipbox'); return t && !t.hidden ? t.textContent : ''; });
  check('hovering a fader shows a mode-specific tip', /stair slope/.test(tipText), tipText);
  await p.mouse.move(5, 5);
  await p.waitForTimeout(300);
  check('the tip hides when the mouse leaves', await p.evaluate(() => document.querySelector('.tipbox').hidden));
  await p.keyboard.press('Escape');

  // share link
  await p.evaluate(() => window.nc.store.update((s) => { s.bpm = 73; s.tracks[1].macros.color = 0.91; }));
  await p.click('.hdr-right [aria-label="Share link"]');
  const link = await p.inputValue('.sheet input[aria-label="Share link"]');
  check('share makes a #s= link', /#s=[bc][A-Za-z0-9_-]+$/.test(link) && link.length < 320, link.slice(0, 60));
  await p.keyboard.press('Escape');
  const other = await newPage();
  await other.p.goto(link);
  await other.p.waitForTimeout(1200);
  const got = await other.p.evaluate(() => ({ bpm: window.nc.store.state.bpm, c: window.nc.store.state.tracks[1].macros.color, hash: location.hash }));
  check('opening the link loads the shared setup and clears the hash', got.bpm === 73 && got.c === 0.91 && got.hash === '', JSON.stringify(got));
  await other.p.context().close();

  // persistence across reload
  await p.evaluate(() => window.nc.store.update((s) => (s.journey.weather = 0.77)));
  await p.waitForTimeout(600);
  await p.reload();
  await p.waitForTimeout(800);
  check('state persists across reload', await p.evaluate(() => window.nc.store.state.journey.weather === 0.77));
  check('mappings persist across reload', await p.evaluate(() => window.nc.map.mappings.length >= 1));
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));

  // ---------------------------------------------------------------- phone
  const m = await newPage(390, 844, true);
  const overflow = await m.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('phone: no horizontal page scroll', overflow <= 0, String(overflow));
  const tooSmall = await m.p.evaluate(() =>
    [...document.querySelectorAll('button, [role=button]')]
      .filter((b) => b.offsetParent && getComputedStyle(b).display !== 'none')
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width > 0 && (r.width < 44 || r.height < 44)).length,
  );
  check('phone: visible buttons are at least 44px (except history dots)', tooSmall <= 3, String(tooSmall));
  await m.p.tap('.card >> nth=1');
  await m.p.waitForTimeout(800);
  check('phone: tap card zooms', await m.p.evaluate(() => document.body.dataset.view === 'zoom'));
  check('phone: Motion tab shows 4 faders', (await m.p.locator('.col-motion .fd:visible').count()) === 4);
  await m.p.tap('.tabbar button:has-text("MIDI")');
  check('phone: tabs switch columns', await m.p.locator('.col-midi').isVisible());
  // swipe the stage
  const st = await m.p.locator('.stage canvas').boundingBox();
  await m.p.evaluate(({ x, y }) => {
    const c = document.querySelector('.stage canvas');
    const ev = (type, cx) => c.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: y, bubbles: true, pointerType: 'touch' }));
    ev('pointerdown', x + 250);
    ev('pointerup', x + 100);
  }, { x: st.x, y: st.y + 150 });
  check('phone: swipe moves to the next track', await m.p.evaluate(() => window.nc.app.focus === 2));
  // fader touch drag
  await m.p.tap('.tabbar button:has-text("Motion")');
  const fb = await m.p.locator('.col-motion .fb').first().boundingBox();
  const v0 = await m.p.evaluate(() => window.nc.store.state.tracks[2].macros.intensity);
  await m.p.evaluate(({ x, y, h }) => {
    const el = document.querySelectorAll('.col-motion .fb')[0];
    const ev = (type, cy) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: cy, bubbles: true, pointerType: 'touch', pointerId: 7 }));
    ev('pointerdown', y + h - 20);
    ev('pointermove', y + h - 20 - h * 0.2);
    ev('pointerup', y + h - 20 - h * 0.2);
  }, { x: fb.x + fb.width / 2, y: fb.y, h: fb.height });
  const v1 = await m.p.evaluate(() => window.nc.store.state.tracks[2].macros.intensity);
  check('phone: touch drag on fader changes value', v1 > v0 + 0.1, `${v0} → ${v1}`);
  // tap a label → explanation, value untouched
  const colorBefore = await m.p.evaluate(() => window.nc.store.state.tracks[2].macros.color);
  await m.p.tap('.col-motion .fd >> nth=1 >> .fl');
  await m.p.waitForTimeout(200);
  const mtip = await m.p.evaluate(() => { const t = document.querySelector('.tipbox'); return t && !t.hidden ? t.textContent : ''; });
  check('phone: tapping a fader label shows its tip', /pitch pool/.test(mtip), mtip);
  check('phone: tapping the label does not change the value', (await m.p.evaluate(() => window.nc.store.state.tracks[2].macros.color)) === colorBefore);
  await m.p.tap('.tabbar button:has-text("MIDI")');
  await m.p.tap('.col-midi .box >> nth=1 >> .bl');
  await m.p.waitForTimeout(200);
  const btip = await m.p.evaluate(() => { const t = document.querySelector('.tipbox'); return t && !t.hidden ? t.textContent : ''; });
  check('phone: tapping a box label shows its tip (not the picker)', /Grid size/.test(btip), btip);
  check('no page errors (phone)', m.errors.length === 0, m.errors.join(' | '));
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
