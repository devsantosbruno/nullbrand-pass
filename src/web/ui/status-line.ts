// The one-line status of a dialog (error in red, `ok` in the accent color). Bound once per dialog: `const msg = statusLine(node)`.
// textContent only (S1): whatever is passed is shown as text.
export const statusLine = (node: HTMLElement) => (msg: string | null, ok = false): void => {
  node.textContent = msg;
  node.classList.toggle('ok', ok);
};
