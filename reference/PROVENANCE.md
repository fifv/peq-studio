# Source provenance

Source page: https://home.toppingaudio.com/peq

Inspected version: web v1.14.0, 2026-09-23.

`9910985b55cdcf2d.js` is an unchanged public client bundle downloaded from
https://home.toppingaudio.com/_next/static/chunks/9910985b55cdcf2d.js.

Its SHA-256 is `cacd8887b83faaa9f37303b706357c28503d0acdc1c2309b5261c65279cbb296`.
The second retained bundle `e0d65de26e338810.js` documents the hardware JSON
schema and numeric filter mapping (1 peak, 2 low pass, 3 high pass, 4 low shelf,
5 high shelf). It is reference-only and never loaded by the local app.

`npm run extract` produces the two pure modules under `src/vendor`. The original
filter coefficients, response calculation, and REW/TXT/JSON parser/serializer are
preserved in the vendor files. A minimal export adapter replaces their bundler registration API.
The local `src/response.js` uses the original coefficients with an unclamped
magnitude calculation, allowing responses beyond the original drawing clamp.
No account, authentication, cloud, telemetry, or hardware modules are executed.

The surrounding UI, validation, curve import, persistence, and channel handling
are a new local implementation. This is not TOPPING's original source repository
or an official TOPPING distribution. No upstream license grant was found in the
downloaded bundle; original code remains subject to its owner's rights.

`src/autoeq.js` is a new local curve fitter, using greedy band selection and
bounded coordinate refinement with the already-extracted biquad coefficients.
It does not copy the AutoEq project's optimizer or call TOPPING's cloud solver.
The biquad families are described in the W3C Audio EQ Cookbook:
https://www.w3.org/TR/audio-eq-cookbook/.

The initial six-band example is transcribed from the user-provided screenshot.
Frequency and Q values are rounded as displayed there; it is not an exact backup
of the user's cloud preset. No private cloud presets or custom measurements are
bundled. Import exported settings and measured curves for exact data.

## Built-in target library

`src/data/builtin-targets.json` contains the 13 public built-in targets listed at
https://home.toppingaudio.com/autoeq/target-curve-library/targets.json.
Catalog version: `2026-09-07`, dataset `Refresh_Target_curve`.
The upstream license metadata reads `Internal target curves`; it is retained
along with the per-curve source URLs and measurement systems. Each curve was
downloaded from the catalog's `/curves/<id>.json` endpoint. Original point values
within the editor's 20–20,000 Hz range are preserved without approximation.
`scripts/fetch-targets.mjs` reproduces this download. These public target curves
are bundled offline; the user's private custom curves are not copied from cloud.

## Built-in source library

`src/data/builtin-sources.json` indexes 465 public headphone responses from
https://home.toppingaudio.com/autoeq/headphone-library/models.json.
Catalog version: `2025-08-18`, dataset `Headset_curve`. Each response is bundled
under `public/curves/sources/` from the catalog's `/curves/<id>.json` endpoint.
Upstream license metadata reads `AutoEQ-compatible dataset, see upstream project
for details`; original source URLs and measurement metadata are retained.
`scripts/fetch-sources.mjs` reproduces the download. Source selections load only
local assets at runtime; numeric points are not duplicated into localStorage.
