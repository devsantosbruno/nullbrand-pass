// The eye button of a masked input: shows or hides the value by switching the input's CSS mask, and repaints the button (icon,
// accessible name) and, when asked, the placeholder (dots when hidden, an example when visible). It never keeps the value.
import { icon } from './icons.js';
import type { IconName, IconOptions } from './icons.js';
import { isMasked, setMasked } from './secret-input.js';

/** Options for {@link createRevealToggle}. */
export interface RevealToggleOptions {
  input: HTMLInputElement;
  button: HTMLButtonElement;
  /** The button's accessible name per state, already translated. Read on every repaint, so a language change only needs `repaint()`. */
  label: (shown: boolean) => string;
  /** Icon for the "shown" state (the slashed eye); the login password uses a wider slash. */
  eyeOff?: IconName;
  iconOptions?: IconOptions;
  placeholders?: readonly [hidden: string, visible: string];
}
/** Controls for a reveal button. */
export interface RevealToggle {
  readonly input: HTMLInputElement;
  repaint(): void;
  setShown(shown: boolean): void;
}

/** Wires an eye button to a masked input. */
export function createRevealToggle({ input, button, label, eyeOff = 'eye-off', iconOptions, placeholders }: RevealToggleOptions): RevealToggle {
  function repaint(): void {
    const shown = !isMasked(input);
    if (placeholders) input.placeholder = placeholders[shown ? 1 : 0];
    button.replaceChildren(icon(shown ? eyeOff : 'eye', iconOptions));
    button.setAttribute('aria-label', label(shown));
  }
  function setShown(shown: boolean): void {
    setMasked(input, !shown);
    repaint();
  }
  button.addEventListener('click', () => setShown(isMasked(input)));
  return { input, repaint, setShown };
}
