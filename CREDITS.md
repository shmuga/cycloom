# Credits

Cycloom is free software under the [GNU GPL v3](LICENSE).

The app has no runtime dependencies: everything that ships in `dist/` is Cycloom's own TypeScript.
It is built and tested with [Vite](https://vitejs.dev), [TypeScript](https://www.typescriptlang.org),
[Vitest](https://vitest.dev) and [Playwright](https://playwright.dev) (MIT and Apache-2.0); `npm ls`
lists them. None of them is bundled into the app.

## Techniques

Cycloom's harmony, physics and scheduling are its own code. These published ideas shaped it:

- Random numbers: mulberry32 by Tommy Ettinger (public domain).
- Scheduling: the lookahead pattern from Chris Wilson's *A Tale of Two Clocks* (web.dev).
- Isometric drawing: the standard 2:1 dimetric projection used in pixel art and games.
- Swing: the MPC-style even/odd step offset.
- Chord movement: a functional-harmony Markov chain with voice leading, and modal brightness
  ordering (Lydian → Locrian) for scale drift.
- The *airports* preset follows Brian Eno's tape-loop method from *Music for Airports* (1978):
  loops of co-prime lengths phasing against each other. No material from the record is used.

## Look

The Cycloom mark (three pastel meander ribbons, pink to blue, on a navy tile) is the project's own artwork: `assets/brand/source.png`. `npm run brand` cuts the tile out for the favicons and touch icon, and lifts the ribbons off it for the header logo, writing into `public/`.


The floating-island look is inspired by Monument Valley (ustwo games). No assets, shapes or
colours are taken from it; everything is drawn in code.

## Fonts

[Outfit](https://fonts.google.com/specimen/Outfit) by Rodrigo Fuenzalida, SIL Open Font Licence 1.1.
It is loaded from Google Fonts, not bundled.
