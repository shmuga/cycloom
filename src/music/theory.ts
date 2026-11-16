/** Pitch classes, modes, chord construction, spelling and naming. */

export type PitchClass = number; // 0..11

export const MODES = ['lydian', 'ionian', 'mixolydian', 'dorian', 'aeolian', 'phrygian'] as const;
export type ModeName = (typeof MODES)[number];

/** Interval patterns, ordered bright → dark (the "brightness" relation walks this list). */
export const MODE_STEPS: Record<ModeName, readonly number[]> = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/** Semitones from the parent major (ionian) tonic to the mode's tonic. */
const MODE_OFFSET: Record<ModeName, number> = {
  ionian: 0,
  dorian: 2,
  phrygian: 4,
  lydian: 5,
  mixolydian: 7,
  aeolian: 9,
};

export interface Scale {
  root: PitchClass;
  mode: ModeName;
}

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

export function scalePcs(s: Scale): PitchClass[] {
  return MODE_STEPS[s.mode].map((i) => mod12(s.root + i));
}

export function scaleEquals(a: Scale, b: Scale): boolean {
  return a.root === b.root && a.mode === b.mode;
}

/** Key-signature position on the circle of fifths, −5 … +6 (number of sharps; negative = flats). */
export function signature(s: Scale): number {
  const parent = mod12(s.root - MODE_OFFSET[s.mode]);
  // pc → sharps count of that major key
  const pos = mod12(parent * 7);
  return pos > 6 ? pos - 12 : pos;
}

/** Find the mode whose pattern matches the scale's notes from a new tonic (relative modes). */
export function modeFromTonic(pcs: PitchClass[], tonic: PitchClass): ModeName | null {
  const rel = pcs.map((p) => mod12(p - tonic)).sort((a, b) => a - b);
  for (const m of MODES) {
    const st = MODE_STEPS[m];
    if (st.every((v, i) => v === rel[i])) return m;
  }
  return null;
}

// ---------------------------------------------------------------- spelling

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const DEFAULT_ROOT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function pcName(pc: PitchClass): string {
  return DEFAULT_ROOT_NAMES[mod12(pc)];
}

/** Spell each scale degree with consecutive letters, e.g. D aeolian → D E F G A B♭ C. */
export function spellScale(s: Scale): string[] {
  const rootName = pcName(s.root);
  const letterIdx = LETTERS.indexOf(rootName[0]);
  return scalePcs(s).map((pc, i) => {
    const li = (letterIdx + i) % 7;
    let diff = mod12(pc - LETTER_PC[li]);
    if (diff > 6) diff -= 12;
    const acc = diff === 0 ? '' : diff > 0 ? '♯'.repeat(diff) : '♭'.repeat(-diff);
    return LETTERS[li] + acc;
  });
}

export function scaleName(s: Scale): string {
  return `${pcName(s.root)} ${s.mode}`;
}

export function noteName(midi: number): string {
  return `${pcName(midi)}${Math.floor(midi / 12) - 1}`;
}

// ---------------------------------------------------------------- chords

export const EXTENSIONS = ['triad', '7', '9', '6', 'add9', 'sus2', 'sus4', '11'] as const;
export type Extension = (typeof EXTENSIONS)[number];

/** Scale-degree offsets above the chord root for each extension. */
const EXT_DEGREES: Record<Extension, number[]> = {
  triad: [0, 2, 4],
  '7': [0, 2, 4, 6],
  '9': [0, 2, 4, 6, 8],
  '6': [0, 2, 4, 5],
  add9: [0, 2, 4, 8],
  sus2: [0, 1, 4],
  sus4: [0, 3, 4],
  '11': [0, 2, 4, 6, 10],
};

export interface ChordSpec {
  degree: number; // 0..6
  ext: Extension;
}

export interface Chord extends ChordSpec {
  rootPc: PitchClass;
  pcs: PitchClass[]; // chord tones, root first, stacked order
  name: string;
  roman: string;
}

export function buildChord(scale: Scale, spec: ChordSpec): Chord {
  const pcs = scalePcs(scale);
  const spelled = spellScale(scale);
  const d = ((spec.degree % 7) + 7) % 7;
  const tones = EXT_DEGREES[spec.ext].map((o) => pcs[(d + o) % 7]);
  const rootPc = pcs[d];
  return {
    degree: d,
    ext: spec.ext,
    rootPc,
    pcs: tones,
    name: spelled[d] + chordSuffix(rootPc, tones, spec.ext),
    roman: romanFor(scale, d),
  };
}

export function triadQuality(scale: Scale, degree: number): 'maj' | 'min' | 'dim' | 'aug' {
  const pcs = scalePcs(scale);
  const r = pcs[degree % 7];
  const third = mod12(pcs[(degree + 2) % 7] - r);
  const fifth = mod12(pcs[(degree + 4) % 7] - r);
  if (third === 4) return fifth === 8 ? 'aug' : 'maj';
  return fifth === 6 ? 'dim' : 'min';
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export function romanFor(scale: Scale, degree: number): string {
  const q = triadQuality(scale, degree);
  const r = ROMAN[degree % 7];
  if (q === 'min') return r.toLowerCase();
  if (q === 'dim') return r.toLowerCase() + '°';
  return r;
}

function chordSuffix(root: PitchClass, tones: PitchClass[], ext: Extension): string {
  const has = (iv: number) => tones.some((t) => mod12(t - root) === iv);
  const minor = has(3) && !has(4);
  const dim = minor && has(6) && !has(7);
  const maj7 = has(11);
  const min7 = has(10);
  switch (ext) {
    case 'triad':
      return dim ? '°' : minor ? 'm' : has(8) && !has(7) ? '+' : '';
    case '7':
      if (dim) return 'ø7';
      if (minor) return maj7 ? 'm(maj7)' : 'm7';
      return maj7 ? 'maj7' : '7';
    case '9':
      if (dim) return 'ø9';
      if (minor) return 'm9';
      return maj7 ? 'maj9' : '9';
    case '11':
      if (dim) return 'ø11';
      if (minor) return 'm11';
      if (maj7) return has(6) ? 'maj7♯11' : 'maj7(11)';
      return min7 ? '11' : 'add11';
    case '6':
      return dim ? '°(♭6)' : minor ? 'm6' : '6';
    case 'add9':
      return dim ? '°(add9)' : minor ? 'm(add9)' : 'add9';
    case 'sus2':
      return 'sus2';
    case 'sus4':
      return 'sus4';
  }
}

/** Voice a chord's pitch classes near the previous voicing (minimal motion). */
export function voiceLead(pcs: PitchClass[], prev: number[] | null, center = 62): number[] {
  const out: number[] = [];
  const refs = prev && prev.length ? prev : null;
  pcs.forEach((pc, i) => {
    const target = refs ? refs[Math.min(i, refs.length - 1)] : center - 7 + i * 4;
    let best = 0;
    let bestD = Infinity;
    for (let n = 36; n <= 84; n++) {
      if (mod12(n) !== pc) continue;
      const d = Math.abs(n - target);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    out.push(best);
  });
  const uniq = [...new Set(out)].sort((a, b) => a - b);
  return uniq;
}
