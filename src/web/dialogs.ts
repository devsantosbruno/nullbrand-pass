// Confirmation dialogs that more than one feature needs, with the page's wording (ui/dialog.ts does not know the language).
import { t } from './locale.js';
import { confirm } from './ui/dialog.js';

export const confirmDelete = (title: string, text: string, label: string): Promise<boolean> =>
  confirm({ title, body: text, okLabel: label, cancelLabel: t('common.cancel'), tone: 'danger' });
