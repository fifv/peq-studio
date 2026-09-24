import { positionPopup, installPopupEvents } from './ui/popover.ts';
import { query, eventElement } from './dom.ts';
import type { Curve, CurveRole, Workspace, PopupController } from './types.ts';
import { escapeHtml, errorMessage } from './utils.ts';
import {
  builtinCurves,
  TARGET_CATALOG_VERSION,
  SOURCE_CATALOG_VERSION,
  customCurves,
  findCurve,
  searchCurves,
} from './curve-library.ts';

let openPicker: PopupController | null = null;
const collections = { custom: 'Custom', target: 'Built-in targets', source: 'Headphone library' };
type Collection = 'custom' | CurveRole;
const collectionOf = (curve: Curve | undefined): Collection =>
  curve?.builtin && curve.kind !== 'both' ? (curve.kind ?? 'custom') : 'custom';

/** A local, searchable curve library. The popup is portaled to avoid clipping. */
export function createCurvePicker({
  root,
  kind,
  getState,
  onSelect,
  onDelete,
  onImport,
}: {
  root: HTMLElement;
  kind: CurveRole;
  getState: () => Workspace;
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
  onImport: () => void;
}) {
  const label = kind === 'target' ? 'Target curve' : 'Source response';
  const selectedByCollection: Partial<Record<Collection, string>> = {};
  let view = collectionOf(findCurve(getState(), kind));
  let popup: HTMLDivElement | null = null;
  let search = '',
    lastSelectedId = getState()[`${kind}Id`],
    loading = false,
    error = '';
  root.className = 'curve-field';
  root.innerHTML = /* HTML */ `<span class="curve-field-label" id="${kind}-field-label"
      >${label}</span
    ><button
      id="${kind}-select"
      class="curve-trigger"
      aria-label="${label}"
      aria-haspopup="dialog"
      aria-expanded="false"
      aria-controls="${kind}-curve-menu"
    ></button>`;
  const heading = document.createElement('div');
  heading.className = 'curve-field-heading';
  heading.append(root.firstElementChild!);
  root.prepend(heading);
  heading.insertAdjacentHTML(
    'beforeend',
    /* HTML */ `<label class="curve-offset"
      >Offset
      <span
        ><input
          id="${kind}-offset"
          data-adjust="${kind}-offset"
          type="number"
          min="-120"
          max="120"
          step="0.1"
          aria-label="${kind === 'target' ? 'Target' : 'Source'} curve offset"
          title="Drag up/down or use mouse wheel"
        />dB</span
      ></label
    >`,
  );
  const trigger = query<HTMLButtonElement>('button', root);
  const items = () => (view === 'custom' ? customCurves(getState(), kind) : builtinCurves(view));
  function update() {
    const selected = findCurve(getState(), kind);
    if (selected) selectedByCollection[collectionOf(selected)] = selected.id;
    if (lastSelectedId !== getState()[`${kind}Id`]) {
      lastSelectedId = getState()[`${kind}Id`];
      if (selected && !loading) {
        view = collectionOf(selected);
        if (popup) renderPopup();
      }
    }
    trigger.innerHTML = /* HTML */ `<span class="curve-trigger-name"
        >${escapeHtml(selected?.name ?? 'None')}</span
      ><span class="curve-trigger-count">(${items().length})</span
      ><span class="dropdown-chevron" aria-hidden="true"></span>`;
    trigger.title = selected?.name ?? 'None';
    query<HTMLInputElement>('input[data-adjust]', root).value = String(
      getState().curveDisplay[`${kind}OffsetDb`],
    );
    if (popup) {
      renderList();
      position();
    }
  }
  function position() {
    positionPopup(popup, trigger, { width: 360, align: 'left', flip: true });
  }

  function close(returnFocus = false) {
    popup?.remove();
    popup = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (openPicker === controller) openPicker = null;
    if (returnFocus) trigger.focus();
  }
  function revealSelected() {
    const list = popup?.querySelector('.curve-list'),
      row = list?.querySelector('.curve-library-row.selected');
    if (!list || !row) return;
    const listRect = list.getBoundingClientRect(),
      rowRect = row.getBoundingClientRect();
    // Scroll only the list, leaving the editor and popup in place.
    list.scrollTop += rowRect.top - listRect.top - (list.clientHeight - rowRect.height) / 2;
  }
  function renderList() {
    if (!popup) return;
    const state = getState(),
      results = searchCurves(items(), search),
      list = query('.curve-list', popup);
    list.innerHTML =
      results
        .map(
          (curve) =>
            /* HTML */ ` <div
              class="curve-library-row ${state[`${kind}Id`] === curve.id ? 'selected' : ''}"
            >
              <button
                class="curve-choice"
                data-curve-id="${escapeHtml(curve.id)}"
                aria-pressed="${state[`${kind}Id`] === curve.id}"
                title="${escapeHtml(curve.name)}"
              >
                <span class="curve-check" aria-hidden="true"
                  >${state[`${kind}Id`] === curve.id ? '✓' : ''}</span
                ><span
                  ><span class="curve-choice-name">${escapeHtml(curve.name)}</span
                  >${curve.measurementSystem ? /* HTML */ `<small>${escapeHtml(curve.measurementSystem)}</small>` : ''}</span
                ></button
              >${view === 'custom' ? /* HTML */ `<button class="curve-delete" data-delete-id="${escapeHtml(curve.id)}" aria-label="Delete ${escapeHtml(curve.name)}" title="Delete curve">×</button>` : ''}
            </div>`,
        )
        .join('') ||
      /* HTML */ ` <div class="curve-empty">
        <strong>${search ? 'No matching curves' : `No custom curves yet`}</strong
        ><span
          >${search ? 'Try another name or measurement system.' : 'Import a frequency response file to get started.'}</span
        >
      </div>`;
    query('.curve-library-status', popup).textContent = loading
      ? 'Loading local response…'
      : error ||
        `${results.length} ${results.length === 1 ? 'curve' : 'curves'}${view !== 'custom' ? ` · bundled ${view === 'target' ? TARGET_CATALOG_VERSION : SOURCE_CATALOG_VERSION}` : ' · saved on this device'}`;
    popup.setAttribute('aria-busy', String(loading));
    popup.querySelectorAll<HTMLButtonElement>('.curve-choice, [data-view]').forEach((button) => {
      button.disabled = loading;
    });
    query<HTMLButtonElement>('[data-clear]', popup).disabled = loading || !state[`${kind}Id`];
  }
  function renderPopup() {
    if (!popup) return;
    popup.innerHTML = /* HTML */ `<div
        class="curve-library-tabs"
        role="tablist"
        aria-label="Curve collection"
      >
        ${Object.entries(collections)
          .map(
            ([id, title]) =>
              /* HTML */ `<button
                role="tab"
                aria-selected="${view === id}"
                data-view="${id}"
                tabindex="${view === id ? 0 : -1}"
                id="${kind}-${id}-tab"
                aria-controls="${kind}-curve-panel"
              >
                ${title}
              </button>`,
          )
          .join('')}
      </div>
      <div
        class="curve-library-panel"
        id="${kind}-curve-panel"
        role="tabpanel"
        aria-labelledby="${kind}-${view}-tab"
      >
        <div class="curve-library-search">
          <span aria-hidden="true">⌕</span
          ><input
            type="search"
            placeholder="Search curves"
            aria-label="Search curves"
            value="${escapeHtml(search)}"
          />
          ${
            view === 'custom'
              ? /* HTML */ `<button
                  class="curve-import-button"
                  data-import
                  aria-label="Import curve"
                  title="Import curve"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    aria-hidden="true"
                  >
                    <path d="M3 8V5h7l2 3h9v11H3V8Zm0 3h18l-3 8H3Z" />
                  </svg>
                </button>`
              : ''
          }
        </div>
        <div class="curve-list" aria-label="${collections[view]} curves"></div>
        <div class="curve-library-footer">
          <span class="curve-library-status" role="status"></span
          ><button data-clear>Clear selection</button>
        </div>
      </div>`;
    query<HTMLInputElement>('input', popup).addEventListener('input', (event) => {
      search = (eventElement(event) as HTMLInputElement).value;
      renderList();
      position();
    });
    renderList();
    position();
  }
  async function selectCurve(id: string, restore = false) {
    if (loading || !popup) return;
    const activePopup = popup,
      scrollTop = query('.curve-list', popup).scrollTop,
      previousCollection = collectionOf(findCurve(getState(), kind));
    loading = true;
    error = '';
    renderList();
    try {
      await onSelect(id);
      if (!id) delete selectedByCollection[previousCollection];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
      if (popup) {
        renderList();
        if (popup === activePopup) {
          if (restore) revealSelected();
          else {
            query('.curve-list', popup).scrollTop = scrollTop;
            (
              popup.querySelector<HTMLElement>('.curve-choice[aria-pressed="true"]') ??
              query<HTMLInputElement>('input', popup)
            ).focus({ preventScroll: true });
          }
        }
      }
    }
  }
  async function switchCollection(next: Collection) {
    if (loading || !popup || next === view) return;
    view = next;
    renderPopup();
    query<HTMLButtonElement>(`[data-view="${view}"]`, popup).focus();
    update();
    const remembered = selectedByCollection[view];
    if (remembered && items().some((curve) => curve.id === remembered)) {
      if (remembered !== getState()[`${kind}Id`]) await selectCurve(remembered, true);
      else revealSelected();
    } else {
      delete selectedByCollection[view];
    }
  }
  function open() {
    if (popup) {
      close();
      return;
    }
    openPicker?.close();
    openPicker = controller;
    // Keep the collection and search intact when reopening this picker.
    popup = document.createElement('div');
    popup.id = `${kind}-curve-menu`;
    popup.className = 'curve-library-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Curve library');
    document.body.append(popup);
    trigger.setAttribute('aria-expanded', 'true');
    renderPopup();
    query<HTMLInputElement>('input', popup).focus({ preventScroll: true });
    revealSelected();
    popup.addEventListener('click', async (event) => {
      const tab = eventElement(event).closest<HTMLElement>('[data-view]');
      if (tab) {
        await switchCollection(tab.dataset.view as Collection);
        return;
      }
      const choice = eventElement(event).closest<HTMLElement>('[data-curve-id]'),
        clear = eventElement(event).closest<HTMLElement>('[data-clear]');
      if (choice || clear) {
        await selectCurve(choice?.dataset.curveId ?? '');
        return;
      }
      const remove = eventElement(event).closest<HTMLElement>('[data-delete-id]');
      if (remove) {
        onDelete(remove.dataset.deleteId!);
        update();
        query<HTMLInputElement>('input', popup).focus();
        return;
      }
      if (eventElement(event).closest<HTMLElement>('[data-import]')) {
        close();
        onImport();
        return;
      }
    });
    popup.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (
        eventElement(event).matches('[role="tab"]') &&
        ['ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        event.preventDefault();
        const views = Object.keys(collections) as Collection[];
        const next =
          views[
            (views.indexOf(view) + (event.key === 'ArrowRight' ? 1 : views.length - 1)) %
              views.length
          ];
        void switchCollection(next);
        return;
      }
      if (
        !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
        !eventElement(event).matches('input,.curve-choice')
      )
        return;
      if (eventElement(event).matches('input') && ['Home', 'End'].includes(event.key)) return;
      if (!popup) return;
      const options = [...popup.querySelectorAll<HTMLButtonElement>('.curve-choice')];
      if (!options.length) return;
      event.preventDefault();
      const index = options.findIndex((option) => option === document.activeElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : event.key === 'ArrowDown'
              ? (index + 1) % options.length
              : index < 0
                ? options.length - 1
                : (index - 1 + options.length) % options.length;
      options[next].focus();
    });
  }
  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!popup) open();
    }
  });
  installPopupEvents(
    root,
    () => popup,
    () => close(),
    position,
  );
  const controller = { update, close };
  update();
  return controller;
}
