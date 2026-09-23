import { clone, validateChannel } from '../model.js';

/**
 * Reserved backend adapter contract. No backend is installed by default.
 * An Equalizer APO adapter can later talk to a local companion service here.
 *
 * @typedef {Object} PeqBackend
 * @property {string} id Stable backend identifier, e.g. "equalizer-apo".
 * @property {string} name Display name.
 * @property {(options?: object) => Promise<void>} connect Explicitly establish access.
 * @property {() => Promise<void>} disconnect Release access.
 * @property {(configuration: object) => Promise<void>} apply Apply BOTH channels
 * atomically if possible. Receives {version, name, enabled, linked, sampleRate,
 * left: {preampDb, filters}, right: {preampDb, filters}}. Filter type codes:
 * PK, LSC, HSC, LP, HP; frequencies in Hz; gain/preamp in dB; Q dimensionless.
 * A disabled configuration means bypass ALL filters AND preamp.
 * Reject with an actionable Error if unsupported. Never silently truncate.
 */
export function createBackendController() {
  let adapter = null, connected = false, busy = false;
  const requireIdle = () => { if (busy) throw Error('Backend operation already in progress.'); };
  return {
    get status() { return { id: adapter?.id ?? null, name: adapter?.name ?? null, connected, busy }; },
    /** @param {PeqBackend} next */
    register(next) {
      requireIdle();
      if (connected) throw Error('Disconnect before replacing the backend.');
      if (!next?.id || !next?.name || !['connect','disconnect','apply'].every(k => typeof next[k] === 'function')) throw Error('Invalid PEQ backend adapter.');
      adapter = next;
    },
    async connect(options) {
      requireIdle(); if (!adapter) throw Error('No backend configured.'); if (connected) return;
      busy = true;
      try { await adapter.connect(options); connected = true; } finally { busy = false; }
    },
    async disconnect() {
      requireIdle(); if (!connected) return; busy = true;
      try { await adapter.disconnect(); connected = false; } finally { busy = false; }
    },
    async apply(preset, { sampleRate = 48000 } = {}) {
      requireIdle(); if (!adapter || !connected) throw Error('Connect a backend before applying PEQ.');
      if (![44100,48000,96000,192000].includes(sampleRate)) throw Error('Unsupported sample rate.');
      const configuration = clone({ version: 1, name: preset.name, enabled: preset.enabled !== false, linked: preset.linked !== false,
        sampleRate, left: validateChannel(preset.left), right: validateChannel(preset.linked ? preset.left : preset.right) });
      busy = true;
      try { await adapter.apply(configuration); } finally { busy = false; }
    },
  };
}

// Future integrations register here. Merely editing a preset never writes to a
// device. A future UI must explicitly connect and apply through this controller.
export const backend = createBackendController();
