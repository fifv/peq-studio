import type { Preset } from './types.ts';
import { clone, validateState } from './model.ts';

export type BlindSide = 'A' | 'B';
export type BlindChoice = BlindSide | 'tie';
type Identity = 0 | 1;
export interface BlindSession {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  /** Explicitly dismissed tests stay in the menu without reopening on refresh. */
  closed?: boolean;
  presets: [Preset, Preset];
  sampleRate: number;
  round: { a: Identity; side: BlindSide; heard: BlindSide[] };
  votes: { a: Identity; choice: BlindChoice; winner: Identity | null }[];
}
export interface BlindStore {
  version: 1;
  sessions: BlindSession[];
}
export const BLIND_STORAGE_KEY = 'peq-studio.blind-tests.v1';
const bit = (): Identity => (crypto.getRandomValues(new Uint8Array(1))[0] & 1) as Identity;
const makeRound = (random = bit): BlindSession['round'] => ({
  a: random(),
  side: random() ? 'B' : 'A',
  heard: [],
});
export function createBlindSession(
  first: Preset,
  second: Preset,
  sampleRate: number,
  random = bit,
): BlindSession {
  if (first.id === second.id) throw Error('Choose a different preset for the blind comparison.');
  return {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    presets: clone([first, second]),
    sampleRate,
    round: makeRound(random),
    votes: [],
  };
}
export function blindIdentity(session: BlindSession, side: BlindSide): Identity {
  return side === 'A' ? session.round.a : ((1 - session.round.a) as Identity);
}
/** Anonymous payloads keep preset names out of the managed APO file during listening. */
export function blindPlayback(session: BlindSession): Preset {
  const preset = clone(session.presets[blindIdentity(session, session.round.side)]);
  return { ...preset, id: 'blind-comparison', name: 'Blind comparison', enabled: true };
}
export function voteBlind(session: BlindSession, choice: BlindChoice, random = bit) {
  if (
    session.finishedAt ||
    !['A', 'B'].every((side) => session.round.heard.includes(side as BlindSide))
  )
    throw Error('Listen to both choices before voting.');
  session.votes.push({
    a: session.round.a,
    choice,
    winner: choice === 'tie' ? null : blindIdentity(session, choice),
  });
  session.round = makeRound(random);
}
export function blindResults(session: BlindSession) {
  return {
    first: session.votes.filter((v) => v.winner === 0).length,
    second: session.votes.filter((v) => v.winner === 1).length,
    ties: session.votes.filter((v) => v.winner === null).length,
  };
}
/** Reject damaged test records rather than changing a saved blind assignment or result. */
export function readBlindStore(text: string | null): BlindStore {
  if (!text) return { version: 1, sessions: [] };
  const value = JSON.parse(text) as BlindStore;
  if (value?.version !== 1 || !Array.isArray(value.sessions))
    throw Error('Invalid blind test history.');
  const ids = new Set<string>();
  for (const session of value.sessions) {
    if (
      !session ||
      typeof session.id !== 'string' ||
      ids.has(session.id) ||
      typeof session.startedAt !== 'string' ||
      (session.closed !== undefined && typeof session.closed !== 'boolean') ||
      !Number.isFinite(Date.parse(session.startedAt)) ||
      (session.finishedAt !== null &&
        (typeof session.finishedAt !== 'string' ||
          !Number.isFinite(Date.parse(session.finishedAt)))) ||
      !Array.isArray(session.presets) ||
      session.presets.length !== 2 ||
      ![44100, 48000, 96000, 192000].includes(session.sampleRate) ||
      !session.round ||
      ![0, 1].includes(session.round.a) ||
      !['A', 'B'].includes(session.round.side) ||
      !Array.isArray(session.round.heard) ||
      session.round.heard.some((side) => !['A', 'B'].includes(side)) ||
      !Array.isArray(session.votes)
    )
      throw Error('Invalid saved blind test.');
    ids.add(session.id);
    session.presets = validateState({
      version: 1,
      presets: session.presets,
      curves: [],
      sampleRate: session.sampleRate,
    }).presets as [Preset, Preset];
    for (const vote of session.votes) {
      if (
        !vote ||
        ![0, 1].includes(vote.a) ||
        !['A', 'B', 'tie'].includes(vote.choice) ||
        vote.winner !== (vote.choice === 'tie' ? null : vote.choice === 'A' ? vote.a : 1 - vote.a)
      )
        throw Error('Invalid saved blind vote.');
    }
  }
  if (value.sessions.filter((s) => !s.finishedAt).length > 1)
    throw Error('Multiple unfinished blind tests.');
  return value;
}
