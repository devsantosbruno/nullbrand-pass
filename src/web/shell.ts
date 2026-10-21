// The page's chrome: which screen shows, and which pane of the vault screen. Nothing here knows about items or forms.
import { $, $form, $input, queryAll } from './dom.js';
import { clipCountdown } from './clipboard.js';

/** The top-level screens. */
export type ScreenName = 'nosession' | 'setup' | 'unlock' | 'vault';
// Null until the first screen is chosen; the page starts with all of them hidden.
let currentScreen: ScreenName | null = null;
/** Returns the screen showing, or `null` before the first one. */
export const screenShowing = (): ScreenName | null => currentScreen;

/** Shows one screen and hides the others. Leaving the vault screen also drops what is on display: the copy countdown, revealed fields, the edit form, and the import and export dialogs. */
export function showScreen(name: ScreenName): void {
  currentScreen = name;
  for (const s of ['nosession', 'setup', 'unlock', 'vault']) $(`#screen-${s}`).hidden = s !== name;
  // The language switch is only for the locked screens.
  $('.lang-switch').hidden = name === 'vault';
  // The edit form is reset too: its inputs (password, card number, SSH private key and the pasted key) hold plain text.
  if (name !== 'vault') { clipCountdown(0); $('#view-fields').replaceChildren(); $('#view-ssh-download').replaceChildren(); $form('#detail-edit').reset(); }
  // These dialogs hold a file full of passwords or the master password; closing them drops both.
  if (name !== 'vault') for (const d of queryAll(document, '#dlg-import[open], #dlg-export[open]', HTMLDialogElement)) d.close();
  if (name === 'nosession') { $('#nosession-info').hidden = false; $('#nosession-fail').hidden = true; }
  if (name === 'unlock') { $input('#unlock-pass').value = ''; setTimeout(() => $input('#unlock-pass').focus(), 0); }
  if (name === 'setup') setTimeout(() => $input('#setup-pass').focus(), 0);
}

/** Shows the detail pane in view or edit mode, or the empty state for `null`. */
export function showDetail(mode: 'view' | 'edit' | null): void {
  $('#detail-empty').hidden = mode !== null;
  $('#detail-view').hidden = mode !== 'view';
  $('#detail-edit').hidden = mode !== 'edit';
  $('#screen-vault').classList.toggle('show-detail', mode !== null);
}
