import type { Workspace } from '../types.ts';
import type { SyncStatus } from '../backends/live-sync.ts';
import { activePreset, escapeHtml as esc } from '../utils.ts';
import { clone } from '../model.ts';
import {
  BLIND_STORAGE_KEY,
  blindPlayback,
  blindResults,
  createBlindSession,
  readBlindStore,
  voteBlind,
  type BlindChoice,
  type BlindSide,
  type BlindStore,
} from '../blind-test.ts';
import { icon } from './icons.ts';

export interface BlindTestController {
  playback(): { preset: ReturnType<typeof blindPlayback>; sampleRate: number } | null;
  onSync(status: SyncStatus): void;
}
export function createBlindTest({
  getState,
  sync,
  isSyncEnabled,
  toast,
  storage = localStorage,
}: {
  getState: () => Workspace;
  sync: () => void;
  isSyncEnabled: () => boolean;
  toast: (message: string) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}): BlindTestController {
  let store: BlindStore = { version: 1, sessions: [] };
  let storageError = '';
  try {
    store = readBlindStore(storage.getItem(BLIND_STORAGE_KEY));
  } catch {
    storageError = 'Saved blind tests could not be loaded. They have not been overwritten.';
  }
  let shownId = store.sessions.find((s) => !s.finishedAt && !s.closed)?.id ?? '';
  let running = false;
  let status: SyncStatus['kind'] = 'off';
  let message = storageError;
  let otherId = '';
  let renderedView = '';
  let returnFocus: HTMLElement | null = null;
  const dialog = document.createElement('dialog');
  dialog.className = 'blind-test-dialog';
  dialog.setAttribute('aria-labelledby', 'blind-test-title');
  const menu = document.createElement('div');
  menu.className = 'blind-preset-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Preset comparison');
  menu.hidden = true;
  document.body.append(dialog, menu);
  const current = () => store.sessions.find((s) => s.id === shownId);
  const unfinished = () => store.sessions.find((s) => !s.finishedAt);
  function persist(change: (next: BlindStore) => void) {
    if (storageError) {
      message = storageError;
      render();
      return false;
    }
    try {
      const next = clone(store);
      change(next);
      storage.setItem(BLIND_STORAGE_KEY, JSON.stringify(next));
      store = next;
      message = '';
      return true;
    } catch {
      message =
        'Could not save this change. Free some browser storage and try again; your saved rounds are unchanged.';
      render();
      return false;
    }
  }
  function render() {
    const session = current();
    if (!session) return;
    const view = `${session.id}:${!!session.finishedAt}:${running}`;
    if (renderedView === view) {
      updateControls();
      return;
    }
    renderedView = view;
    const focus = dialog.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.blindAction
      : undefined;
    const finished = !!session.finishedAt;
    const results = blindResults(session);
    dialog.innerHTML = `<div class="blind-test-shell">
      <header><div><p class="blind-eyebrow">${finished ? 'RESULTS' : 'BLIND COMPARISON'}</p>
      <h2 id="blind-test-title">${finished ? 'Your listening results' : 'Trust your ears'}</h2></div>
      <button class="icon-button" data-blind-action="close" aria-label="${finished ? 'Close results' : 'Pause and close test'}" title="${finished ? 'Close results' : 'Pause and close · progress is saved'}">${icon('close')}</button></header>
      ${
        finished
          ? `<p>${session.votes.length} completed round${session.votes.length === 1 ? '' : 's'} · ${esc(new Date(session.startedAt).toLocaleDateString())}</p>
        <div class="blind-results">${session.presets.map((p, i) => `<div><span>${esc(p.name)}</span><strong>${i ? results.second : results.first}</strong><small>preferred rounds</small></div>`).join('')}
        <div><span>No preference</span><strong>${results.ties}</strong><small>rounds</small></div></div>
        <p>A and B were shuffled each round. These counts describe your preferences, not an identification score.</p>
        <details><summary>Round history</summary><ol class="blind-votes">${session.votes.map((vote, i) => `<li><span>Round ${i + 1}</span><span>${vote.winner === null ? 'No preference' : esc(session.presets[vote.winner].name)}</span></li>`).join('') || '<li>No votes recorded.</li>'}</ol></details>
        <div class="blind-footer"><button class="blind-danger" data-blind-action="remove">${icon('trash')}Delete result</button><button data-blind-action="close">Done</button></div>`
          : `
        <p class="blind-round"><span class="blind-round-number"></span> <span class="blind-round-count"></span></p>
        <p>Switch freely, then choose what you prefer. Names stay hidden until you finish.</p>
        <div class="blind-listen" role="group" aria-label="Listen to a choice">${(
          ['A', 'B'] as const
        )
          .map(
            (
              side,
            ) => `<button data-blind-action="listen-${side}" aria-pressed="${running && session.round.side === side}" ${!running ? 'disabled' : ''}>
          <span class="blind-letter">${side}</span><span>Listen ${side}</span><kbd>${side === 'A' ? '1' : '2'}</kbd></button>`,
          )
          .join('')}</div>
        <p class="blind-sync" role="status"></p>
        ${
          running
            ? `<div class="blind-vote" role="group" aria-label="Vote for this round">
          <button data-blind-action="vote-A">Prefer A</button>
          <button data-blind-action="vote-tie">No preference</button>
          <button data-blind-action="vote-B">Prefer B</button></div>
          <p class="blind-help"></p>`
            : `<button class="blind-resume" data-blind-action="resume">Resume listening</button>`
        }
        <div class="blind-footer"><button class="blind-danger blind-discard" data-blind-action="remove">${icon('trash')}Discard test</button><button class="blind-finish" data-blind-action="finish">Finish & reveal</button></div>`
      }
      <p class="blind-error" role="alert"></p>
    </div>`;
    updateControls();
    if (focus)
      dialog
        .querySelector<HTMLElement>(`[data-blind-action="${focus}"]`)
        ?.focus({ preventScroll: true });
  }
  // Keep controls mounted during audio writes: replacing the dialog repeatedly
  // drops hover/focus and restarts button transitions on every A/B switch.
  function updateControls() {
    const session = current();
    if (!session) return;
    const setText = (selector: string, text: string) => {
      const element = dialog.querySelector(selector);
      if (element && element.textContent !== text) element.textContent = text;
    };
    setText('.blind-error', message);
    if (session.finishedAt) return;
    setText('.blind-round-number', `Round ${session.votes.length + 1}`);
    setText(
      '.blind-round-count',
      `${session.votes.length} vote${session.votes.length === 1 ? '' : 's'} saved`,
    );
    const heardBoth = session.round.heard.includes('A') && session.round.heard.includes('B');
    const ready = running && status === 'synced' && heardBoth && !message;
    for (const side of ['A', 'B']) {
      const button = dialog.querySelector<HTMLButtonElement>(
        `[data-blind-action="listen-${side}"]`,
      )!;
      button.setAttribute('aria-pressed', String(running && session.round.side === side));
    }
    for (const button of dialog.querySelectorAll<HTMLButtonElement>(
      '[data-blind-action^="vote-"]',
    )) {
      // Pending writes still block votes, without flashing all buttons disabled.
      button.disabled = !heardBoth;
      button.setAttribute('aria-disabled', String(!ready));
    }
    setText(
      '.blind-help',
      heardBoth
        ? 'A vote saves this round and shuffles the next.'
        : 'Listen to both A and B before voting.',
    );
    setText(
      '.blind-sync',
      !running
        ? 'Paused · your progress is saved'
        : status === 'error' || status === 'off'
          ? 'Audio sync unavailable. Check your local APO backend; voting is paused.'
          : `Choice ${session.round.side}`,
    );
    const syncLabel = dialog.querySelector<HTMLElement>('.blind-sync')!;
    syncLabel.setAttribute('aria-busy', String(running && status === 'syncing'));
    syncLabel.title =
      status === 'syncing' ? 'Applying choice…' : status === 'synced' ? 'Choice applied' : '';
  }
  function open(id: string) {
    if (
      store.sessions.find((s) => s.id === id)?.closed &&
      !persist((next) => {
        next.sessions.find((s) => s.id === id)!.closed = false;
      })
    ) {
      toast(message);
      return;
    }
    shownId = id;
    menu.hidden = true;
    render();
    if (!dialog.open) dialog.showModal();
  }
  function apply() {
    status = 'syncing';
    render();
    sync();
  }
  function resume() {
    if (!current() || current()!.finishedAt) return;
    if (!isSyncEnabled()) {
      message =
        'Turn on APO live sync to listen. Close this screen and open APO settings at the bottom of the editor.';
      render();
      return;
    }
    running = true;
    message = '';
    apply();
  }
  function pauseAndClose() {
    const wasRunning = running;
    running = false;
    const session = current();
    if (
      session &&
      !session.finishedAt &&
      !persist((next) => {
        next.sessions.find((s) => s.id === session.id)!.closed = true;
      })
    )
      toast(
        'The test is paused, but its closed state could not be saved. It may reopen after refresh.',
      );
    dialog.close();
    if (wasRunning) sync();
    returnFocus?.focus({ preventScroll: true });
  }
  function start() {
    if (unfinished()) {
      open(unfinished()!.id);
      return;
    }
    const state = getState();
    const other = state.presets.find((p) => p.id === otherId);
    if (!other || other.id === state.activeId) return;
    if (!isSyncEnabled()) {
      menu.hidden = true;
      toast('Turn on APO live sync before starting a blind listening test.');
      return;
    }
    const session = createBlindSession(activePreset(state), other, state.sampleRate);
    if (!persist((next) => next.sessions.push(session))) {
      menu.hidden = true;
      toast(message);
      return;
    }
    open(session.id);
    resume();
  }
  function removeSession(id: string) {
    const session = store.sessions.find((s) => s.id === id);
    if (!session) return false;
    if (
      !persist((next) => {
        next.sessions = next.sessions.filter((s) => s.id !== id);
      })
    ) {
      if (!dialog.open) toast(message);
      return false;
    }
    if (shownId === id) {
      pauseAndClose();
      shownId = '';
      renderedView = '';
    }
    toast(session.finishedAt ? 'Saved result deleted.' : 'Test discarded.');
    return true;
  }
  function act(action: string) {
    const session = current();
    if (!session) return;
    if (action === 'close') return pauseAndClose();
    if (action === 'resume') return resume();
    if (action === 'remove') return removeSession(session.id);
    if (session.finishedAt) return;
    if (action === 'finish') {
      if (
        !persist((next) => {
          next.sessions.find((s) => s.id === session.id)!.finishedAt = new Date().toISOString();
        })
      )
        return;
      running = false;
      sync();
      render();
    } else if (action.startsWith('listen-') && running) {
      const side = action.slice(7) as BlindSide;
      if (side !== 'A' && side !== 'B') return;
      if (side === session.round.side && status === 'synced') return;
      if (
        persist((next) => {
          next.sessions.find((s) => s.id === session.id)!.round.side = side;
        })
      )
        apply();
    } else if (action.startsWith('vote-') && running && status === 'synced' && !message) {
      const choice = action.slice(5) as BlindChoice;
      if (!['A', 'B', 'tie'].includes(choice)) return;
      if (
        persist((next) =>
          voteBlind(
            next.sessions.find((s) => s.id === session.id)!,
            choice,
          ),
        )
      )
        apply();
    }
  }
  dialog.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-blind-action]');
    if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true')
      act(button.dataset.blindAction!);
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    pauseAndClose();
  });
  // Capture app shortcuts so B, undo, and preset edits cannot alter a blind comparison.
  document.addEventListener(
    'keydown',
    (event) => {
      if (dialog.open) {
        event.stopImmediatePropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          pauseAndClose();
        } else if (
          !event.repeat &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          ['1', '2'].includes(event.key)
        ) {
          event.preventDefault();
          act(`listen-${event.key === '1' ? 'A' : 'B'}`);
        }
      } else if (!menu.hidden) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          menu.hidden = true;
          returnFocus?.focus();
        }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(
            menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          );
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[
            (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
          ]?.focus();
        }
      }
    },
    true,
  );
  document.querySelector('#presets')!.addEventListener('contextmenu', (event) => {
    const pointer = event as MouseEvent;
    const row = (event.target as Element).closest<HTMLElement>('[data-preset-id]');
    if (!row) return;
    event.preventDefault();
    otherId = row.dataset.presetId!;
    returnFocus = row.querySelector<HTMLElement>('.preset-select');
    const active = unfinished();
    const results = store.sessions
      .filter((s) => s.finishedAt)
      .slice()
      .reverse();
    menu.innerHTML = `<p>Blind comparison</p><button role="menuitem" data-blind-menu="start" ${otherId === getState().activeId || active ? 'disabled' : ''}>${icon('wave')}<span>Start A/B with current preset</span></button>
      ${active ? '<button role="menuitem" data-blind-menu="resume">Resume unfinished test</button>' : ''}
      ${results.length ? `<details><summary>Saved results (${results.length})</summary>${results.map((s) => `<div class="blind-history-row"><button role="menuitem" data-blind-result="${esc(s.id)}">${esc(new Date(s.startedAt).toLocaleDateString())} · ${s.votes.length} rounds<br>${esc(s.presets[0].name)} / ${esc(s.presets[1].name)}</button><button role="menuitem" class="icon-button blind-danger" data-blind-delete="${esc(s.id)}" aria-label="Delete result: ${esc(s.presets[0].name)} / ${esc(s.presets[1].name)}" title="Delete result">${icon('trash')}</button></div>`).join('')}</details>` : ''}`;
    menu.hidden = false;
    const rect = row.getBoundingClientRect();
    const x = pointer.clientX || rect.left;
    const y = pointer.clientY || rect.bottom;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector<HTMLElement>('button:not(:disabled),summary')?.focus();
  });
  menu.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.dataset.blindMenu === 'start') start();
    else if (button.dataset.blindMenu === 'resume' && unfinished()) open(unfinished()!.id);
    else if (button.dataset.blindResult) open(button.dataset.blindResult);
    else if (button.dataset.blindDelete) {
      if (!removeSession(button.dataset.blindDelete)) return;
      button.closest('.blind-history-row')?.remove();
      const count = store.sessions.filter((s) => s.finishedAt).length;
      const summary = menu.querySelector('summary');
      if (summary) summary.textContent = `Saved results (${count})`;
      if (!count) menu.querySelector('details')?.remove();
      menu.querySelector<HTMLElement>('summary,button:not(:disabled)')?.focus();
    }
  });
  menu.addEventListener(
    'toggle',
    () => {
      if (menu.hidden) return;
      menu.style.top = `${Math.max(8, Math.min(menu.getBoundingClientRect().top, innerHeight - menu.offsetHeight - 8))}px`;
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!menu.hidden && !menu.contains(event.target as Node)) menu.hidden = true;
    },
    true,
  );
  window.addEventListener('resize', () => {
    menu.hidden = true;
  });
  window.addEventListener(
    'scroll',
    (event) => {
      if (!menu.contains(event.target as Node)) menu.hidden = true;
    },
    true,
  );
  if (shownId) open(shownId);
  if (storageError) toast(storageError);
  return {
    playback() {
      const session = current();
      return running && session && !session.finishedAt
        ? { preset: blindPlayback(session), sampleRate: session.sampleRate }
        : null;
    },
    onSync(next) {
      if (!running) return;
      status = next.kind;
      const session = current();
      if (next.kind === 'synced' && session && !session.round.heard.includes(session.round.side))
        persist((saved) => {
          saved.sessions.find((s) => s.id === session.id)!.round.heard.push(session.round.side);
        });
      render();
    },
  };
}
