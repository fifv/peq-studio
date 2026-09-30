# PEQ Studio — local TOPPING PEQ extraction

> Notes from human: this project is entirely vibe coded by Codex-Astra(High)

A standalone, local-first editor based on https://home.toppingaudio.com/peq.
The DSP calculation and TXT/JSON import/export core are extracted from the public
TOPPING Home v1.14.0 client bundle. The editor around them is a new local implementation.

## Development structure

The application, worker, tests, and maintenance scripts use strict TypeScript.
Vite 8 serves and bundles the app; there is no UI framework or charting dependency.
HTML, CSS, SVG, Web Workers, and localStorage provide the browser functionality.

- `src/types.ts` defines the shared preset, filter, curve, workspace, and worker contracts.
- `src/model.ts`, `validation.ts`, and `history.ts` handle persisted data, imports,
  migrations, and undo/redo. Existing workspace storage remains compatible.
- `src/response.ts`, `curve-math.ts`, `curve-level.ts`, and `autoeq.ts` contain the
  numerical work. `autoeq-worker.ts` runs fitting away from the UI thread.
- `src/main.ts` connects application state to the UI. `src/ui/` separates chart
  rendering, templates, editor controls, file actions, dialogs, and popup placement.
- Curve selection, display settings, and Auto EQ each have a focused controller.
  Numeric gestures, validation, formatting, and popup behavior use shared helpers.
- `src/backends/` connects the editor to the Go console backend and serializes live updates.
- `backend/` serves the local app and manages the Equalizer APO include file.
- `tests/` uses the Node test runner through `tsx`; Prettier keeps formatting consistent.

The generated JavaScript in `src/vendor/` and original bundles in `reference/`
are deliberately preserved as upstream artifacts. Typed declarations describe the
vendor API without rewriting its extracted filter calculations and file formats.

## Run

Node.js 20.19+ or 22.12+ is required.

```sh
npm install
npm run dev
```

