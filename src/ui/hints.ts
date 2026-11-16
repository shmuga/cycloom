import type { ModeId } from '../voices/types';

/**
 * One line (or two) of help for every control. Shown as a tooltip on hover/focus, and on phones by
 * tapping a control's label (or long-pressing an icon).
 */
export const HINTS: Record<string, string> = {
  // ---------------------------------------------------------------- header
  play: 'Play or stop (Space). Stopping also silences every note.',
  bpm: 'Tempo. Drag up/down, scroll, or double-click to type.',
  swing: 'Swing: delays every off-beat step. 50% is straight. Tracks with swing off ignore it.',
  bar: 'Position: bar · beat since you pressed play.',
  output: 'Where notes go: your MIDI device, or the built-in sine preview when none is connected.',
  rec: 'Record. With a MIDI device: saves the notes as a .mid file. With the sine preview: saves the audio as a .wav.',
  presets: 'Presets: ready-made setups — ambient loops, drones, busier gardens.',
  snap: 'Snap: save the current state to a quick slot (kept in this browser).',
  restore: 'Restore the latest snapshot at the next bar while playing, or immediately while stopped. The dots are slots: click one to restore it, long-press to keep it as a named scene.',
  share: 'Share: copy a link with the tracks, harmony settings, journey and tempo. Device settings, controller mappings and mute/solo states are excluded.',
  randomise: 'Randomise (R): a new set of tracks — a mix of drum and melodic voices.',
  menu: 'Settings: MIDI ports, clock, timing, undo, panic, controller learn, scenes and files.',

  // ---------------------------------------------------------------- harmony
  seed: 'Seed of the chord generator. Click for a new one — the same seed and settings reproduce the chord sequence.',
  key: 'Base key and mode. Click to change root, mode, key-drift style and seed.',
  drift: 'Where the key is heading next. Click the underlined word to change how it drifts.',
  history: 'Recent chords. Click one to go back to it; the future then branches anew.',
  chords: 'Current chord (filled), followed by the next three chords.',
  chordEvery: 'How often the chord changes (journey pace applied). Click to cycle, shift-click back.',
  colour: 'Chance a chord gets recoloured halfway through — sus, 7ths, extensions.',
  keyEvery: 'How often the key drifts to a neighbour (journey pace applied).',
  hold: 'Hold: stay on the current chord, or in the current key, until released.',
  pitchSet: 'The 12 pitch classes: filled pink = chord tones, blue = rest of the scale, empty = outside.',

  // ---------------------------------------------------------------- journey
  'journey.pace': 'Pace: scales every harmony period. Above ×1 the music changes more slowly.',
  'journey.home': 'Home: how strongly key drifts return to the base key.',
  'journey.weather': 'Weather: a slow calm↔storm drift that pushes intensity and randomness. This sets how much.',
  'journey.breathe': 'Breathe: how deeply each track swells and thins on its own slow cycle.',
  'journey.rest': 'Rest: chance tracks sit out a few bars at phrase boundaries.',
  'journey.wander': 'Wander: how far color and rotation drift on their own over time.',
  'journey.voices': 'Voices: target number of active tracks, applied each bar. Extra tracks take turns resting; at least half the target (minimum one) stay active unless muted.',
  'journey.notesPerBar': 'Notes per bar: limits note triggers across all tracks. A chord counts as one trigger. Once reached, no new notes start until the next bar; held notes continue.',

  // ---------------------------------------------------------------- track: mode column
  modeChips: 'Physics mode: what lives on this plinth and how it makes rhythm.',
  listen: 'Listen: this track reacts to another one — each hit there nudges this one.',
  amount: 'How strongly this track reacts to the one it listens to.',
  remove: 'Remove this plinth (undo brings it back).',

  // ---------------------------------------------------------------- track: notes column
  kind: 'Tonal follows the harmony. Drum sends one fixed note (plus small offsets) for drum machines.',
  voice: 'Mono plays one note per hit, chord stacks the interval steps, root plays only the slot note.',
  pool: 'Which notes the track can use — set by the color fader: chord tones → + tensions → full scale.',
  range: 'Lowest and highest note. Notes outside fold back in by octaves.',
  transpose: 'Shift every note by scale steps (stays in key).',
  octave: 'Shift the whole track by octaves.',
  steps: 'Interval steps above the slot note: 1 = itself, 3 = a third up, 5 = a fifth… Mono picks one per hit; chord stacks them.',
  drumNote: 'The MIDI note this drum track sends.',
  spread: 'Pitch offsets around the base note — different targets give slightly different notes.',
  accent: 'Hits at or above this strength use the top of the velocity range; weaker hits play softly.',

  // ---------------------------------------------------------------- track: midi column
  channel: 'MIDI channel (on the Model:Cycles, 1–6 are its tracks).',
  division: 'Grid size: every hit lands on a step of this length.',
  trackSwing: 'Use the global swing on this track.',
  gate: 'Note length. 2/1 and 4/1 hold for two or four bars (drones).',
  velocity: 'Velocity range: strong hits play near the top, soft ones near the bottom.',
  chance: 'Chance each hit actually sends a note.',
  'life.breathe': 'Breathe: length of this track’s slow cycle in bars. Odd lengths (23, 29…) drift against each other.',
  'life.swell': 'Swell: velocity rises and falls over the breathe cycle — slow fades in and out.',
  'life.rest': 'Rest: this track’s chance to sit out a few bars (times the journey rest).',
  'life.wander': 'Wander: how far this track’s color and rotation drift by themselves.',

  // ---------------------------------------------------------------- strip
  muteAll: 'Mute every track (again to unmute).',
  soloAll: 'Solo every track (again to clear).',
  mute: 'Mute (M).',
  solo: 'Solo (S): only soloed tracks sound.',
  add: 'Add a plinth (a new track).',
  back: 'Back to the island (Esc).',
};

