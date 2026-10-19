// The part of a button that withBusy touches. Structural on purpose, so the helper (and its ordering) can be tested without a DOM.
export interface BusyButton {
  disabled: boolean;
  textContent: string | null;
}

// Disables the button and shows `busyLabel` while `fn` runs, then puts it back exactly like a try/finally would: whether `fn` resolves
// or throws. It does not swallow errors (the caller keeps its own catch) and it never looks at what `fn` handles.
// `idleLabel` may be a function when the label depends on the language: it is read when the work is done, not when it starts.
export async function withBusy<T>(btn: BusyButton, busyLabel: string, idleLabel: string | (() => string), fn: () => Promise<T>): Promise<T> {
  btn.disabled = true;
  btn.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = typeof idleLabel === 'function' ? idleLabel() : idleLabel;
  }
}
