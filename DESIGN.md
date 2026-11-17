# Cycloom — design

A single-page web app that drives any MIDI device (ideally a multitimbral one) over Web MIDI with generative sequences driven by physics. It works as an **ambient machine**: start it, and it keeps evolving for hours without looping.

There are two layers: a shared **harmony engine** and a **physics voice** on each track.

**Chosen direction:** D · Floating island. It uses A's harmony band, and B's four-column settings layout appears when you zoom into a plinth. Mocks: canvas `Nature Cycles — Directions` (the working title), boards **E1 Overview** and **E2 Zoomed**.

---

## 0. Decisions (from review)

| Topic | Decision |
|---|---|
| Clock | Both: **internal** (sends clock and start/stop) or **external** (follows the device's clock) |
| Polyphony | Each track is **mono** or **chord** |
| MIDI out | Notes and velocity only. No CCs; the user tweaks sound on the device |
| Harmony input | **Generated**. The generator keeps going; a clickable history lets you jump back to an earlier point |
| Timing | **On grid**, with swing |
| Presets | Yes: save/load slots plus JSON export/import |
| Modes | The six below, tuned so their characters don't overlap |
| Controls | **Vertical fill faders** (drag up/down; the fill shows the value). No horizontal sliders anywhere |
| Mute/solo | M and S on every track, plus **mute all** and **solo all / clear** |
| Layout | Island and journey on top, **tracks in a strip below the island** (one card per track) |
| Drum tracks | Each track is either **tonal** or **drum** (§2) |
| Cross-track | A lightweight **listen** option only (§2b). Kept small on purpose |
| Snapshots | **Snap** (temporary save) and **restore**, plus undo |
| No device | A built-in **sine preview** synth plays whenever no MIDI output is selected |
| Capture | Record the session to a `.mid` file |
| Controller | **MIDI learn**, with a ready-made **8mu** layout |

---

## 1. Layer one: harmony engine (global)

### Generation
- Inputs are **root**, **base scale** and a **seed**. Everything else is generated. Base scales are the six modes lydian, ionian, mixolydian, dorian, aeolian and phrygian; locrian is left out.
- A **chord generator** walks a weighted graph of scale degrees with functional weights (tonic, then predominant, then dominant, then tonic), in phrases of 4 or 8 chords. A **memory penalty** makes recently used chords less likely, so long runs don't repeat.
- Voicings use 4 or 5 notes with extensions (7, 9, 6, sus, add). Each new chord is voice-led from the last one with the smallest total movement.
- **Chord morph** (every `morph` bars, scaled by `depth`): a voice moves one scale step, an extension swaps, a substitution (relative or third-related chord) comes in, or the chord returns toward its base form.
- **Scale drift** (every `drift` bars). The **relation** setting picks the next scale:
  - fifths: one accidental changes
  - brightness: a parallel mode on the same root
  - relative: same notes, new tonic
  - walk: a mix of the three

  The change waits for a **pivot chord** that both scales share. The progression is re-read by scale degree, so each chord keeps its role.
- **Home pull** (0–1) is the chance that a drift moves *toward* the base key instead of away. This produces long arcs that return home instead of wandering off for good.
- All randomness comes from a seeded generator (RNG), and it never reads the clock. A given seed and settings always replay the same journey.

### History & rewind
- Every chord change appends a snapshot `{bar, scale, chord, generator state, RNG state}` to the history.
- The harmony band shows **past chords as small dots** left of the current pills, and **upcoming chords as outlined pills**. Upcoming chords are generated 4 chords ahead and can change when morph or drift kicks in.
- **Click a past dot** to restore that snapshot at the next bar line. Generation then continues from there, so the future after that point is regenerated.
- **Hold** freezes the current chord. **Hold scale** freezes the scale only.

### Output per bar
`HarmonyContext { scale: PitchClass[], chordTones: Note[], tensions: PitchClass[], root, degree, barInPhrase }`

---

## 2. Layer two: physics voices (per track)

### Slot → note
```
pool  = color < .33 → chord tones
        color < .66 → chord tones + tensions (9, 11, 13)
        else        → full scale
slot i → pool[i mod len], octave = i div len, folded into the track's range
steps  = interval set in scale steps (e.g. 1·3·5): a hit picks one of these offsets (mono)
transpose = ± scale steps, ± octaves
```
**Voicing** (tonal tracks): **mono** picks one interval step per hit; **chord** plays the slot note plus the other steps in the interval set, all at once (2–4 notes); **root** sends only the slot note.

> **Mono-only devices:** some instruments accept only one note at a time per channel, or voice chords themselves. For those, chord mode offers a fallback, **"root only"**, which sends just the slot note and lets the instrument build the chord.

### Drum tracks
A track is either **tonal** (everything above) or **drum**, for drum machines and drum parts that respond to a fixed note.
- A drum track ignores the harmony: every hit plays one **base note**.
- **Pitch spread** (0–12 semitones) lets different targets nudge the pitch by a few fixed amounts, which suits toms and pitched percussion.
- **Accent**: hits stronger than a threshold get the top of the velocity range; the rest are scaled down into a **ghost** range. This gives dynamics without changing pitch.
- **Color** sets how wide the pitch spread is, instead of choosing the pitch pool.
- Defaults follow the E1 mock: 01 drops, 03 rockfall and 05 pendulum are drum tracks; 02 waves, 04 wind and 06 orbits are tonal (06 in chord mode). Any track can be switched.

### 2b. Listen (light cross-track coupling)
Each track can **listen** to one other track, with an **amount** from 0 to 1. When the source track plays a note, it nudges the listener's simulation once:
- drops: spawns one drop
- waves: adds a little swell
- rockfall: releases a rock
- wind: adds a short gust
- pendulum: gives the pendulums a small kick
- orbits: briefly speeds them up

That's all it does: one source per track and one kind of nudge per mode. Loops are allowed, because each nudge is limited to one per step. If this turns out too fiddly it can be left off without affecting anything else.

### Shared macros (0–1, vertical faders)
| Macro | Meaning |
|---|---|
| **Intensity** | Energy and density |
| **Color** | Which pitch material is used (the pool above) |
| **Rotation** | Direction or tilt, which reorders the slot map |
| **Randomness** | Jitter in spawn, angle and restitution |

### Modes: each with a distinct character
| Mode | Simulation | Musical character | Note length | Mode params |
|---|---|---|---|---|
| **Drops** | Steady rain falling onto tilted paddles; splashes make smaller drops | **Pointillistic**: scattered single notes, occasional ratchets | short | paddles, gravity, splash |
| **Waves** | A sum of travelling swells passing buoys | **Sustained**: slow, overlapping, legato | long (held while a crest is above the buoy) | buoys, swell length, chop |
| **Rockfall** | Rocks bounce down terraced stairs, losing energy on each bounce | **Gestural bursts**: accelerating rolls, then silence | short, accented | terraces, restitution |
| **Wind** | Gusts (an envelope) push leaves along a row of ordered chimes | **Melodic runs**: neighbouring chimes are hit in turn, giving stepwise lines that swell with each gust | medium | chimes, gust length |
| **Pendulum** | A pendulum wave: N pendulums swing through a centre gate, each with a different whole-step half-period | **Minimalist phasing**: crossings drift in and out of phase (Reich-like) | short | count, spread (steps added per pendulum) |
| **Orbits** | Bodies on orbits with integer period ratios cross gate rays | **Strict polymeter**: interlocking cycles | short/medium | ratios, rays |

### Per-track settings (zoomed view, four columns)
1. **Mode**: mode chips plus the mode's own params
2. **Motion**: faders for intensity, color, rotation and randomness
3. **Notes**: mono/chord, pool readout, range, interval steps, transpose
4. **MIDI & life**: channel, division, swing on/off, gate (1/32 … 1/1, plus **2/1 and 4/1** for drones), velocity range, chance, **breathe**, **swell**, **rest**, **wander**

A physics note keeps its own length (waves) unless the track's gate is longer, so a long gate turns any voice into a held drone. The sine preview fades notes longer than a second in and out.

---

## 3. Long-running controls ("Journey")

All of these work over long timescales. Together they let one patch run for hours without looping.

| Control | Scope | What it does |
|---|---|---|
| **Pace** | global | Scales every morph and drift period (×0.25 to ×8). One fader sets how fast the piece evolves |
| **Home pull** | global | How strongly scale drift returns to the base key |
| **Weather** | global | A slow random walk from calm to storm that biases every track's intensity and randomness |
| **Breathe** | track + global depth | A slow LFO on intensity (period 8–128 bars). Each track gets a random phase, so tracks swell at different times |
| **Swell** | track | Velocity rises and falls on the track's breathe cycle (depth 0–1). Breathe lengths step by 1 bar, so co-prime cycles (17, 23, 29…) phase against each other like Eno's tape loops |
| **Rest** | track | Chance that a track sleeps for 2–16 bars at a phrase boundary, fading in and out |
| **Max voices** | global | The most tracks allowed to play at once. Rests rotate so the arrangement keeps changing. There is also a floor: at least half the budget (minimum 1) stays awake, so the piece never falls silent. Starting the transport wakes every track |
| **Wander** | track + global depth | Slow random walk of color and rotation within ±range around the fader value |
| **Density cap** | global | Maximum notes per bar across all tracks |

An elapsed-time readout and the seed are shown next to the journey faders.

---

## 4. Timing & MIDI

- **Rhythm-first physics.** Collisions are *planned onto the grid*, not snapped to it afterwards. Each track hands its voice a swing-aware `Grid`: `timeOfStep(k)` gives the swung time of step *k*, and `stepAt(t)` is the piecewise-linear inverse. Drops are released from their spout so they land on a step. Rocks follow ballistic arcs that bounce on steps, with shrinking intervals. Leaves move one chime spacing every *k* steps. Pendulum half-periods and orbit ray intervals are whole numbers of steps, and a speed change applies at the next crossing so motion stays continuous. Wave crests reach each buoy on a step.
- **The simulation runs at audio time.** Voices report each hit at least the *horizon* ahead (output lookahead + device latency + slack). The engine holds each planned hit until its send deadline and then emits it timestamped. A hit sounds exactly when its collision is drawn; the tests check this to 1e-9 s. Every frame draws the analytic state at its exact time, not the last 25 ms tick. Notes keep the harmony of the bar they sound in, even when planned during the previous bar.
- **One step, one note (mono):** if several planned hits fall on the same step, the strongest wins. In chord mode the step plays one chord. **Latency** (ms) is how late the device sounds; notes are sent that much earlier.
- **Swing** is a global percentage, and each track can turn it on or off. It delays off-beat steps of the track's division.
- **Internal clock** sends 24 PPQN clock plus Start and Stop. **External clock** follows incoming clock, smooths the tempo estimate and starts on the incoming Start.
- Every Note On has a scheduled Note Off. Stop and Panic send All Notes Off.
- Mute and solo drop events after the simulation runs, so a muted track keeps animating, greyed out.
- **Background-safe clock.** The scheduler tick runs in a **Web Worker** timer, because a hidden tab slows main-thread timers to about once a second. The screen is kept awake (Wake Lock) while the transport runs. The simulation steps inside the scheduler tick, not inside animation frames.
- **Latency offset** in ms per output port lines up the visuals with the hardware.
- **Panic** stops all notes on every channel. A per-track **activity tick** flashes on each note sent.

### Sine preview
When no output is selected, or **preview** is on, notes go to a small built-in WebAudio synth instead. Each track gets one sine or triangle voice with a short attack and release. Drum tracks get a pitched sine thump with a fast pitch drop, or a noise burst. The same timestamped events feed it, so the timing matches the MIDI output.

### Capture
**Rec without a device** records the sine preview itself: the preview's output is tapped, captured as stereo PCM, trimmed of leading/trailing silence and saved as a 16-bit `.wav` (`cycloom-<seed>-<date>.wav`). The rec button reads `rec wav` in that mode.

**Rec** with a MIDI device writes every note that is sent, with exact timestamps, to a Standard MIDI File: format 1, one MIDI track per channel, tempo map included, chord changes as markers. Recording runs while the transport plays. Stopping offers a download (`cycloom-<seed>-<date>.mid`).

### Controller: MIDI map
**Data model**
```ts
type MidiSource = { port: string; ch: number; kind: 'cc' | 'note'; num: number };
type Target =
  | { scope: 'track'; track: number; param: ParamId }   // fixed: "track 3 intensity"
  | { scope: 'focus'; param: ParamId }                  // follows the zoomed/selected track
  | { scope: 'global'; param: ParamId }                 // journey.pace, transport.bpm, swing…
  | { scope: 'action'; action: ActionId; arg?: number } // play, mute 3, solo 3, snap, restore 2, next track…
type Mapping = {
  src: MidiSource; target: Target;
  mode: 'absolute' | 'relative' | 'toggle' | 'momentary';
  min: number; max: number; curve: 'lin' | 'exp'; invert: boolean;
};
```
- Mappings are stored **per controller device** (by port name), not per scene, so changing scenes never breaks your controller layout. Export and import as JSON.

**Learn flow**
1. Press **learn** (in the ⋯ menu, or `L`). Every control that can be mapped gets a dashed outline.
2. Tap a fader, button or action. It pulses while it waits for input.
3. Move a fader or press a pad. The first CC or note that arrives is bound to it, and a small badge (`8mu · CC 34`) appears on the control.
4. Learning one control after another is allowed. Tapping a mapped control while learning lets you **clear** it or switch it between **this track** and **focused track**. Esc or **done** leaves learn mode.
5. Binding a source that is already in use moves it to the new target and shows a short notice.

**At runtime**
- **CC to fader:** values 0–127 are scaled into min–max with the chosen curve. A ~30 ms smoothing step hides the coarse 7-bit steps.
- **Pickup (soft takeover):** when the hardware position differs from the fader value, nothing changes until the hardware passes through the current value. Until then the on-screen fader shows a thin **ghost line** at the hardware position. This matters whenever a scene changes or the focused track switches.
- **Relative** mode is for endless encoders (two's-complement offsets). **Toggle** and **momentary** are for pads and notes, e.g. mute or solo per track, or hold a chord while pressed.
- **Focus targets** re-bind as soon as focus changes, with pickup applied. This makes one set of 4 faders play any track.
- The controller input port is chosen separately from the output and clock ports. Incoming clock and transport messages are never treated as mapping input.

**8mu template:** a **guided setup** ("move fader 1… 2… 8, then tilt"), so no CC numbers are hard-coded.
- faders 1–4 → **focus**: intensity, color, rotation, randomness
- faders 5–8 → **global**: pace, weather, breathe, rest
- tilt X → focused track's rotation, as an offset
- tilt Y → weather, as an offset
- Offsets add to the fader value and fall back when you level the 8mu.

---

## 5. Interaction

- **Overview:** header, then the harmony band, then the island with the journey panel on its right, then a **track strip** below the island. The strip has one card per track: number, name, mode, channel and division, tonal or drum, an activity tick, and M/S. Mute all and solo all sit in the strip's header. Each plinth animates its simulation live.
- **Header (one row):** transport, BPM, swing, bar (shows `ext clock` when following), output port (or `sine preview`), **rec**, then line icons: **presets** (stacked slabs), **snap** (save arrow), **restore** (load arrow, restores the last snap) with slot dots (click one to restore it, long-press to keep it as a scene), **share** (copies a link to this setup), a **die** (randomise tracks), **⋯**. The ⋯ menu holds clock, undo (⌘Z), panic, controller, named scenes (save/export, load/import) and reset. On phones, presets, snap and restore sit at the top of ⋯.
- **Harmony band settings (one row):** `chord every N bars` (morphs fall halfway through), `colour` (morph depth), `key every N bars` (both shown with journey pace applied), and a `hold chord | key` toggle. Drift relation is set by clicking the `by …` word in the drift line, or in the base-key sheet.
- **Snap / restore:** *snap* saves the whole state (all settings plus harmony history and seed) to a temporary slot without asking for a name. *Restore* returns to it at the next bar. Up to 8 temporary slots, shown as small dots; long-press a dot to save it as a named scene. **Undo** steps back through the last 50 parameter changes.
- **Zoom:** click a plinth or a track row. The camera tweens about 600 ms into that plinth; the other plinths fade and drop away. The four-column settings panel rises below, and the harmony band shrinks to a single line.
- **Back:** Esc, the `← island` button, or clicking empty sky. Keys `1`–`9` jump between tracks while zoomed. `M` and `S` toggle mute and solo on the focused track. Space starts and stops.
- **Add or remove tracks:** new plinths appear on the island grid (3 per row) and the island grows. 6 tracks by default, 16 at most.
- **Faders:** a real `<input type="range">` set vertical (`writing-mode: vertical-lr; direction: rtl`) and laid invisibly over a drawn fill bar. Drag, wheel and arrow keys work. Double-click resets to default.

---

## 5b. Mobile & responsive

**Platform reality:** Web MIDI works in Chrome on Android, including a USB-OTG cable to the MIDI device or the 8mu. On **iOS** the user runs the app inside a **Web MIDI browser app**, which adds `navigator.requestMIDIAccess` to the page. Those add-ons may **ignore the timestamp argument** of `send()`. The scheduler detects this with an option (`timestampedSend: auto | on | off`) and falls back to **just-in-time sending**: a shorter lookahead (~20 ms) on the worker tick, sending each event when its time arrives. In plain iOS Safari the app runs in sine preview.

### Breakpoints
| Width | Layout |
|---|---|
| ≥ 1100 px | Desktop: island + journey side by side, track strip below |
| 700–1099 | Tablet: island full width; journey becomes one row of faders under it; track strip 3 per row |
| < 700 | Phone: single column (below) |
| Phone landscape | Island on the left half; tracks and journey scroll on the right |

### Phone (< 700 px)
- **Top bar** (sticky, 56 px): logo, BPM (tap to edit, drag to nudge), play/stop, a rec dot, and a **⋯ menu**. The menu holds port and clock, swing, snap/restore, undo, scenes and panic. Panic is also reachable with a long-press on stop.
- **Harmony** collapses to one line: scale, current chord, next chord and the history dots. Tap it to open a **bottom sheet** with the full chord row, pitch set, morph/drift settings and hold.
- **Island** spans the full width, roughly square. Tap a plinth to zoom.
- **Journey** comes right after the island: a collapsible section with its 8 faders in a compact 4 × 2 grid (92 px tall), with no sideways scrolling.
- **Track strip** comes last, as slim one-line rows (number + activity, mode + meta, M/S at 44 px). Mute all and solo all sit in its header.
- **Zoomed track:** the stage fills the top ~40% of the screen. The four columns become a **segmented tab bar**: Mode · Motion · Notes · MIDI. Motion shows its 4 faders across the full width. **Swipe** the stage left or right to change track; a dot row shows your position. `← island` sits top-left, M and S top-right.

### Touch rules
- Faders use **relative drag** (no jump to where you touch) and `touch-action: none`, so the page never scrolls while you move a fader. Page scrolling only happens outside faders. Double-tap resets to default.
- Every target is at least 44×44 px. The layout respects `env(safe-area-inset-*)`. No hover-only actions: long-press replaces right-click and hover.
- Text is never smaller than 12 px; the numbers stay tabular.

### Performance on phones
- Canvas `devicePixelRatio` is capped at 2. The scene renders on every animation frame (the display rate; browsers drop it to 30 fps in low-power mode). The simulation steps at a fixed rate in the scheduler, so timing never depends on the frame rate.
- Plinths outside the camera view skip drawing but keep simulating.
- When the page is hidden, drawing stops entirely. Audio and MIDI keep running through the worker clock and Wake Lock.

## 6. Rendering

- **One canvas** for the whole island scene, using Canvas 2D with an isometric camera (2:1). Zooming changes the camera transform.
- Every voice draws its own **true isometric scene** on its plinth top (plinth-local world coordinates: footprint 2 × 2, z up) through a shared `Pen`: boxes with three shaded faces, 2:1 ground ellipses, 3D lines and arcs. The overview and the zoomed stage draw the same scene at two scales:
  - drops: stepping-stone pillars with a spout above each one, drops falling straight down, splash droplets arcing to a neighbour. waves: a basin of water ribbons with buoys. rockfall: MV stairs with tumbling cubes and a dashed path for the current hop. wind: a chime frame with a flag and leaves flying along the row
  - pendulum: a gate with bobs swinging in the y–z plane through the marked gate line. orbits: a floating sphere with ground-plane rings, rays and bodies, plus its shadow on the plinth. Painter's order is by x + y depth. Struck targets flash navy or blue; nothing glows
- **Flat shading.** Each surface gets one fixed colour (top light, left mid, right dark). No glow, blur or gradients. A struck target **flashes a flat colour** for about 120 ms.
- Muted plinths are drawn in a desaturated slate set. The selected plinth's top face is drawn in pink.

### Palette
`#0D1E4C` sky · `#0B1B32` deep · `#26415E` line · `#83A6CE` island top · `#5E7FA8` / `#3E5F86` island sides · `#E5C9D7` plinth top / text · `#C48CB3` plinth left / accent · `#9A6E93` plinth right
Font: **Outfit**, with tabular figures for every number.

---

## 7. Architecture

- **Vite + TypeScript** (strict), bundled to a static site. Web MIDI works on HTTPS or localhost, in Chromium browsers and Firefox.
- No UI framework. A small typed signal store; DOM for controls; one canvas for the scene.
```
src/
  midi/      ports, scheduler (lookahead + timestamps), clock in/out
  harmony/   scales, chords, generator, morph, drift, history/rewind
  voices/    Voice interface + drops, waves, rockfall, wind, pendulum, orbits
  mapping/   slot→note, grid snap + swing, mono/chord, mute/solo
  journey/   pace, weather, breathe, rest, wander, budgets
  scene/     iso camera, island layout, plinth & stage drawing, zoom tween
  ui/        header, harmony band, track list, journey, zoom panel, fader
  state/     store, presets (localStorage slots + JSON import/export)
  rng.ts     seeded PRNG, splittable per subsystem
```
```ts
interface Grid { stepSec: number; stepAt(t: number): number; timeOfStep(k: number): number } // swung
abstract class Voice {
  params: Record<string, number>;
  // returns only future hits, each exactly on the grid: { t: grid.timeOfStep(step), step, slot, strength, length? }
  step(env: { dt, t, beatSec, macros, grid, horizon }): Hit[];
  view(t: number, u: number): void;   // exact frame time for drawing
  draw(pen: Pen): void;               // iso scene in plinth-local coordinates
  reset(): void;                      // transport start/stop
}
```

## 8. Build order
1. Scaffold the project, the store, the vertical fader component and undo
2. Worker clock, scheduler, MIDI ports, internal clock, **sine preview** and panic; a test pattern
3. Harmony engine with history; harmony band UI
4. Island scene, camera and zoom; overview (track strip) and zoom layouts
5. Voices one at a time: drops, waves, pendulum, orbits, rockfall, wind
6. Mapping (grid, swing, mono/chord, **drum**), mute and solo
7. Journey layer
8. Presets, **snap/restore**, external clock
9. **Capture** (.mid), **MIDI learn and the 8mu layout**
10. Listen (cross-track), polish

## 8a. Tooltips

Every control carries a short explanation (`src/ui/hints.ts`); motion and mode faders get text for the current mode. Mouse: hover (short delay), keyboard: focus. Touch: tap the control's label (labels show a faint dotted underline and sit above native pickers, so a tap explains rather than opens), or long-press an icon. One flat bubble in the palette's light colour, clamped to the viewport. An e2e check fails if any visible control lacks a tip.

## 8b. Presets and randomise

- **Presets** (the stacked-slabs icon in the top bar) replace tracks, harmony, journey and tempo, and keep the MIDI ports and clock. Each preset is one undo step.
  - **airports**: six tonal voices at 60 BPM in D♭ ionian with the key held. Each voice is a sparse figure on a co-prime breathe cycle (17/19/23/29/31/37 bars) with a deep swell, in the spirit of Eno's *Music for Airports* tape loops.
  - **drone**: a 4-bar held root, a held root-and-fifth pad, a slow chord pad, faint high glints and a soft pulse.
  - **shoreline**: a swelling pad over soft drops, a wandering lead and occasional rockfall.
  - **rain garden**: busier and percussive, with three drum voices, orbit bells, a bass and runs.
  - **cycloom**: the default island.
- **Randomise** (the die icon in the top bar, or R) builds 4–8 tracks (the current count when it is in range): 2+ drum voices first, then melodic roles (bass, lead, pad). Modes are spread so they don't double up, every control stays in range, and a melodic voice sometimes listens to a drum. Harmony, tempo and journey stay. One undo step.

## 8c. Share links

- The share icon copies a link like `…/#s=z<code>` and opens a sheet with copy and, where available, the system share sheet.
- The code is a compact binary record: a fixed field order, every value stored as integer grid steps (0.01 or whole bars) in LEB128 varints, then deflated if that is shorter, then base64url. A six-track setup is about 210–250 characters (deflated JSON was about 1,000). The enum tables in `src/state/share.ts` are part of the format: append, never reorder. A test fails if a state field is added without being shared. Old `z…` JSON links still open.
- It lives in the URL fragment, so nothing is uploaded and no server is needed.
- MIDI ports, clock source, timing mode, latency, mute/solo and controller mappings are left out; the receiver keeps their own.
- Opening a link loads the setup as one undo step and clears the fragment, so reloading keeps your later edits.
- Links only work where the app is hosted at the same address. A `localhost` link opens only on the machine that made it.

## 9. Implementation status

Everything in sections 0–8 is built: harmony engine with history and rewind, six voices, journey layer, Web MIDI out with timestamped or just-in-time sending, internal and external clock, sine preview, `.mid` capture, MIDI learn with pickup and the 8mu wizard, snapshots, scenes, undo, JSON import/export, and the desktop, tablet and phone layouts (E1–E4).

- `npm test`: 152 unit tests, including proofs that every hit is on its swung grid step and reported ahead, that each visual collision is in place at that exact moment, and that every note sounds when its collision is drawn
- `npm run e2e`: 52 end-to-end checks in headless Chrome against a stubbed Web MIDI device (desktop and phone)

## 10. Later / not now
- Long-form shape (dawn → day → dusk → night phases that change density and register)
- Mutate button per track
