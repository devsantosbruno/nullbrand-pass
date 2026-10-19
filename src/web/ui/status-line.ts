/** Binds the one-line status of a dialog (error in red, `ok` in the accent color): `const msg = statusLine(node)`. The message goes in through textContent only, so it is always shown as text. */
export const statusLine = (node: HTMLElement) => (msg: string | null, ok = false): void => {
  node.textContent = msg;
  node.classList.toggle('ok', ok);
};
