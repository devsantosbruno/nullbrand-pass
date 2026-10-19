/** The part of a button that {@link withBusy} touches. Structural on purpose, so it can be tested without a DOM. */
export interface BusyButton {
  disabled: boolean;
  textContent: string | null;
}

/**
 * Disables the button and shows `busyLabel` while `fn` runs, then restores it whether `fn` resolves or throws. Errors are not swallowed.
 * @param idleLabel may be a function when the label depends on the language; it is read when the work ends, not when it starts.
 */
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
