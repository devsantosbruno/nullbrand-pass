// A popup menu: a trigger button and a hidden panel of items. Click on the trigger toggles it; ArrowUp/ArrowDown move through the items
// (wrapping), Esc closes it and gives the focus back to the trigger, a click anywhere else closes it. What differs between the menus of
// the page (how it is placed, what each item does, what its items are) is passed in, not decided here.
import { at, containsTarget, expectInstance, queryAll } from '../dom.js';
import { step } from './step.js';

export interface MenuOptions {
  trigger: HTMLElement;
  menu: HTMLElement;
  // Selects the items of the panel that the arrow keys move through.
  itemSelector: string;
  // Called before the panel is shown, to build its items.
  onOpen?: () => void;
  onClose?: () => void;
  // Called right after the panel is shown, to place it relative to the trigger (a menu placed by CSS leaves it out).
  place?: (menu: HTMLElement, trigger: HTMLElement) => void;
  // What a window resize does while the panel is open.
  onResize?: 'close' | 'place';
  // The item that gets the focus on open (default: the first one).
  initialFocus?: () => Element | null;
  // The element that receives the keys (default: the panel; a menu whose trigger sits in a wrapper can listen on the wrapper).
  keyScope?: HTMLElement;
  // Whether Esc stops there. A menu inside the bulk-selection area must not also clear the selection.
  stopEscape?: boolean;
}
export interface MenuHandle {
  readonly isOpen: boolean;
  open(): void;
  close(returnFocus?: boolean): void;
  toggle(): void;
  destroy(): void;
}

// Opens above the trigger when there is no room below and more above. The page uses CSS zoom, so the visual height is scaled back
// to the local one.
export function flipUp(menu: HTMLElement, trigger: HTMLElement): void {
  const r = trigger.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const need = Math.min(menu.offsetHeight, 240) * (r.height / trigger.offsetHeight) + 8;
  menu.classList.toggle('up', below < need && r.top > below);
}

export function createMenu({ trigger, menu, itemSelector, onOpen, onClose, place, onResize, initialFocus, keyScope = menu, stopEscape = true }: MenuOptions): MenuHandle {
  const items = (): HTMLElement[] => queryAll(menu, itemSelector, HTMLElement);
  // Only while it is open: a menu that is closed costs no work on every click or resize of the page.
  const onDocumentClick = (e: MouseEvent): void => {
    if (!containsTarget(menu, e.target) && !containsTarget(trigger, e.target)) close();
  };
  const onWindowResize = (): void => {
    if (onResize === 'close') close();
    else if (onResize === 'place') place?.(menu, trigger);
  };
  const isOpen = (): boolean => !menu.hidden;

  function open(): void {
    if (isOpen()) return;
    onOpen?.();
    menu.hidden = false;
    place?.(menu, trigger);
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocumentClick);
    if (onResize) window.addEventListener('resize', onWindowResize);
    expectInstance(initialFocus?.() ?? items()[0], HTMLElement, `first item of ${itemSelector}`).focus();
  }
  function close(returnFocus = false): void {
    if (!isOpen()) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocumentClick);
    window.removeEventListener('resize', onWindowResize);
    onClose?.();
    if (returnFocus) trigger.focus();
  }
  const toggle = (): void => (isOpen() ? close() : open());

  const onTriggerClick = (): void => toggle();
  const onKeydown = (e: KeyboardEvent): void => {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      if (stopEscape) e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = items();
    const current = list.findIndex((item) => item === document.activeElement);
    if (current < 0) return; // the focus is not on an item (e.g. on the trigger): nothing to move from
    e.preventDefault();
    at(list, step(list.length, current, e.key === 'ArrowDown' ? 1 : -1)).focus();
  };
  trigger.addEventListener('click', onTriggerClick);
  keyScope.addEventListener('keydown', onKeydown);

  return {
    get isOpen() { return isOpen(); },
    open,
    close,
    toggle,
    destroy(): void {
      close();
      trigger.removeEventListener('click', onTriggerClick);
      keyScope.removeEventListener('keydown', onKeydown);
    },
  };
}
