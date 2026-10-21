// A reader that closes the pipe early (`nullbrand-pass list | head -1`) makes stdout/stderr emit 'error' (EPIPE). Without a listener Node
// dies with a stack trace. EPIPE is normal flow here and ends the process quietly; any other write error is reported and fails the run.
import { hasErrorCode } from './shared/guards.js';

/** The part of a stream that {@link guardStdio} needs. */
export interface ErrorSource {
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/** Side effects of {@link guardStdio}, injectable for tests. */
export interface StdioGuardDeps {
  /** Exits without a code, so a failure already recorded in `process.exitCode` is kept. */
  readonly exit: () => never;
  /** Records the failure by setting `process.exitCode`. */
  readonly fail: () => void;
  /** Tells the user about a non-EPIPE stdout error. Not used for stderr's own errors: there is nowhere left to say so. */
  readonly report: (err: unknown) => void;
}

/** Installs 'error' listeners on stdout and stderr. The listeners never throw: they exit, or hand the error to `report` and `fail`. */
export function guardStdio(streams: { readonly stdout: ErrorSource; readonly stderr: ErrorSource }, deps: StdioGuardDeps): void {
  streams.stdout.on('error', (err) => {
    if (hasErrorCode(err, 'EPIPE')) return deps.exit();
    deps.fail();
    deps.report(err);
  });
  streams.stderr.on('error', (err) => {
    if (hasErrorCode(err, 'EPIPE')) return deps.exit();
    deps.fail();
  });
}
