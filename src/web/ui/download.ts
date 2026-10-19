// Hands a blob to the browser as a file download.
import { el } from '../dom.js';

export function downloadBlob(blob: Blob, name: string): void {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
