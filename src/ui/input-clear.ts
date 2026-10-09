import { icon } from './icons.ts';

/** A consistent clear target for editable text; native search decorations vary by browser. */
export function installInputClear(input: HTMLInputElement, host?: HTMLElement) {
  if (!host) {
    host = document.createElement('span');
    host.className = 'clearable-field';
    input.before(host);
    host.append(input);
  }
  input.classList.add('has-clear-button');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'input-clear';
  const label = `Clear ${input.getAttribute('aria-label')?.toLowerCase() || 'text'}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon('close');
  host.append(button);
  const update = () => {
    button.hidden = input.hidden || !input.value || input.disabled || input.readOnly;
  };
  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
  });
  button.addEventListener('click', () => {
    input.value = '';
    input.focus({ preventScroll: true });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    update();
  });
  update();
  return { button, update };
}
