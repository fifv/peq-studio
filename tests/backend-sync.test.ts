import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createLiveSync, type SyncStatus } from '../src/backends/live-sync.ts';
import { BACKEND_URL, createEqualizerApoBackend } from '../src/backends/equalizer-apo.ts';
import { backendConfiguration, type BackendConfiguration } from '../src/backends/index.ts';
import { newPreset } from '../src/model.ts';
import { BackendBusyError } from '../src/backends/errors.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail('Timed out waiting for sync');
}

test('live edits serialize and coalesce, including undo during an in-flight write', async () => {
  const first = deferred();
  const sent: BackendConfiguration[] = [];
  const statuses: SyncStatus[] = [];
  let active = 0;
  const sync = createLiveSync(
    {
      id: 'test',
      name: 'test',
      async connect() {},
      async disconnect() {},
      async apply(c) {
        assert.equal(++active, 1);
        sent.push(c);
        if (sent.length === 1) await first.promise;
        active--;
      },
    },
    (s) => statuses.push(s),
  );
  const p = newPreset();
  sync.update(p, 48000);
  await until(() => sent.length === 1);
  p.left.preampDb = -2;
  sync.update(p, 48000);
  p.left.preampDb = -9;
  sync.update(p, 48000);
  first.resolve();
  await until(() => statuses.at(-1)?.kind === 'synced');
  assert.deepEqual(
    sent.map((c) => c.left.preampDb),
    [0, -9],
  );
  assert.equal(sent[1].right.preampDb, -9);
  p.targetId = 'display-only';
  sync.update(p, 48000);
  await delay(10);
  assert.equal(sent.length, 2);
  p.left.preampDb = 0;
  sync.update(p, 48000);
  await until(() => sent.length === 3);
  assert.equal(sent[2].left.preampDb, 0);
  sync.stop();
});

test('an outage retries automatically with the latest preset and reconnects', async (t) => {
  const sent: BackendConfiguration[] = [];
  let connects = 0;
  let online = false;
  const statuses: SyncStatus[] = [];
  const sync = createLiveSync(
    {
      id: 'test',
      name: 'test',
      async connect() {
        connects++;
        if (!online) throw Error('offline');
      },
      async disconnect() {},
      async apply(c) {
        sent.push(c);
      },
    },
    (s) => statuses.push(s),
    10,
  );
  t.after(() => sync.stop());
  const p = newPreset();
  sync.update(p, 48000);
  await until(() => statuses.at(-1)?.kind === 'error');
  p.left.preampDb = -7;
  sync.update(p, 48000);
  online = true;
  await until(() => statuses.at(-1)?.kind === 'synced');
  assert.ok(connects >= 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].left.preampDb, -7);
});

test('an uncertain write is reconciled even after undo returns to last acknowledged state', async (t) => {
  let fail = false;
  const sent: number[] = [];
  const statuses: SyncStatus[] = [];
  const sync = createLiveSync(
    {
      id: 'test',
      name: 'test',
      async connect() {},
      async disconnect() {},
      async apply(c) {
        sent.push(c.left.preampDb);
        if (fail) throw Error('timed out after write');
      },
    },
    (s) => statuses.push(s),
    10,
  );
  t.after(() => sync.stop());
  const p = newPreset();
  sync.update(p, 48000);
  await until(() => statuses.at(-1)?.kind === 'synced');
  fail = true;
  p.left.preampDb = -4;
  sync.update(p, 48000);
  await until(() => statuses.at(-1)?.kind === 'error');
  p.left.preampDb = 0;
  sync.update(p, 48000);
  fail = false;
  await until(() => statuses.at(-1)?.kind === 'synced');
  assert.deepEqual(sent, [0, -4, 0]);
});

test('HTTP adapter uses the backend session token and surfaces write errors', async () => {
  const calls: RequestInit[] = [];
  const adapter = createEqualizerApoBackend(async (input, init) => {
    assert.equal(input, `${BACKEND_URL}/api/${calls.length ? 'config' : 'status'}`);
    assert.equal(init?.mode, 'cors');
    assert.equal(init?.credentials, 'omit');
    calls.push(init!);
    return Response.json(
      calls.length === 1
        ? {
            backend: 'equalizer-apo',
            version: 1,
            token: 'session',
            configPath: 'C:/APO/config/peqstudio.txt',
          }
        : { error: 'Permission denied' },
      { status: calls.length === 1 ? 200 : 500 },
    );
  });
  await adapter.connect();
  assert.equal(adapter.configPath, 'C:/APO/config/peqstudio.txt');
  await assert.rejects(adapter.apply(backendConfiguration(newPreset())), /Permission denied/);
  assert.equal(new Headers(calls[1].headers).get('X-PEQ-Token'), 'session');
  assert.equal(calls[1].method, 'PUT');
  await adapter.disconnect();
  await assert.rejects(adapter.apply(backendConfiguration(newPreset())), /Connect/);
});

