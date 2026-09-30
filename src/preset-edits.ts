import type { Channel, Preset, Workspace } from './types.ts';
import { activePreset, clone } from './utils.ts';

export type ImportMode = 'new' | 'replace' | 'append';

/** Import filters without discarding the current preset's name or curve choices. */
export function applyPresetImport(state: Workspace, imported: Preset, mode: ImportMode) {
  if (mode === 'new') {
    state.presets.push(clone(imported));
    state.activeId = imported.id;
    return;
  }
  const current = activePreset(state);
  if (mode === 'replace') {
    current.left = clone(imported.left);
    current.right = clone(imported.linked ? imported.left : imported.right);
    current.linked = imported.linked;
    current.enabled = imported.enabled;
    return;
  }
  if (current.linked) current.right = clone(current.left);
  current.left.filters.push(...clone(imported.left.filters));
  current.right.filters.push(
    ...clone(imported.linked ? imported.left.filters : imported.right.filters),
  );
  current.linked = current.linked && imported.linked;
}

/** Keep the selection attached to the same filter when its position changes. */
export function moveBand(channel: Channel, from: number, to: number, selected: number): number {
  if (from === to || !channel.filters[from] || !channel.filters[to]) return selected;
  const selection = channel.filters[selected];
  const [filter] = channel.filters.splice(from, 1);
  channel.filters.splice(to, 0, filter);
  return selection ? channel.filters.indexOf(selection) : -1;
}
