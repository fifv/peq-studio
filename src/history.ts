import type { Workspace } from './types.ts';
import { validateState } from './model.ts';

/** Undo entries are independent snapshots, including both channels and view settings. */
export class WorkspaceHistory {
  private past: string[] = [];
  private future: string[] = [];
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  capture(state: Workspace): void {
    this.past.push(JSON.stringify(state));
    if (this.past.length > 80) this.past.shift();
    this.future = [];
  }
  restore(state: Workspace, backwards: boolean): Workspace | null {
    const from = backwards ? this.past : this.future;
    const to = backwards ? this.future : this.past;
    const snapshot = from.pop();
    if (!snapshot) return null;
    to.push(JSON.stringify(state));
    return validateState(JSON.parse(snapshot));
  }
}
