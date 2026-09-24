import { query as $ } from '../dom.ts';
import { errorMessage } from '../utils.ts';
import { iconButton as ib } from './icons.ts';
export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function openModal(title: string, content: string) {
  $('#modal-content').innerHTML = /* HTML */ `<div class="modal-heading">
      <h2>${title}</h2>
      ${ib('close-modal', 'close', 'Close dialog')}
    </div>
    ${content}`;
  $<HTMLDialogElement>('#modal').showModal();
}
export function chooseFile(
  accept: string,
  handler: (text: string, name: string, fileName: string) => void | Promise<void>,
  onError: (message: string) => void,
) {
  const input = $<HTMLInputElement>('#file-input');
  input.value = '';
  input.accept = accept;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('Choose a file smaller than 10 MB.');
      await handler(await file.text(), file.name.replace(/\.[^.]+$/, ''), file.name);
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  input.click();
}
