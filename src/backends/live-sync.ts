import { backendConfiguration, type PeqBackend } from './index.ts';
import type { Preset } from '../types.ts';
import { BackendBusyError } from './errors.ts';

export interface SyncStatus {
  kind: 'syncing' | 'synced' | 'error';
  message: string;
}

/** Serialize writes and coalesce edits while a request is in flight. Never let
 * an older drag position arrive after a newer one, and retain the newest edit
 * through outages. Display-only changes are ignored by comparing EQ payloads. */
export function createLiveSync(
  adapter: PeqBackend,
  onStatus: (status: SyncStatus) => void,
  retryMs = 2000,
) {
  let desired = '';
  let applied = '';
  let connected = false;
  let running = false;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let lastWrite = -Infinity;
  let busySince: number | undefined;
  // Throttle (not debounce): continuous scrolling still updates throughout the
  // gesture, without making APO reload for every individual wheel event.
  const writeIntervalMs = 33;

  async function pump() {
    if (running || stopped || retry || desired === applied) return;
    running = true;
    onStatus({ kind: 'syncing', message: 'Writing peqstudio.txt…' });
    try {
      if (!connected) {
        await adapter.connect();
        connected = true;
      }
      while (!stopped && desired !== applied) {
        const wait = writeIntervalMs - (performance.now() - lastWrite);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        if (stopped || desired === applied) break;
        const sending = desired;
        lastWrite = performance.now();
        await adapter.apply(JSON.parse(sending));
        applied = sending;
        busySince = undefined;
      }
      if (!stopped) onStatus({ kind: 'synced', message: 'peqstudio.txt is up to date.' });
    } catch (error) {
      const busy = error instanceof BackendBusyError;
      if (!busy) connected = false;
      // A timeout may occur after the server wrote the file. Force reconciliation
      // even when the user has since undone back to the last acknowledged EQ.
      applied = '';
      if (!stopped) {
        if (busy) busySince ??= performance.now();
        const prolonged = busy && performance.now() - busySince! >= 2000;
        onStatus({
          kind: busy && !prolonged ? 'syncing' : 'error',
          message:
            busy && !prolonged
              ? 'Waiting for Equalizer APO to release peqstudio.txt…'
              : error instanceof Error
                ? error.message
                : 'Equalizer APO sync failed.',
        });
        retry = setTimeout(
          () => {
            retry = undefined;
            void pump();
          },
          busy ? (prolonged ? 1000 : error.retryAfterMs) : retryMs,
        );
      }
    } finally {
      running = false;
    }
  }

  return {
    update(preset: Preset, sampleRate: number) {
      if (stopped) return;
      desired = JSON.stringify(backendConfiguration(preset, sampleRate));
      void pump();
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
    },
  };
}