test('A/B changes sync with the original preamp and stored bands intact', async (t) => {
  const sent: BackendConfiguration[] = [];
  const sync = createLiveSync(
    {
      id: 'test',
      name: 'test',
      async connect() {},
      async disconnect() {},
      async apply(c) {
        sent.push(c);
      },
    },
    () => {},
  );
  t.after(() => sync.stop());
  const p = newPreset();
  p.left.preampDb = -6;
  sync.update(p, 48000);
  await until(() => sent.length === 1);
  p.filtersEnabled = false;
  sync.update(p, 48000);
  await until(() => sent.length === 2);
  assert.equal(sent[1].enabled, true);
  assert.equal(sent[1].filtersEnabled, false);
  assert.equal(sent[1].left.preampDb, -6);
  p.filtersEnabled = true;
  sync.update(p, 48000);
  await until(() => sent.length === 3);
  assert.equal(sent[2].filtersEnabled, true);
});

test('a busy config retries the newest value quickly without reconnecting', async (t) => {
  let connects = 0;
  let attempts = 0;
  const sent: number[] = [];
  const statuses: SyncStatus[] = [];
  const sync = createLiveSync(
    {
      id: 'test',
      name: 'test',
      async connect() {
        connects++;
      },
      async disconnect() {},
      async apply(c) {
        attempts++;
        if (attempts === 1) throw new BackendBusyError('file locked');
        sent.push(c.left.preampDb);
      },
    },
    (s) => statuses.push(s),
  );
  t.after(() => sync.stop());
  const p = newPreset();
  const started = performance.now();
  sync.update(p, 48000);
  await until(() => attempts === 1);
  for (let i = 1; i <= 100; i++) {
    p.left.preampDb = -i / 10;
    sync.update(p, 48000);
  }
  await until(() => statuses.at(-1)?.kind === 'synced');
  assert.equal(connects, 1);
  assert.deepEqual(sent, [-10]);
  assert.ok(performance.now() - started < 500, 'brief locks must not trigger a two-second retry');
  assert.equal(
    statuses.some((s) => s.kind === 'error'),
    false,
  );
});

test('continuous rapid edits are throttled without waiting for scrolling to stop', async (t) => {
  const sent: { gain: number; at: number }[] = [];
  const sync = createLiveSync(
    {
      id: 'test',
      name: 'test',
      async connect() {},
      async disconnect() {},
      async apply(c) {
        sent.push({ gain: c.left.preampDb, at: performance.now() });
      },
    },
    () => {},
  );
  t.after(() => sync.stop());
  const p = newPreset();
  sync.update(p, 48000);
  await until(() => sent.length === 1);
  for (let i = 1; i <= 30; i++) {
    p.left.preampDb = -i / 10;
    sync.update(p, 48000);
    await delay(5);
  }
  assert.ok(sent.length > 2, 'writes must continue during the gesture');
  assert.ok(sent.length < 20, 'wheel events must not each cause a file reload');
  await until(() => sent.at(-1)?.gain === -3);
  for (let i = 1; i < sent.length; i++)
    assert.ok(sent[i].at - sent[i - 1].at >= 25, 'writes should stay roughly one frame apart');
});

test('HTTP busy replies retain retry information instead of becoming generic connection errors', async () => {
  const adapter = createEqualizerApoBackend(async (input) =>
    String(input).endsWith('/status')
      ? Response.json({
          backend: 'equalizer-apo',
          version: 1,
          token: 'session',
          configPath: 'peqstudio.txt',
        })
      : Response.json(
          { code: 'config_busy', error: 'file locked', retryAfterMs: 50 },
          { status: 503 },
        ),
  );
  await adapter.connect();
  await assert.rejects(
    adapter.apply(backendConfiguration(newPreset())),
    (error) => error instanceof BackendBusyError && error.retryAfterMs === 50,
  );
});
