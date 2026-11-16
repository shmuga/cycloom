/** Musical divisions, grid snapping and swing. All positions are in beats (quarter notes). */

export const DIVISIONS = ['1/4', '1/8', '1/16', '1/32', '1/4T', '1/8T', '1/16T', '1/4.', '1/8.', '1/16.'] as const;
export type Division = (typeof DIVISIONS)[number];

/** Note lengths; 2/1 and 4/1 hold for two / four bars (drones). */
export const GATES = ['1/32', '1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1'] as const;
export type Gate = (typeof GATES)[number];

export function divisionBeats(d: string): number {
  const m = /^(\d+)\/(\d+)([T.]?)$/.exec(d);
  if (!m) throw new Error(`bad division ${d}`);
  let beats = (4 * Number(m[1])) / Number(m[2]);
  if (m[3] === 'T') beats *= 2 / 3;
  if (m[3] === '.') beats *= 1.5;
  return beats;
}

/**
 * Snap a beat position forward to the next grid step and apply swing.
 * swing is 0.5 (straight) … 0.75; off-beat steps are delayed by (2·swing − 1)·step.
 */
export function snapForward(beat: number, step: number, swing = 0.5, applySwing = true): { index: number; beat: number } {
  const index = Math.ceil(beat / step - 1e-9);
  let at = index * step;
  if (applySwing && index % 2 === 1) at += (2 * swing - 1) * step;
  return { index, beat: at };
}