Open the localhost address printed by Vite (normally http://127.0.0.1:5173).
`npm run build` produces `dist`; `npm run preview` serves the built app.
The editor loads its assets from the frontend host and connects directly to the optional
local Go backend at `http://127.0.0.1:8765`. Locally hosted builds work offline.
No cloud account or API key is needed.

## GitHub Pages

```sh
npm run deploy
```

This builds and type-checks the app, then publishes `dist` to the `gh-pages`
branch of the configured Git remote. In repository Settings → Pages, use
“Deploy from a branch” with `gh-pages` and `/ (root)`.

Vite uses relative asset paths so the same build works under a repository path
such as `/peq-studio/` or at a domain root. Scripts, styles, the Auto EQ worker,
and the local curve library all stay within the deployed site directory.
Deploy the generated `dist` files, not the source `index.html`.

The hosted frontend connects to the same fixed `http://127.0.0.1:8765` backend as
the local frontend. Keep `npm run backend` running on your Windows computer.
Allow local network access for this site if the browser requests it.
The default trusted hosted origin is `https://fifv.github.io`; forks and custom
domains can use `-allow-origin https://your-domain.example` when starting the backend.

## Included

- Unlimited preset count at the application level; browser localStorage capacity
  is the only storage limit. A save failure is shown in the sidebar. Keep JSON
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
- Linked L+R or separate L/R channels; configurable preamp; full processing bypass.
- Quick A/B: click **A · EQ / B · Preamp only**, or press **B** outside text fields,
  to toggle all filters while keeping each channel's preamp gain unchanged. Individual
  band toggles remain intact. **Power** bypasses both filters and preamp; A/B is disabled
  while Power is off. Comparison mode persists per preset and supports undo/redo.
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
and measured curves for exact data. The project includes no cloud sync. The optional
Go backend writes an Equalizer APO include file for system audio processing;
the browser-only version stays local to the browser.
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

## Equalizer APO console backend

Install Go 1.22+ and Equalizer APO on Windows. From this project directory:

```sh
npm run build
npm run backend
```

Open <http://127.0.0.1:8765> or the updated GitHub Pages frontend. The Go process
runs in the console on fixed port **8765**, serves `dist` when available,
and creates `peqstudio.txt` in Equalizer APO's config directory. It discovers
`HKLM\SOFTWARE\EqualizerAPO\ConfigPath`, falling back to
`C:\Program Files\EqualizerAPO\config`. For a custom install or development directory:

```sh
npm run backend -- -config-dir 'D:/Audio/EqualizerAPO/config'
```

The directory must already exist and be writable. If access is denied, grant your
account write access to that directory or run the console with sufficient permissions.
The backend will refuse to overwrite an existing `peqstudio.txt` without its managed
header; rename that file first. On restart, it preserves the last managed configuration
until the frontend connects. A newly created file starts in bypass.

**You choose when to use the file.** In Equalizer APO Configuration Editor, add an
Include configuration selecting `peqstudio.txt`, or add this line yourself to your
active configuration (normally `config.txt`):

```text
Include: peqstudio.txt
```

PEQ Studio never changes `config.txt`, device selection, or your other APO files.
Include the file once to avoid applying the same filters multiple times. The managed
file is rewritten from the active frontend preset; make edits in PEQ Studio.

Every EQ change is sent immediately, including chart and numeric drags, typing,
band toggles, preamp, link/split, preset selection, imports, Auto EQ, and undo/redo.
Writes are serialized; while a request is in flight, only the latest pending edit
is kept. Rapid wheel/drag edits are sent at most about 30 times per second, with
the first edit immediate and the final value sent on the next available update.
This is a throttle, so ongoing scrolling never waits for the gesture to end.
The client retries failed writes automatically with the latest settings.
The footer shows syncing, synced, or not synced; click it for setup details and
the managed file path. “Synced” confirms the file write, not whether APO is installed
on your audio device or the file has been included. Display-only controls do not
rewrite the audio configuration. Multiple open editors share the same output file;
use one editor at a time to avoid competing changes.

Linked settings apply to L/R together; split mode writes independent channel
preamps and filters. Power off omits filters and preamp. Comparison B omits only the
filters and keeps channel preamps; it does not change any stored filter settings.
The combined chart, hover readings, and filtered-curve CSV reflect comparison mode.
Preset JSON/backups preserve that mode; filter-settings TXT exports still contain
the stored bands so comparison does not erase your exported EQ. Disabled bands are written
as `OFF`. LP/HP use `LPQ`/`HPQ` to preserve Q, and shelves use `LSC`/`HSC` (APO 1.2.1+).
See the [Equalizer APO configuration reference](https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/).
APO evaluates filters at the audio device's actual sample rate; the editor sample
rate controls its preview and should match your device. The file resets channel
selection to `ALL` after its stereo processing.

Updates replace the complete file in its own directory, so APO never reads a
partially written update. Windows sharing/access errors from brief reader locks
are retried after 5–40 ms, for up to 250 ms per file operation. Longer locks return
a busy response; the frontend keeps its connection and retries the newest edit
after 50 ms instead of waiting two seconds to reconnect. Persistent locks or
permission problems remain visible as a sync error. Live updates use closed,
buffered writes rather than forcing a physical disk flush for every wheel tick.
Ctrl+C stops the server and leaves the last EQ in place.
To stop processing, turn Power off before closing or remove the Include in APO yourself.
The server binds only to `127.0.0.1:8765`. Requests from localhost browser origins
and `https://fifv.github.io` are allowed through CORS; all other remote origins are
rejected unless added explicitly using the repeatable `-allow-origin` flag. Origins
do not include paths: the allowlist trusts the entire origin, including its other projects.
Writes require the session token returned by the status endpoint. Preflights support
`GET`, `PUT`, and the older Private Network Access header. Newer browsers may ask for
[local network access permission](https://developer.chrome.com/blog/local-network-access).
If your browser blocks access, allow it in the site's permissions or use the local editor.
The backend is never exposed on the LAN.

For frontend development, keep `npm run backend` running and use `npm run dev`
in a second console. Development, preview, and hosted builds all call port 8765
directly; no Vite proxy or per-frontend port configuration is needed.
Keep using the same browser origin to retain the same localStorage workspace,
or export/import a workspace backup when moving between ports.

```sh
npm run backend:test
npm run backend:build
./bin/peqstudio.exe -config-dir 'C:/Program Files/EqualizerAPO/config' -web-dir dist
```

The executable needs `dist` only to serve the local frontend; the hosted frontend
works without it. Paths are relative to the working directory. The port is fixed;
if it is occupied, startup reports an error rather than silently picking another port.
`GET /api/status` returns setup details and a session token; `PUT /api/config`
accepts the versioned `BackendConfiguration` with `X-PEQ-Token` and JSON content type.
`enabled: false` bypasses everything; `filtersEnabled: false` bypasses filters only.
Omitting `filtersEnabled` retains the old behavior of enabling filters when powered on.
The backend validates requests before touching the file and reports write failures.
Payloads over 8 MiB are rejected explicitly; filter lists are never truncated.

## Verify and reproduce extraction

```sh
npm test
npm run typecheck
npm run build
npm run format:check
npm run extract
```

`npx tsx scripts/fetch-targets.ts` and `npx tsx scripts/fetch-sources.ts` refresh the bundled catalogs from the
original public endpoints. This is an explicit maintenance step requiring the
internet; the running editor does not contact those endpoints. Built-in curves
are stored in the app assets; localStorage holds only their selected IDs, while
custom imports and their data remain in the local workspace and its backups.

Tests cover analytical filter behavior, import/export round trips, curve
interpolation, validation, Auto EQ, undo/redo, large preset counts, backend contracts,
live sync ordering/recovery, and Go configuration rendering, persistence, and HTTP validation.
The production build runs the strict type checker first. Use `npm run format` to
format authored source; bundled datasets and original vendor files are excluded.
See [source provenance](reference/PROVENANCE.md) for the upstream bundle and the
distinction between original extracted code and the newly implemented UI.
