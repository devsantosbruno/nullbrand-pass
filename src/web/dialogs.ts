// Confirmation dialogs several features need, with the page's wording (ui/dialog.ts does not know the language).
import { t } from './locale.js';
import { confirm } from './ui/dialog.js';

/** Asks to confirm a destructive action; resolves true on confirmation. */
export const confirmDelete = (title: string, text: string, label: string): Promise<boolean> =>
  confirm({ title, body: text, okLabel: label, cancelLabel: t('common.cancel'), tone: 'danger' });
