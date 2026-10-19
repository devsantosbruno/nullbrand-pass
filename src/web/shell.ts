// The page's own chrome: which screen is showing, and which pane of the vault screen. Nothing here knows about items or forms.
import { $, $input, queryAll } from './dom.js';
import { clipCountdown } from './clipboard.js';

export type ScreenName = 'nosession' | 'setup' | 'unlock' | 'vault';
let currentScreen: ScreenName | null = null; // null until the first screen is chosen (the page starts with all of them hidden)
export const screenShowing = (): ScreenName | null => currentScreen;

export function showScreen(name: ScreenName): void {
  currentScreen = name;
  for (const s of ['nosession', 'setup', 'unlock', 'vault']) $(`#screen-${s}`).hidden = s !== name;
  $('.lang-switch').hidden = name === 'vault'; // only while the vault is locked
  if (name !== 'vault') { clipCountdown(0); $('#view-fields').replaceChildren(); $('#view-ssh-download').replaceChildren(); }
  // These two dialogs hold a file full of passwords / the master password: closing them drops both (see their 'close' handlers).
  if (name !== 'vault') for (const d of queryAll(document, '#dlg-import[open], #dlg-export[open]', HTMLDialogElement)) d.close();
  if (name === 'nosession') { $('#nosession-info').hidden = false; $('#nosession-fail').hidden = true; }
  if (name === 'unlock') { $input('#unlock-pass').value = ''; setTimeout(() => $input('#unlock-pass').focus(), 0); }
  if (name === 'setup') setTimeout(() => $input('#setup-pass').focus(), 0);
}

export function showDetail(mode: 'view' | 'edit' | null): void {
  $('#detail-empty').hidden = mode !== null;
  $('#detail-view').hidden = mode !== 'view';
  $('#detail-edit').hidden = mode !== 'edit';
  $('#screen-vault').classList.toggle('show-detail', mode !== null);
}
