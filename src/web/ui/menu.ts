// A popup menu: a trigger button and a hidden panel of items. The trigger toggles it, ArrowUp/ArrowDown move through the items with wrapping,
// Esc closes it and returns focus to the trigger, and a click elsewhere closes it. What differs per menu (placement, items, actions) is passed in.
import { at, containsTarget, expectInstance, queryAll } from '../dom.js';
import { step } from './step.js';

/** Options for {@link createMenu}. */
export interface MenuOptions {
  trigger: HTMLElement;
  menu: HTMLElement;
  /** Selects the items the arrow keys move through. */
  itemSelector: string;
  /** Called before the panel is shown, to build its items. */
  onOpen?: () => void;
  onClose?: () => void;
  /** Called right after the panel is shown, to position it relative to the trigger. Leave out when CSS positions it. */
  place?: (menu: HTMLElement, trigger: HTMLElement) => void;
  /** What a window resize does while the panel is open. */
  onResize?: 'close' | 'place';
  /** The item that gets focus on open (default: the first). */
  initialFocus?: () => Element | null;
  /** The element that receives key events (default: the panel); a menu whose trigger sits in a wrapper can listen on the wrapper. */
  keyScope?: HTMLElement;
  /** Whether Esc stops propagating. A menu inside the bulk-selection area must not also clear the selection. */
  stopEscape?: boolean;
}
/** Controls for an open/close menu. */
export interface MenuHandle {
  readonly isOpen: boolean;
  open(): void;
  close(returnFocus?: boolean): void;
  toggle(): void;
  destroy(): void;
}

/** A `place` function that opens the menu above the trigger when there is no room below and more above. The page uses CSS zoom, so visual heights are scaled back to local ones. */
export function flipUp(menu: HTMLElement, trigger: HTMLElement): void {
  const r = trigger.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const need = Math.min(menu.offsetHeight, 240) * (r.height / trigger.offsetHeight) + 8;
  menu.classList.toggle('up', below < need && r.top > below);
}

/** Wires a trigger and a panel into a menu and returns its controls. Call `destroy()` to remove the listeners. */
export function createMenu({ trigger, menu, itemSelector, onOpen, onClose, place, onResize, initialFocus, keyScope = menu, stopEscape = true }: MenuOptions): MenuHandle {
  const items = (): HTMLElement[] => queryAll(menu, itemSelector, HTMLElement);
  // Registered only while open, so a closed menu costs nothing on every click or resize.
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
    // Focus is not on an item (for example on the trigger): nothing to move from.
    if (current < 0) return;
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
