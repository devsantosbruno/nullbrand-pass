// Hand-written declarations for node:http (the parts nullbrand's local server uses). Reference: Node.js 22.14.
// Docs: https://nodejs.org/docs/latest-v22.x/api/http.html
declare module "node:http" {
  // https://nodejs.org/docs/latest-v22.x/api/http.html#messageheaders
  // Header names are lower-cased by Node. Docs: duplicates of `host` (and age, authorization, content-length, ...) are DISCARDED, the
  // first wins; duplicate `cookie` headers are joined with ';'; "for all other headers" (so `origin`) duplicates are joined with ','.
  // Observed: host "a.test" (first of two), origin "http://o1, http://o2", cookie "a=1; b=2". So these three are plain strings, never arrays.
  interface IncomingHttpHeaders {
    [header: string]: string | string[] | undefined;
    host?: string | undefined;
    origin?: string | undefined;
    cookie?: string | undefined;
  }

  // https://nodejs.org/docs/latest-v22.x/api/http.html#class-httpincomingmessage
  // Declared for the REQUEST handed to a server's listener, and only the members server.js uses: method, url, headers, and reading the
  // body with `for await (const chunk of req)` (src/server.js readBody). No 'data' / 'end' / 'close' listener is registered on the request.
  // `method` and `url` are documented as "only valid for a request obtained from http.Server", which is the only use here, so they
  // are plain strings (url is the request target, e.g. '/auth?t=x').
  interface IncomingMessage {
    readonly method: string;
    readonly url: string;
    readonly headers: IncomingHttpHeaders;
    // Async iteration over the body (the request is a Readable stream). Chunks are Buffers as long as setEncoding() was not called (it never
    // is); `for await` finishes normally once the body has been read ('end'). If the loop exits early (break / throw) the stream is destroyed.
    // Observed: when the client disconnects before the body is complete (Content-Length not reached) the iteration REJECTS with an Error
    // whose code is ECONNRESET and message "aborted" (chunks already read are lost to the caller; req.destroyed is true), so the caller
    // must be inside a try/catch.
    [Symbol.asyncIterator](): AsyncIterator<Buffer>;
    // https://nodejs.org/docs/latest-v22.x/api/stream.html#readableresume
    // Puts the stream in flowing mode with no 'data' listener: the body is read and thrown away (used before answering 405 without reading it).
    resume(): this;
  }

  // https://nodejs.org/docs/latest-v22.x/api/http.html#responsewriteheadstatuscode-statusmessage-headers
  // An array value sends the header several times. Docs: a header name or value with invalid characters makes writeHead THROW a TypeError.
  interface OutgoingHttpHeaders {
    [header: string]: number | string | readonly string[] | undefined;
  }

  // https://nodejs.org/docs/latest-v22.x/api/http.html#class-httpserverresponse
  interface ServerResponse {
    // true once the headers were flushed (writeHead + first write/end).
    readonly headersSent: boolean;
    // Docs: throws RangeError if statusCode is not in [100, 999] (observed code ERR_HTTP_INVALID_STATUS_CODE); "must only be called once on
    // a message". Observed: a second call throws Error ERR_HTTP_HEADERS_SENT. Returns the response (chainable).
    // The optional statusMessage overload is not declared.
    writeHead(statusCode: number, headers?: OutgoingHttpHeaders): this;
    // Finishes the response. A string is written as UTF-8. If the client already disconnected the data is dropped and no
    // exception is thrown. Returns the response.
    end(chunk?: string | Uint8Array): this;
  }

  // https://nodejs.org/docs/latest-v22.x/api/net.html#serveraddress  (only `port` is read)
  interface AddressInfo {
    readonly port: number;
  }

  // https://nodejs.org/docs/latest-v22.x/api/http.html#class-httpserver
  interface Server {
    // https://nodejs.org/docs/latest-v22.x/api/net.html#serverlistenport-host-backlog-callback
    // Failures (EADDRINUSE, EACCES, EADDRNOTAVAIL) are NOT thrown and NOT passed to `listeningListener`: they are emitted as an
    // 'error' event, so a listener for it must be registered. `listeningListener` takes no arguments and runs once on 'listening'.
    // `port` 0 picks a free port. Invalid arguments make listen throw synchronously (ERR_SOCKET_BAD_PORT).
    listen(port: number, hostname: string, listeningListener?: () => void): this;
    // Returns an object for IP sockets, a string for pipes / Unix sockets, and null before 'listening' or after the server closed.
    address(): AddressInfo | string | null;
    // Stops accepting new connections; `callback` runs on 'close' (after existing connections end). Unlike the event, it is called
    // with an Error (ERR_SERVER_NOT_RUNNING) as its only argument if the server was not open when close() was called.
    close(callback?: (err?: Error) => void): this;
    // Closes every connection, including idle and active ones (added in v18.2.0).
    closeAllConnections(): void;
    // The listen failures above arrive here as a system error: an Error with a string `code` (e.g. 'EADDRINUSE').
    // `err` is typed Error; reading `code` needs a guard.
    once(event: "error", listener: (err: Error) => void): this;
  }

  // https://nodejs.org/docs/latest-v22.x/api/http.html#httpcreateserveroptions-requestlistener
  // The listener's return value is ignored: an async listener that REJECTS produces an unhandled rejection, so the listener must
  // catch everything itself (server.ts does).
  function createServer(requestListener: (req: IncomingMessage, res: ServerResponse) => void): Server;
}
