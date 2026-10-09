import type { Workspace } from './types.ts';
import { validateState } from './model.ts';

/** Undo entries are independent snapshots, including both channels and view settings. */
export class WorkspaceHistory {
  private past: string[] = [];
  private future: string[] = [];
  private captureGroup: symbol | undefined;
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  capture(state: Workspace, group?: symbol): void {
    // A gesture may finish before its final async curve load completes.
    // Its token groups consecutive changes without absorbing unrelated edits.
    if (group && group === this.captureGroup) return;
    this.captureGroup = group;
    this.past.push(JSON.stringify(state));
    if (this.past.length > 80) this.past.shift();
    this.future = [];
  }
  restore(state: Workspace, backwards: boolean): Workspace | null {
    this.captureGroup = undefined;
    const from = backwards ? this.past : this.future;
    const to = backwards ? this.future : this.past;
    const snapshot = from.pop();
    if (!snapshot) return null;
    to.push(JSON.stringify(state));
    return validateState(JSON.parse(snapshot));
  }
}
