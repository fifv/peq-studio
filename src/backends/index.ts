import type { Preset, Channel } from '../types.ts';
import { clone, validateChannel } from '../model.ts';
export interface BackendConfiguration {
  version: number;
  name: string;
  enabled: boolean;
  linked: boolean;
  sampleRate: number;
  left: Channel;
  right: Channel;
}
/** Optional adapter to a local companion service. Editing never applies device changes. */
export interface PeqBackend {
  id: string;
  name: string;
  connect(options?: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  /** Apply both channels; disabled means full bypass including preamp.
   * Reject unsupported settings with an actionable error; never silently truncate. */
  apply(configuration: BackendConfiguration): Promise<void>;
}
export function createBackendController() {
  let adapter: PeqBackend | null = null,
    connected = false,
    busy = false;
  const requireIdle = () => {
    if (busy) throw Error('Backend operation already in progress.');
  };
  return {
    get status() {
      return { id: adapter?.id ?? null, name: adapter?.name ?? null, connected, busy };
    },
    register(next: PeqBackend) {
      requireIdle();
      if (connected) throw Error('Disconnect before replacing the backend.');
      if (
        !next?.id ||
        !next?.name ||
        !(['connect', 'disconnect', 'apply'] as const).every((k) => typeof next[k] === 'function')
      )
        throw Error('Invalid PEQ backend adapter.');
      adapter = next;
    },
    async connect(options?: Record<string, unknown>) {
      requireIdle();
      if (!adapter) throw Error('No backend configured.');
      if (connected) return;
      busy = true;
      try {
        await adapter.connect(options);
        connected = true;
      } finally {
        busy = false;
      }
    },
    async disconnect() {
      requireIdle();
      if (!connected) return;
      busy = true;
      try {
        await adapter!.disconnect();
        connected = false;
      } finally {
        busy = false;
      }
    },
    async apply(preset: Preset, { sampleRate = 48000 } = {}) {
      requireIdle();
      if (!adapter || !connected) throw Error('Connect a backend before applying PEQ.');
      if (![44100, 48000, 96000, 192000].includes(sampleRate))
        throw Error('Unsupported sample rate.');
      const configuration = clone({
        version: 1,
        name: preset.name,
        enabled: preset.enabled !== false,
        linked: preset.linked !== false,
        sampleRate,
        left: validateChannel(preset.left),
        right: validateChannel(preset.linked ? preset.left : preset.right),
      });
      busy = true;
      try {
        await adapter.apply(configuration);
      } finally {
        busy = false;
      }
    },
  };
}

// Future integrations register here. Merely editing a preset never writes to a
// device. A future UI must explicitly connect and apply through this controller.
export const backend = createBackendController();
