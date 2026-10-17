// Hand-written declarations for node:child_process (spawn only). Reference: Node.js 22.14.
// Docs: https://nodejs.org/docs/latest-v22.x/api/child_process.html
declare module "node:child_process" {
  // https://nodejs.org/docs/latest-v22.x/api/child_process.html#optionsstdio
  type StdioOption = "pipe" | "ignore";

  // https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processspawncommand-args-options
  interface SpawnOptions {
    // true = run through /bin/sh (or cmd.exe). The code always passes false.
    shell?: boolean;
    // Windows only: hides the console window.
    windowsHide?: boolean;
    // Lets the child outlive the parent (own process group on POSIX).
    detached?: boolean;
    // A single value applies to stdin, stdout and stderr; an array is [stdin, stdout, stderr].
    stdio?: StdioOption | readonly StdioOption[];
  }

  // https://nodejs.org/docs/latest-v22.x/api/stream.html#class-streamreadable
  interface ChildReadable {
    // Chunks are Buffers unless setEncoding() was called (it never is).
    on(event: "data", listener: (chunk: Buffer) => void): this;
  }

  // https://nodejs.org/docs/latest-v22.x/api/stream.html#class-streamwritable
  interface ChildWritable {
    // Emitted asynchronously when a write fails, typically EPIPE when the child exited before reading everything. With no 'error'
    // listener it becomes an uncaught exception. `err` is an Error carrying a string `code`.
    on(event: "error", listener: (err: Error) => void): this;
    // Writes `chunk` (UTF-8 if a string) and closes the stream. Failures arrive via the 'error' event, not by throwing.
    end(chunk?: string | Uint8Array): this;
  }

  // https://nodejs.org/docs/latest-v22.x/api/child_process.html#class-childprocess
  interface ChildProcess {
    // Docs: type Writable | null | undefined. null when stdio[0] is not 'pipe'; the docs also allow undefined (their wording for a child that
    // failed to spawn). Observed: for a command that does not exist, stdin is still a Writable and the failure arrives as an 'error' event.
    // Callers must handle null/undefined with an explicit error, not by skipping the operation.
    readonly stdin: ChildWritable | null | undefined;
    // Docs: type Readable | null | undefined, null when stdio[1] is not 'pipe'.
    readonly stdout: ChildReadable | null | undefined;
    // https://nodejs.org/docs/latest-v22.x/api/child_process.html#event-error
    // Emitted when the process could not be spawned (ENOENT, EACCES...), could not be killed, or a message could not be sent.
    // `exit` may or may not fire after an 'error'. Spawn failures are reported HERE, not by throwing from spawn() (spawn throws
    // synchronously only for invalid arguments, ERR_INVALID_ARG_TYPE).
    once(event: "error", listener: (err: Error) => void): this;
    // https://nodejs.org/docs/latest-v22.x/api/child_process.html#event-spawn  (added v15.1.0, v14.17.0)
    once(event: "spawn", listener: () => void): this;
    // https://nodejs.org/docs/latest-v22.x/api/child_process.html#event-exit
    // https://nodejs.org/docs/latest-v22.x/api/child_process.html#event-close
    // `code` is the exit code, or null when the child was ended by a signal; `signal` is the signal name, or null. One of the two is
    // always non-null. 'exit' fires when the process ends (stdio may still be open); 'close' fires after the stdio streams closed, and
    // docs: "will always emit after 'exit' was already emitted, or 'error' if the child process failed to spawn".
    once(event: "exit" | "close", listener: (code: number | null, signal: string | null) => void): this;
    // https://nodejs.org/docs/latest-v22.x/api/child_process.html#subprocessunref
    // Lets the parent exit without waiting for the child (used with detached + stdio 'ignore').
    unref(): void;
    // https://nodejs.org/docs/latest-v22.x/api/child_process.html#subprocesskillsignal
    // Returns true if the signal was delivered, false if it could not be (for example the process already ended). Default SIGTERM.
    kill(signal?: NodeJS.Signals): boolean;
  }

  function spawn(command: string, args: readonly string[], options?: SpawnOptions): ChildProcess;
}
