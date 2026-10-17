// Hand-written declarations for node:readline (createInterface only). Reference: Node.js 22.14.
// Docs: https://nodejs.org/docs/latest-v22.x/api/readline.html
declare module "node:readline" {
  // https://nodejs.org/docs/latest-v22.x/api/readline.html#class-readlineinterface
  interface Interface {
    // https://nodejs.org/docs/latest-v22.x/api/readline.html#event-line
    // One call per input line, WITHOUT the line terminator. A final line with no terminator is still emitted when the input ends.
    on(event: "line", listener: (input: string) => void): this;
    // https://nodejs.org/docs/latest-v22.x/api/readline.html#event-close
    // Emitted when close() is called, when the input stream ends ('end'), or on Ctrl+D / (with no SIGINT listener) Ctrl+C on a TTY.
    // Takes no arguments.
    on(event: "close", listener: () => void): this;
    // Docs: closes the interface and relinquishes the input/output streams; 'close' is emitted; 'line' events may still arrive afterwards.
    // The docs do not say whether closing twice is safe; observed: a second call does nothing and throws nothing.
    close(): void;
    // PRIVATE, UNDOCUMENTED readline API (the docs never mention it; Node may rename or remove it in any release). prompt.ts uses it to
    // swallow the echo of a password being typed. Declared optional and writable because it is replaced on the instance: prompt.ts
    // MUST check `typeof rl._writeToOutput === "function"` before overriding it and refuse to prompt for the password (explicit typed
    // error) when it is missing, instead of letting the password show on screen. Recorded as technical debt.
    _writeToOutput?: ((stringToWrite: string) => void) | undefined;
  }

  // https://nodejs.org/docs/latest-v22.x/api/readline.html#readlinecreateinterfaceoptions
  // `output` is optional in the docs but always passed here. `terminal` set to true means input and output are treated as a TTY
  // (ANSI escapes, echo handled by readline); default is output.isTTY. Does not throw on valid streams.
  function createInterface(options: {
    input: NodeJS.ReadStream;
    output: NodeJS.WriteStream;
    terminal: boolean;
  }): Interface;
}
