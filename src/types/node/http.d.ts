// Hand-written typings for the subset of node:http nullbrand's local server uses, so the project needs no @types/node.
declare module "node:http" {
  interface IncomingHttpHeaders {
    [header: string]: string | string[] | undefined;
    host?: string | undefined;
    origin?: string | undefined;
    cookie?: string | undefined;
  }

  interface IncomingMessage {
    readonly method: string;
    readonly url: string;
    readonly headers: IncomingHttpHeaders;
    [Symbol.asyncIterator](): AsyncIterator<Buffer>;
    resume(): this;
  }

  interface OutgoingHttpHeaders {
    [header: string]: number | string | readonly string[] | undefined;
  }

  interface ServerResponse {
    readonly headersSent: boolean;
    writeHead(statusCode: number, headers?: OutgoingHttpHeaders): this;
    end(chunk?: string | Uint8Array): this;
  }

  interface AddressInfo {
    readonly port: number;
  }

  interface Server {
    listen(port: number, hostname: string, listeningListener?: () => void): this;
    address(): AddressInfo | string | null;
    close(callback?: (err?: Error) => void): this;
    closeAllConnections(): void;
    once(event: "error", listener: (err: Error) => void): this;
  }

  function createServer(requestListener: (req: IncomingMessage, res: ServerResponse) => void): Server;
}
