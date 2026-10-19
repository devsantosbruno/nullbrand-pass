// Hand-written typings for node:readline (createInterface only), so the project needs no @types/node.
declare module "node:readline" {
  interface Interface {
    on(event: "line", listener: (input: string) => void): this;
    on(event: "close", listener: () => void): this;
    close(): void;
    _writeToOutput?: ((stringToWrite: string) => void) | undefined;
  }

  function createInterface(options: {
    input: NodeJS.ReadStream;
    output: NodeJS.WriteStream;
    terminal: boolean;
  }): Interface;
}
