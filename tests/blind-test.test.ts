import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blindIdentity,
  blindPlayback,
  blindResults,
  createBlindSession,
  readBlindStore,
  voteBlind,
} from '../src/blind-test.ts';
import { initialState, newBand } from '../src/model.ts';

test('blind tests snapshot prepared presets and use anonymous full-EQ playback without editing originals', () => {
  const state = initialState();
  const [first, second] = state.presets;
  first.enabled = false;
  first.linked = false;
  first.right.preampDb = -9;
  first.right.filters = [newBand(800, 2)];
  state.filtersEnabled = false;
  const before = JSON.stringify(state);
  const session = createBlindSession(first, second, 96000, () => 0);
  const playing = blindPlayback(session);
  assert.equal(playing.name, 'Blind comparison');
  assert.equal(playing.enabled, true);
  assert.equal(playing.linked, false);
  assert.deepEqual(playing.right, first.right);
  assert.deepEqual(playing.left, first.left);
  assert.equal(JSON.stringify(state), before);
  first.left.preampDb = -20;
  assert.notEqual(session.presets[0].left.preampDb, -20);
  playing.right.preampDb = 0;
  assert.equal(session.presets[0].right.preampDb, -9);
  assert.throws(() => createBlindSession(first, first, 48000), /different preset/);
});

test('round mapping and starting side are independent; votes map to identities and have no round limit', () => {
  const [first, second] = initialState().presets;
  const bits: (0 | 1)[] = [1, 0];
  const session = createBlindSession(first, second, 48000, () => bits.shift()!);
  assert.equal(session.round.a, 1);
  assert.equal(session.round.side, 'A');
  assert.equal(blindIdentity(session, 'B'), 0);
  assert.throws(() => voteBlind(session, 'A'), /both/);
  session.round.heard = ['A'];
  assert.throws(() => voteBlind(session, 'A'), /both/);
  session.round.heard.push('B');
  voteBlind(session, 'A', () => 0);
  assert.deepEqual(session.votes[0], { a: 1, choice: 'A', winner: 1 });
  assert.deepEqual({ ...session.round }, { a: 0, side: 'A', heard: [] });
  for (let i = 0; i < 150; i++) {
    session.round.heard = ['A', 'B'];
    voteBlind(session, i % 2 ? 'tie' : 'A', () => 0);
  }
  assert.deepEqual(blindResults(session), { first: 75, second: 1, ties: 75 });
  assert.equal(session.finishedAt, null);
  session.finishedAt = new Date().toISOString();
  assert.throws(() => voteBlind(session, 'A'), /both/);
});

test('refresh preserves snapshots, assignments, partial listening, votes, and completed history', () => {
  const [first, second] = initialState().presets;
  const session = createBlindSession(first, second, 48000, () => 1);
  session.round.heard = ['A', 'B'];
  voteBlind(session, 'B', () => 0);
  session.round.side = 'B';
  session.round.heard = ['B'];
  const store = { version: 1, sessions: [session] };
  const restored = readBlindStore(JSON.stringify(store));
  assert.deepEqual(restored, store);
  session.closed = true;
  assert.equal(readBlindStore(JSON.stringify(store)).sessions[0].closed, true);
  session.closed = false;
  assert.equal(readBlindStore(JSON.stringify(store)).sessions[0].closed, false);
  session.finishedAt = new Date().toISOString();
  store.sessions.push(createBlindSession(first, second, 96000));
  assert.deepEqual(readBlindStore(JSON.stringify(store)), store);
  assert.deepEqual(readBlindStore(null), { version: 1, sessions: [] });
  store.sessions[0].votes[0].winner = 1;
  assert.throws(() => readBlindStore(JSON.stringify(store)), /vote/);
  assert.throws(() => readBlindStore('{'), SyntaxError);
});
