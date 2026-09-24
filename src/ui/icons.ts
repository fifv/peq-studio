const icons: Record<string, string> = {
  PK: '<path d="M2 17h3c4 0 4-11 7-11s3 11 7 11h3"/>',
  LSC: '<path d="M2 6h5c6 0 4 12 10 12h5"/>',
  HSC: '<path d="M2 18h5c6 0 4-12 10-12h5"/>',
  LP: '<path d="M2 6h6c6 0 7 4 9 10l3 6"/>',
  HP: '<path d="m4 22 3-6c2-6 3-10 9-10h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  wave: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
  chevron: '<path d="m8 5 7 7-7 7"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  book: '<path d="M12 5v16M12 5C8 2 3 3 3 3v15s5-1 9 3c4-4 9-3 9-3V3s-5-1-9 2Z"/>',
  sliders:
    '<path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
export const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.wave}</svg>`;
export const iconButton = (action: string, name: string, label: string, disabled = false) =>
  `<button class="icon-button" data-action="${action}" title="${label}" aria-label="${label}" ${disabled ? 'disabled' : ''}>${icon(name)}</button>`;
