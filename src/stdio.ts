// Spec 09: a reader that closes the pipe early (`nullbrand list | head -1`) makes process.stdout / stderr emit 'error' (EPIPE).
// With no listener Node throws "Unhandled 'error' event" and the process dies with a stack trace; console.log / console.error do
// not swallow it. EPIPE is normal flow here, so it ends the process quietly; any other write error is reported and fails the run.
import { hasErrorCode } from './shared/guards.js';

export interface ErrorSource {
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export interface StdioGuardDeps {
  // process.exit(): called with no code so a failure already recorded in process.exitCode is kept.
  readonly exit: () => never;
  // Records the failure: sets process.exitCode.
  readonly fail: () => void;
  // Tells the user about a non-EPIPE error of stdout (stderr is the only place; it is not used for errors of stderr itself).
  readonly report: (err: unknown) => void;
}

// Listeners must never throw (the project rule): they exit, or hand the error to report / fail.
export function guardStdio(streams: { readonly stdout: ErrorSource; readonly stderr: ErrorSource }, deps: StdioGuardDeps): void {
  streams.stdout.on('error', (err) => {
    if (hasErrorCode(err, 'EPIPE')) return deps.exit();
    deps.fail();
    deps.report(err);
  });
  streams.stderr.on('error', (err) => {
    if (hasErrorCode(err, 'EPIPE')) return deps.exit();
    deps.fail(); // stderr itself is broken: there is nowhere to say so
  });
}
