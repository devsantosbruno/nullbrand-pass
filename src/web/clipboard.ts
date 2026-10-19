// The server copies and clears, not navigator.clipboard, because the browser may be unfocused when the timer fires.
// This module only shows the countdown.
import { guardClipboardCopyResponse } from './api-guards.js';
import { $ } from './dom.js';
import { api, msgOf } from './http.js';
import { lc, t } from './locale.js';
import { toast, toastMs } from './toast.js';

let clipTick: number | undefined;
function clipChip(text: string | null): void {
  const chip = $('#clip-chip');
  chip.hidden = text == null;
  if (text != null) chip.textContent = text;
}
/** Shows a countdown chip for `seconds`, then a "cleared" notice. `0` hides the chip. */
export function clipCountdown(seconds: number): void {
  clearInterval(clipTick);
  if (!seconds) return clipChip(null);
  const end = Date.now() + seconds * 1000;
  const paint = (): void => {
    const left = Math.ceil((end - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(clipTick);
      clipChip(t('clipboard.cleared'));
      clipTick = setTimeout(() => clipChip(null), 2000);
      return;
    }
    clipChip(t('clipboard.copied', { s: left }));
  };
  paint();
  clipTick = setInterval(paint, 1000);
}

/**
 * Copies text through the server. Every copy goes through here.
 * @param what translated name of the field for the toast; sensitive copies show the countdown instead.
 * @param sensitive passwords, TOTP, card numbers, CVV, private keys and notes: makes the server clear the clipboard later. Required, so a new copy button must say what it copies.
 */
export async function copy(text: string, what: string, { sensitive }: { sensitive: boolean }): Promise<void> {
  clearTimeout(clipTick);
  try {
    const r = await api('POST /api/clipboard/copy', { guard: guardClipboardCopyResponse, body: { text, sensitive } });
    if (r.concealed === false) toast(t('clipboard.notConcealed'), 6000);
    if (sensitive && r.seconds) return clipCountdown(r.seconds);
    clipCountdown(0);
    toast(what && !sensitive ? t('copied.field', { label: lc(what) }) : t('copied.generic'), 1500);
  } catch (err) {
    clipCountdown(0);
    toast(msgOf(err) || t('copy.failed'), toastMs(err, 4000));
  }
}
