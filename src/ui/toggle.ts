import { escapeHtml } from '../utils.ts';

/** Native checkbox behavior with a shared, accessible switch presentation. */
export function renderToggle(
  label: string,
  {
    id,
    name,
    checked = false,
    className = 'check-row',
  }: {
    id?: string;
    name?: string;
    checked?: boolean;
    className?: string;
  },
) {
  return /* HTML */ `<label class="${escapeHtml(className)}">
    <span>${escapeHtml(label)}</span>
    <input
      class="toggle-input"
      type="checkbox"
      role="switch"
      ${id ? `id="${escapeHtml(id)}"` : ''}
      ${name ? `name="${escapeHtml(name)}"` : ''}
      ${checked ? 'checked' : ''}
    />
  </label>`;
}
