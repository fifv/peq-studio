import type { BackendConfiguration, PeqBackend } from './index.ts';
import { BackendBusyError } from './errors.ts';

export const BACKEND_URL = 'http://127.0.0.1:8765';

export function createEqualizerApoBackend(fetcher: typeof fetch = fetch): PeqBackend & {
  readonly configPath: string;
} {
  let token = '';
  let configPath = '';
  async function request(path: string, options?: RequestInit) {
    const requestOptions: RequestInit & { targetAddressSpace: 'loopback' } = {
      ...options,
      mode: 'cors',
      credentials: 'omit',
      targetAddressSpace: 'loopback',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    };
    let response: Response;
    try {
      response = await fetcher(`${BACKEND_URL}/api/${path}`, requestOptions);
    } catch {
      throw Error(
        'Cannot reach the local backend at port 8765. Start it and allow local network access for this site if your browser asks.',
      );
    }
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw Error('Start the Go backend to sync with Equalizer APO.');
    const data = await response.json();
    if (response.status === 503 && data.code === 'config_busy')
      throw new BackendBusyError(
        data.error || 'Equalizer APO configuration is busy.',
        typeof data.retryAfterMs === 'number' && Number.isFinite(data.retryAfterMs)
          ? Math.max(25, Math.min(250, data.retryAfterMs))
          : 50,
      );
    if (!response.ok) throw Error(data.error || `Backend request failed (${response.status}).`);
    return data;
  }
  return {
    id: 'equalizer-apo',
    name: 'Equalizer APO',
    get configPath() {
      return configPath;
    },
    async connect() {
      const status = await request('status');
      if (
        status.backend !== 'equalizer-apo' ||
        status.version !== 1 ||
        typeof status.token !== 'string' ||
        !status.token ||
        typeof status.configPath !== 'string'
      )
        throw Error('Incompatible Equalizer APO backend.');
      token = status.token;
      configPath = status.configPath;
    },
    async disconnect() {
      token = '';
    },
    async apply(configuration: BackendConfiguration) {
      if (!token) throw Error('Connect the Equalizer APO backend first.');
      await request('config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-PEQ-Token': token },
        body: JSON.stringify(configuration),
      });
    },
  };
}