/** What the four motion faders do, per mode. */
const MOTION: Record<ModeId, Record<'intensity' | 'color' | 'rotation' | 'randomness', string>> = {
  drops: {
    intensity: 'Intensity: how often drops fall.',
    color: 'Color: pitch pool — chord tones → + tensions → full scale.',
    rotation: 'Rotation: turns the ring of stones.',
    randomness: 'Random: drops jump to any stone instead of walking to a neighbour.',
  },
  waves: {
    intensity: 'Intensity: wave height. Low swells leave some buoys silent.',
    color: 'Color: pitch pool — chord tones → + tensions → full scale.',
    rotation: 'Rotation: which way the waves travel.',
    randomness: 'Random: choppier water and the odd skipped buoy.',
  },
  rockfall: {
    intensity: 'Intensity: how often rocks are released.',
    color: 'Color: pitch pool — chord tones → + tensions → full scale.',
    rotation: 'Rotation: stair slope — sets the first bounce gap (4, 3 or 2 steps).',
    randomness: 'Random: extra bounces per rock and bursts of 2–3 rocks.',
  },
  wind: {
    intensity: 'Intensity: how many leaves the wind carries.',
    color: 'Color: pitch pool — chord tones → + tensions → full scale.',
    rotation: 'Rotation: wind direction — runs go up or down the chimes.',
    randomness: 'Random: turbulence — leaves wobble and miss chimes.',
  },
  pendulum: {
    intensity: 'Intensity: swing speed.',
    color: 'Color: pitch pool — chord tones → + tensions → full scale.',
    rotation: 'Rotation: reverses the pendulum order.',
    randomness: 'Random: the odd skipped crossing.',
  },
  orbits: {
    intensity: 'Intensity: orbit speed.',
    color: 'Color: pitch pool — chord tones → + tensions → full scale.',
    rotation: 'Rotation: turns the whole system (rays and bodies together).',
    randomness: 'Random: the odd skipped crossing.',
  },
};

const MODE_PARAMS_HINTS: Record<string, string> = {
  'drops.paddles': 'Stones: how many stepping stones (one note each).',
  'drops.gravity': 'Gravity: how fast drops fall — the visual fall, timing stays on the grid.',
  'drops.splash': 'Splash: chance a drop throws a droplet onto a neighbour a step or two later.',
  'waves.buoys': 'Buoys: how many floats ride the waves (one note each).',
  'waves.swell': 'Period: steps between crests reaching a buoy — longer means slower, longer notes.',
  'waves.chop': 'Chop: small ripples on top of the swell.',
  'rockfall.terraces': 'Terraces: how many stairs (one note each).',
  'rockfall.restitution': 'Bounce: how quickly the gaps between bounces shrink.',
  'wind.chimes': 'Chimes: how many hang from the beam (one note each, in order).',
  'wind.gust': 'Gust: length of a gust cycle in bars.',
  'pendulum.count': 'Count: how many pendulums.',
  'pendulum.spread': 'Spread: extra steps each next pendulum takes per swing — sets how they phase.',
  'orbits.ratios': 'Ratios: relative orbit periods — the polyrhythm.',
  'orbits.rays': 'Rays: how many gates each body crosses per orbit.',
};

/** Hint for a fader/param path, resolving mode-specific ones. */
export function hintFor(path: string, mode?: ModeId): string {
  if (path.startsWith('macros.') && mode) return MOTION[mode][path.slice(7) as 'intensity'] ?? '';
  if (path.startsWith('mode.') && mode) return MODE_PARAMS_HINTS[`${mode}.${path.slice(5)}`] ?? '';
  return HINTS[path] ?? '';
}

export const MODE_BLURB: Record<ModeId, string> = {
  drops: 'Drops: water falls from spouts onto stepping stones — pointillist, sparse.',
  waves: 'Waves: buoys ride a swell — long, slow notes.',
  rockfall: 'Rockfall: rocks bounce down stairs — bursts that speed up.',
  wind: 'Wind: gusts blow leaves through chimes — stepwise runs.',
  pendulum: 'Pendulum: pendulums of different lengths drift in and out of phase.',
  orbits: 'Orbits: bodies cross gate rays — interlocking polyrhythms.',
};
