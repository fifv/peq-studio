# PEQ Studio — local TOPPING PEQ extraction

A standalone, local-first editor based on https://home.toppingaudio.com/peq.
The DSP calculation and TXT/JSON import/export core are extracted from the public
TOPPING Home v1.14.0 client bundle. The editor around them is a new local implementation.

## Run

Node.js 20.19+ or 22.12+ is required.

```sh
npm install
npm run dev
```

Open the localhost address printed by Vite (normally http://127.0.0.1:5173).
`npm run build` produces `dist`; `npm run preview` serves the built app.
The app makes no external requests at runtime. After installation it works offline
while the local server is running. No cloud account or API key is needed.

## Included

- Unlimited preset count at the application level; browser localStorage capacity
  is the only storage limit. A save failure is shown in the header. Keep JSON
  workspace backups, particularly if importing many response curves.
- Local preset creation, duplication, rename, deletion, search, undo/redo, backup
  and restore. Changes persist in the browser under `peq-studio.workspace.v1`.
- Rename by clicking the title: Enter or blur saves, Escape cancels. Hover a
  preset row to delete it; the toast offers Undo for ten seconds. Drag its grip
  to reorder, or focus the grip and use arrow keys. Reordering persists locally.
- No application band-count limit: peak, low/high shelf, and low/high pass.
  Frequency 20–20,000 Hz, Q 0.1–20. Band gain and preamp accept finite values
  without the original ±12 dB restriction (extreme values remain subject to
  floating-point precision).
- Linked L+R or separate L/R channels; configurable preamp; graph bypass.
- Logarithmic response chart with drag editing, double-click to add, wheel Q,
  keyboard arrows, layer toggles, zoom, normalization and compensated view.
- Drag numerical values up/down or use the mouse wheel, including preamp,
  frequency, gain, Q, and curve offsets. Hold Shift for finer adjustments;
  click a number to type. Each drag or wheel gesture creates one undo step.
- Measured source and target curve import from CSV/TXT/TSV; first two columns
  are frequency in Hz and response in dB. Header/comment lines are skipped.
- Searchable curve-library dropdowns with Custom and Built-in tabs,
  direct import, per-curve deletion, selection clearing and keyboard navigation.
- Both Source and Target offer Built-in targets and Headphone library tabs, so
  either collection can serve either role. Selections survive reload and backup.
- All 13 TOPPING targets and 465 headphone responses are bundled for offline
  use. Source response files load locally on selection. Custom imports share one
  library across both selectors, including existing source/target imports.
  Deletion removes the shared curve and clears either selection using it; it is undoable.
- TXT export for the active channel, stereo preset JSON export, and full workspace
  backup. TOPPING/REW/Equalizer APO-style filter TXT imports are supported.
- Safe gain sets a nonpositive preamp based on the peak sampled response.
- Auto EQ opens an anchored menu and fits the current aligned source to the
  aligned target, including both manual offsets. Set maximum bands, fit range,
  total boost/cut limits, smoothing, Q bounds, optional shelves, and safe preamp.
  Generate replaces all bands in the active channel (both when linked), sets
  preamp and enables PEQ in one undoable change. Cancel leaves the preset intact.
  Valid option changes save immediately and survive refresh, even without
  generating. Workspace backups include these preferences.
- Independent target/source offsets beside the curve labels. A small anchored
  settings popup provides broadband energy matching, broadband mean dB,
  1 kHz alignment, or original levels, plus adjustable range/reference level.
- Display settings can include/exclude preamp gain in the filtered response
  curve (included by default). This does not change EQ settings, the combined
  filter curve, clipping status, or exports. PEQ bypass ignores preamp either way.

Broadband energy matching samples equally in log frequency (equal octave
weighting, like a pink-noise reference) and computes `10 log10(mean(10^(dB/10)))`.
The default comparison range is 100–10,000 Hz. Each curve is shifted to the chosen
reference, then its manual offset is applied. This is a relative comparison,
not calibrated listening SPL or a perceptual loudness estimate. Display settings
persist locally and do not modify imported data or exported EQ filters.

The starter six-band configuration is a **rounded example transcribed from the
provided screenshot**, not an exact cloud backup. Import your exported presets
and measured curves for exact data. The project includes no cloud sync,
system audio processing or device writes.
Browser storage is tied to the exact origin; changing host/port creates a separate
workspace. Backups let you move it between origins and browsers.

## Local Auto EQ

The fitter samples the shared source/target range at 256 logarithmically spaced
frequencies, applies the selected display alignment/offsets, and optionally
smooths the correction with a Gaussian window in octaves (the selected width is
its FWHM). It selects peak/shelf biquads, then refines frequency, gain and Q by
bounded coordinate search. It stops at the requested maximum band count or when
further improvement is negligible. This is an approximate fit, not a guaranteed
global optimum. Filter centers stay inside the fit range; their skirts and
shelves naturally extend beyond it.

The full 20 Hz–20 kHz correction envelope is checked on 2,048 points. Overlapping
filter gains are reduced together when needed to respect total boost/cut limits.
Safe preamp sets attenuation from that sampled peak, rounded down to 0.1 dB;
otherwise generated preamp is 0 dB. Reported fit error is RMS dB before this
headroom attenuation. The filtered curve's “includes preamp” switch controls
whether that attenuation is shown. Fitting runs in a cancellable local worker.
If the preset, channel or curves change during fitting, the result is discarded.

This locally implemented fitter uses the editor's existing biquad coefficients,
consistent with the [Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/).
It is not the optimizer from the separate AutoEq project or TOPPING's cloud service.

## Reserved backend interface

`src/backends/index.js` defines `PeqBackend` and exports a controller. No backend
is currently registered, and editor changes do not send device commands.

A future Equalizer APO integration can implement `connect(options)`, `disconnect()`
and `apply(configuration)` through a local companion service. Browsers cannot
directly edit Equalizer APO's system configuration files. That service and its
permission/connection UI are intentionally not implemented yet.

```js
import { backend } from './src/backends/index.js';
backend.register(myEqualizerApoAdapter);
await backend.connect({ /* future local service options */ });
await backend.apply(preset, { sampleRate: 48000 });
await backend.disconnect();
```

The versioned apply payload contains `name`, `enabled`, `linked`, `sampleRate`,
`left`, and `right`. Each channel contains `preampDb` and `filters` with
`enabled`, `type`, `fcHz`, `gainDb`, `q`. Disabled PEQ means complete bypass,
including preamp. Linked mode sends identical channels. Adapters must reject
unsupported settings instead of silently truncating them. Failed applies do not
modify the editor's saved presets.

## Verify and reproduce extraction

```sh
npm test
npm run build
npm run extract
```

`node scripts/fetch-targets.mjs` and `node scripts/fetch-sources.mjs` refresh the bundled catalogs from the
original public endpoints. This is an explicit maintenance step requiring the
internet; the running editor does not contact those endpoints. Built-in curves
are stored in the app assets; localStorage holds only their selected IDs, while
custom imports and their data remain in the local workspace and its backups.

Tests cover analytical filter behavior, import/export round trips, curve
interpolation, validation, large preset counts and the reserved backend contract.
See [source provenance](reference/PROVENANCE.md) for the upstream bundle and the
distinction between original extracted code and the newly implemented UI.
