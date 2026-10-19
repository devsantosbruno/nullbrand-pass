// Hand-written typings for the subset of node:child_process nullbrand uses (spawn), so the project needs no @types/node.
declare module "node:child_process" {
  type StdioOption = "pipe" | "ignore";

  interface SpawnOptions {
    shell?: boolean;
    windowsHide?: boolean;
    detached?: boolean;
    stdio?: StdioOption | readonly StdioOption[];
  }

  interface ChildReadable {
    on(event: "data", listener: (chunk: Buffer) => void): this;
  }

  interface ChildWritable {
    on(event: "error", listener: (err: Error) => void): this;
    end(chunk?: string | Uint8Array): this;
  }

  interface ChildProcess {
    readonly stdin: ChildWritable | null | undefined;
    readonly stdout: ChildReadable | null | undefined;
    once(event: "error", listener: (err: Error) => void): this;
    once(event: "spawn", listener: () => void): this;
    once(event: "exit" | "close", listener: (code: number | null, signal: string | null) => void): this;
    unref(): void;
    kill(signal?: NodeJS.Signals): boolean;
  }

  function spawn(command: string, args: readonly string[], options?: SpawnOptions): ChildProcess;
}
