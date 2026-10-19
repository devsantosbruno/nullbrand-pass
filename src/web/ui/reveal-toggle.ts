// The eye button of a masked input (S3): shows or hides the value by switching the input's CSS mask, and repaints the button (icon,
// accessible name) and, when asked, the input's placeholder (dots when hidden, an example when visible). It never keeps the value.
import { icon } from './icons.js';
import type { IconName, IconOptions } from './icons.js';
import { isMasked, setMasked } from './secret-input.js';

export interface RevealToggleOptions {
  input: HTMLInputElement;
  button: HTMLButtonElement;
  // The accessible name of the button for each state, already translated: read on every repaint, so a language change only needs repaint().
  label: (shown: boolean) => string;
  // The icon of the "shown" state (the slashed eye); the login password keeps its wider slash.
  eyeOff?: IconName;
  iconOptions?: IconOptions;
  placeholders?: readonly [hidden: string, visible: string];
}
export interface RevealToggle {
  readonly input: HTMLInputElement;
  repaint(): void;
  setShown(shown: boolean): void;
}

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
