import type { Rng } from '../rng';
import { DROPS_PARAMS, DropsVoice } from './drops';
import { ORBITS_PARAMS, OrbitsVoice } from './orbits';
import { PENDULUM_PARAMS, PendulumVoice } from './pendulum';
import { ROCKFALL_PARAMS, RockfallVoice } from './rockfall';
import type { ModeId, ParamSpec, Voice } from './types';
import { WAVES_PARAMS, WavesVoice } from './waves';
import { WIND_PARAMS, WindVoice } from './wind';

export * from './types';

export const MODE_PARAMS: Record<ModeId, ParamSpec[]> = {
  drops: DROPS_PARAMS,
  waves: WAVES_PARAMS,
  rockfall: ROCKFALL_PARAMS,
  wind: WIND_PARAMS,
  pendulum: PENDULUM_PARAMS,
  orbits: ORBITS_PARAMS,
};

/** What the four macros mean for each mode (shown under the faders). */
export const MACRO_HINTS: Record<ModeId, [string, string, string, string]> = {
  drops: ['drop rate', 'pitch pool', 'paddle tilt', 'jitter'],
  waves: ['amplitude', 'pitch pool', 'direction', 'chop'],
  rockfall: ['rock rate', 'pitch pool', 'slope', 'restitution'],
  wind: ['wind speed', 'pitch pool', 'direction', 'turbulence'],
  pendulum: ['speed', 'pitch pool', 'order', 'detune'],
  orbits: ['speed', 'pitch pool', 'ray angle', 'skips'],
};

export function createVoice(mode: ModeId, rng: Rng, params?: Record<string, number>): Voice {
  switch (mode) {
    case 'drops':
      return new DropsVoice(rng, params);
    case 'waves':
      return new WavesVoice(rng, params);
    case 'rockfall':
      return new RockfallVoice(rng, params);
    case 'wind':
      return new WindVoice(rng, params);
    case 'pendulum':
      return new PendulumVoice(rng, params);
    case 'orbits':
      return new OrbitsVoice(rng, params);
  }
}
