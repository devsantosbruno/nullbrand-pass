// Local HTTP server for the Web UI. Listens ONLY on 127.0.0.1.
// Protections: single-use bootstrap token (60 s) exchanged for an HttpOnly session cookie,
// Host/Origin checks against DNS rebinding and malicious sites (on every request),
// no CORS, strict CSP, idle lock and the key kept only in memory.
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize, basename } from 'node:path';
import { coded } from './errors.js';
import { Vault, vaultExists, destroyVault, defaultVaultPath, readBackupItemsFromText, defaultHome } from './vault.js';
import { generatePassword, entropyBits } from './generator.js';
import { generateSshKey, inspectSshKey } from './sshkey.js';
import { parseBitwardenExport } from './importers/bitwarden.js';
import { randomToken, safeEqual } from './crypto.js';
import { createClipboard, ClipboardError, DEFAULT_TTL_MS, type Clipboard } from './clipboard.js';
import { SUPPORTED, normalizeLang, resolveForProcess, saveLang, translator, errText, LOCALES_DIR } from './i18n.js';
import { hasErrorCode, isObjectLike, isUnknownArray } from './shared/guards.js';
import { isLang, isTranslateParams, type TranslateParams } from './shared/i18n.js';
import type { VaultItem } from './shared/vault-types.js';
import type { ApiErrorResponse, ApiResponses, ApiRoute, PublicItem } from './shared/api.js';

const BOOTSTRAP_TTL_MS = 60_000;
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 10 * 1024 * 1024;
const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};
const SECURITY_HEADERS: OutgoingHttpHeaders = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

class HttpError extends Error {
  declare readonly status: number;
  declare readonly key: string | undefined;
  declare readonly params: TranslateParams | undefined;
  constructor(status: number, message: string, key?: string, params?: TranslateParams) {
    super(message);
    this.status = status;
    this.key = key;
    this.params = params;
  }
}

// An HttpError carrying the message / i18n key / params of a caught error (whatever was thrown).
function fromErr(status: number, err: unknown): HttpError {
  const fields = isObjectLike(err) ? err : {};
  const message = fields['message'];
  const key = fields['key'];
  const params = fields['params'];
  return new HttpError(status, typeof message === 'string' ? message : '', typeof key === 'string' ? key : undefined, isTranslateParams(params) ? params : undefined);
}

// The JSON body of a request, for the routes that read fields from it. `null` used to be a TypeError at the first property read.
function bodyFields(body: unknown): Readonly<Record<string, unknown>> {
  if (body === null) throw new HttpError(400, 'Invalid JSON.', 'err.http.invalidJson');
  return isObjectLike(body) ? body : {};
}

function publicItem(item: VaultItem): PublicItem {
  const { password, totp, sshPrivateKey, ...rest } = item;
  return { ...rest, hasPassword: Boolean(password), hasTotp: Boolean(totp), hasSshKey: Boolean(sshPrivateKey) };
}
const MAX_CLIP_TEXT = 256 * 1024;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// What a route handler receives. `id` is the `:id` of the path, when the route has one.
interface RouteContext {
  readonly id?: string | undefined;
  readonly body: unknown;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
}
type RouteHandlers = { [K in ApiRoute]: (ctx: RouteContext) => ApiResponses[K] | Promise<ApiResponses[K]> };

export interface ServerOptions {
  vaultPath?: string;
  port?: number;
  host?: string;
  idleMinutes?: number;
  token?: string;
  bootstrapTtlMs?: number;
  onShutdown?: () => void;
  clipboardTtlMs?: number;
  clipboard?: Clipboard;
  home?: string;
  langFlag?: unknown;
}
export interface RunningServer {
  port: number;
  token: string;
  url: string;
  close: () => Promise<void>;
}

export function startServer({
  vaultPath = defaultVaultPath(),
  port = 0,
  host = '127.0.0.1',
  idleMinutes = 15,
  token = randomToken(32),
  bootstrapTtlMs = BOOTSTRAP_TTL_MS,
  onShutdown = () => {},
  clipboardTtlMs = DEFAULT_TTL_MS,
  clipboard = createClipboard({ ttlMs: clipboardTtlMs }),
  home = defaultHome(),
  langFlag,
}: ServerOptions = {}): Promise<RunningServer> {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('For safety, nullbrand only listens on 127.0.0.1.');
  }
  // Always 127.0.0.1 (never 0.0.0.0 or ::), even if the caller asks for "localhost".
  host = '127.0.0.1';
  // Language: flag > NULLBRAND_LANG > config.json > system. The browser refines the last two levels.
  let langInfo = resolveForProcess({ flag: langFlag, home });
  let t = translator(langInfo.lang);
  let vault: Vault | null = null;
  let lastActivity = Date.now();
  let actualPort = port;

  // Bootstrap token: single-use and expires in 60 s. Once exchanged, only the cookie is valid.
  let bootstrapToken: string | null = token;
  const bootstrapTimer = setTimeout(() => {
    bootstrapToken = null;
  }, bootstrapTtlMs);
  bootstrapTimer.unref();
  const sessions = new Set<string>();
  const cookieName = (): string => `nullbrand_sid_${actualPort}`; // cookies don't isolate ports; the suffix avoids collisions between instances

  // Locking the vault (manually, on idle) keeps the session so the unlock screen still works;
  // only delete and shutdown drop the sessions (dropSessions = true).
  // It also clears the clipboard (only if it still holds the copied password). Returns the clear promise.
  const lock = (dropSessions: boolean = false) => {
    if (vault?.key) vault.key.fill(0);
    vault = null;
    if (dropSessions) sessions.clear();
    return clipboard.flush();
  };
  const idleTimer = setInterval(() => {
    if (vault && idleMinutes > 0 && Date.now() - lastActivity > idleMinutes * 60_000) {
      lock().then(
        (cleared) => {
          // The password may still be on the clipboard: nobody is looking at the screen, so at least leave a trace.
          if (cleared === 'failed' || cleared === 'unverified') console.error(t(`clipboard.idle.${cleared}`));
        },
        (err: unknown) => console.error(errText(t, err)),
      );
    }
  }, 10_000);
  idleTimer.unref();

  const requireVault = (): Vault => {
    if (!vault) throw new HttpError(423, 'Vault locked.', 'err.http.locked');
    return vault;
  };

  // `:id` is always there on the routes that declare it; a missing one is "item not found", as vault.get/update/remove(undefined) were.
  // A missing item is 404 (like GET /api/items/:id); any other error keeps the status it had.
  async function notFoundOp<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw isObjectLike(err) && err['key'] === 'err.vault.itemNotFound' ? fromErr(404, err) : err;
    }
  }

  // Rejects with ECONNRESET ("aborted") when the client disconnects before the body is complete; the caller's try/catch turns that into
  // an error answer (written to a socket that is already gone, which is harmless).
  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'File too large (max. 10 MB).', 'err.http.fileTooLarge');
      chunks.push(chunk);
    }
    if (size === 0) return {};
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return parsed;
    } catch {
      throw new HttpError(400, 'Invalid JSON.', 'err.http.invalidJson');
    }
  }

  function send(res: ServerResponse, status: number, body: object | string, extra: OutgoingHttpHeaders = {}): void {
    const isBuffer = Buffer.isBuffer(body) || typeof body === 'string';
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json; charset=utf-8',
      ...extra,
    });
    res.end(isBuffer ? body : JSON.stringify(body));
  }

  // Runs before any route. Protects against DNS rebinding (Host) and CSRF (Origin).
  // No CORS header is sent anywhere, so other origins can't read responses.
  function checkHostAndOrigin(req: IncomingMessage): void {
    const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    const requestHost = req.headers.host;
    if (requestHost === undefined || !hosts.includes(requestHost)) throw new HttpError(421, 'Host not allowed.', 'err.http.hostNotAllowed');
    const origin = req.headers.origin;
    if (STATE_CHANGING.has(req.method) && origin === undefined) throw new HttpError(403, 'Missing origin.', 'err.http.missingOrigin');
    if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) throw new HttpError(403, 'Origin not allowed.', 'err.http.originNotAllowed');
  }

  function sessionFromCookie(req: IncomingMessage): string {
    const name = cookieName();
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return '';
  }

  // Compares against every session without exiting on the first match.
  function hasValidSession(req: IncomingMessage): boolean {
    const sid = sessionFromCookie(req);
    if (!sid) return false;
    let ok = false;
    for (const s of sessions) if (safeEqual(sid, s)) ok = true;
    return ok;
  }

  // GET /auth?t=<token>: exchanges the bootstrap token for a session cookie and cleans the URL.
  function handleAuth(_req: IncomingMessage, res: ServerResponse, url: URL): void {
    const given = url.searchParams.get('t') || '';
    const valid = bootstrapToken !== null && given !== '' && safeEqual(given, bootstrapToken);
    if (!valid) throw new HttpError(403, 'Access denied.', 'err.http.accessDenied');
    bootstrapToken = null; // single use: invalidated on the first valid request
    clearTimeout(bootstrapTimer);
    const sid = randomToken(32);
    sessions.add(sid);
    res.writeHead(303, {
      ...SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      Location: '/',
      'Set-Cookie': `${cookieName()}=${sid}; HttpOnly; SameSite=Strict; Path=/`,
    });
    res.end();
  }

  // Vault validation errors (empty name, nonexistent folder) become 400.
  // The vault is checked by the caller first (requireVault), so a locked vault stays 423.
  async function folderOp<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw fromErr(400, err);
    }
  }

  const routes: RouteHandlers = {
    'GET /api/status': () => ({
      exists: vaultExists(vaultPath),
      unlocked: Boolean(vault),
      vaultPath,
      idleMinutes,
      count: vault ? vault.items.length : null,
      lang: langInfo.lang,
      langSource: langInfo.source,
    }),

    'GET /api/config': () => ({ lang: langInfo.lang, source: langInfo.source, supported: SUPPORTED }),

    // Explicit choice only: this is the one place that writes config.json.
    'PUT /api/config': async ({ body }) => {
      const given = bodyFields(body)['lang'];
      const lang = normalizeLang(given);
      if (!lang || typeof given !== 'string' || given.trim().toLowerCase() !== lang) throw new HttpError(400, 'Unsupported language.', 'err.http.badLang');
      await saveLang(home, lang);
      langInfo = { lang, source: 'config', warnings: [] };
      t = translator(lang);
      return { lang, source: 'config', supported: SUPPORTED };
    },

    'POST /api/setup': async ({ body }) => {
      if (vaultExists(vaultPath)) throw new HttpError(409, 'The vault already exists.', 'err.http.vaultExists');
      const created = await Vault.create(String(bodyFields(body)['password'] || ''), vaultPath);
      vault?.key.fill(0);
      vault = created;
      return { ok: true };
    },

    'POST /api/unlock': async ({ body }) => {
      if (!vaultExists(vaultPath)) throw new HttpError(404, 'No vault created yet.', 'err.http.noVault');
      try {
        const opened = await Vault.unlock(String(bodyFields(body)['password'] || ''), vaultPath);
        if (vault && vault !== opened) vault.key.fill(0); // a second unlock must not leave the previous key behind in memory
        vault = opened;
        if (opened.migration) console.error(t('server.vaultUpgraded', { version: opened.header.version, backup: opened.migration.backup }));
        else if (opened.migrationError) console.error(t('server.upgradeFailed', { reason: opened.migrationError }));
      } catch (err) {
        if (hasErrorCode(err, 'WRONG_PASSWORD')) {
          await sleep(800);
          throw fromErr(401, err);
        }
        throw err;
      }
      return { ok: true };
    },

    'POST /api/lock': async () => {
      await lock();
      return { ok: true };
    },

    'GET /api/items': () => requireVault().list().map(publicItem),

    'GET /api/items/:id': ({ id }) => {
      const item = id === undefined ? null : requireVault().get(id);
      if (!item) throw new HttpError(404, 'Item not found.', 'err.vault.itemNotFound');
      return item;
    },

    'POST /api/items': async ({ body }) => requireVault().add(body),

    'PUT /api/items/:id': async ({ id, body }) => {
      if (id === undefined) throw new HttpError(404, 'Item not found.', 'err.vault.itemNotFound');
      const v = requireVault();
      return notFoundOp(() => v.update(id, body));
    },

    'DELETE /api/items/:id': async ({ id }) => {
      if (id === undefined) throw new HttpError(404, 'Item not found.', 'err.vault.itemNotFound');
      const v = requireVault();
      await notFoundOp(() => v.remove(id));
      return { ok: true };
    },

    'POST /api/items/bulk': async ({ body }) => {
      const v = requireVault();
      const fields = bodyFields(body);
      const rawIds = fields['ids'];
      const ids = isUnknownArray(rawIds) ? rawIds.filter((x): x is string => typeof x === 'string') : [];
      if (!ids.length) throw new HttpError(400, 'No item selected.', 'err.http.noSelection');
      if (fields['action'] === 'delete') await v.removeMany(ids);
      else if (fields['action'] === 'move') await v.moveMany(ids, String(fields['folder'] || '').slice(0, 200).trim());
      else throw new HttpError(400, 'Invalid action.', 'err.http.invalidAction');
      return { ok: true, count: ids.length };
    },

    'GET /api/folders': () => requireVault().listFolders(),

    'POST /api/folders': async ({ body }) => {
      const v = requireVault();
      return { name: await folderOp(() => v.addFolder(bodyFields(body)['name'])) };
    },

    'PUT /api/folders': async ({ body }) => {
      const v = requireVault();
      const fields = bodyFields(body);
      return { name: await folderOp(() => v.renameFolder(String(fields['from'] || ''), fields['to'])) };
    },

    'POST /api/folders/delete': async ({ body }) => {
      const v = requireVault();
      const fields = bodyFields(body);
      return { ok: true, ...(await folderOp(() => v.deleteFolder(fields['name'], { deleteItems: fields['deleteItems'] === true }))) };
    },

    // Generates or inspects an SSH key; nothing is saved until the item is stored.
    'POST /api/ssh/generate': ({ body }) => {
      try {
        return generateSshKey(String(bodyFields(body)['algo'] || ''));
      } catch (err) {
        throw fromErr(400, err);
      }
    },

    'POST /api/ssh/inspect': ({ body }) => {
      try {
        return inspectSshKey(String(bodyFields(body)['privateKey'] || ''));
      } catch (err) {
        throw fromErr(400, err);
      }
    },

    // Copying and clearing happen here, in the Node process: the browser may be unfocused
    // (and without clipboard permission) when the timer fires. `sensitive: false` copies without a timer.
    'POST /api/clipboard/copy': async ({ body }) => {
      requireVault();
      const fields = bodyFields(body);
      const rawText = fields['text'];
      const text = typeof rawText === 'string' ? rawText : '';
      if (!text) throw new HttpError(400, 'Nothing to copy.', 'err.http.nothingToCopy');
      if (text.length > MAX_CLIP_TEXT) throw new HttpError(413, 'Text too large to copy.', 'err.http.textTooLarge');
      const sensitive = fields['sensitive'] !== false;
      try {
        const r = await clipboard.copy(text, { sensitive, ttlMs: sensitive ? clipboardTtlMs : 0 });
        return { ok: true, seconds: Math.round(r.ttlMs / 1000), ...(r.concealed ? {} : { concealed: false as const }) };
      } catch (err) {
        if (err instanceof ClipboardError) throw fromErr(503, err);
        throw err;
      }
    },

    'POST /api/generate': ({ body }) => ({ password: generatePassword(body), bits: entropyBits(body) }),

    'POST /api/import/bitwarden': async ({ body }) => {
      const v = requireVault();
      const { items, ignored } = parseBitwardenExport(String(bodyFields(body)['text'] || ''));
      const result = await v.merge(items);
      return { ...result, ignored };
    },

    'POST /api/import/backup': async ({ body }) => {
      const v = requireVault();
      const fields = bodyFields(body);
      let items: VaultItem[];
      try {
        items = await readBackupItemsFromText(String(fields['text'] || ''), String(fields['password'] || ''));
      } catch (err) {
        if (hasErrorCode(err, 'WRONG_PASSWORD')) throw new HttpError(401, 'Incorrect backup password.', 'err.http.backupWrongPassword');
        throw fromErr(400, err);
      }
      return v.merge(items);
    },

    'GET /api/export/backup': ({ res }) => {
      const v = requireVault();
      const date = new Date().toISOString().slice(0, 10);
      send(res, 200, v.serialize(), {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="nullbrand-backup-${date}.json"`,
      });
      return undefined;
    },

    'POST /api/password': async ({ body }) => {
      const v = requireVault();
      const fields = bodyFields(body);
      try {
        (await Vault.unlock(String(fields['current'] || ''), vaultPath, { migrate: false })).key.fill(0);
      } catch (err) {
        if (hasErrorCode(err, 'WRONG_PASSWORD')) {
          await sleep(800);
          throw new HttpError(401, 'Current master password is incorrect.', 'err.http.currentWrongPassword');
        }
        throw err;
      }
      await v.changePassword(String(fields['next'] || ''));
      return { ok: true };
    },

    // Requires the master password, even when the vault is locked.
    'POST /api/destroy': async ({ body }) => {
      if (!vaultExists(vaultPath)) throw new HttpError(404, 'No vault to delete.', 'err.http.noVaultToDelete');
      try {
        (await Vault.unlock(String(bodyFields(body)['password'] || ''), vaultPath, { migrate: false })).key.fill(0);
      } catch (err) {
        if (hasErrorCode(err, 'WRONG_PASSWORD')) {
          await sleep(800);
          throw new HttpError(401, 'Incorrect master password.', 'err.http.destroyWrongPassword');
        }
        throw err;
      }
      await lock(true);
      await destroyVault(vaultPath);
      return { ok: true };
    },

    'POST /api/shutdown': ({ res }) => {
      send(res, 200, { ok: true });
      setTimeout(async () => {
        // Nothing may throw out of this callback (an unhandled rejection would crash the process): report it and still close.
        const report = (err: unknown): void => {
          console.error(errText(t, err));
          process.exitCode = 1;
        };
        try {
          await lock(true);
        } catch (err) {
          report(err);
        }
        server.close();
        try {
          onShutdown();
        } catch (err) {
          report(err);
        }
      }, 50);
      return undefined;
    },
  };

  function matchRoute(method: string, pathname: string): { handler: RouteHandlers[ApiRoute]; params: Record<string, string> } | null {
    for (const [key, handler] of Object.entries(routes)) {
      const [m, pattern] = key.split(' ');
      if (m !== method || pattern === undefined) continue;
      const a = pattern.split('/');
      const b = pathname.split('/');
      if (a.length !== b.length) continue;
      const params: Record<string, string> = {};
      const matches = a.every((seg, i) => {
        const part = b[i];
        if (part === undefined) return false;
        if (seg.startsWith(':')) {
          try {
            params[seg.slice(1)] = decodeURIComponent(part);
          } catch {
            throw new HttpError(400, 'Malformed URL.', 'err.http.malformedUrl');
          }
          return true;
        }
        return seg === part;
      });
      if (matches) return { handler, params };
    }
    return null;
  }

  async function serveLocale(res: ServerResponse, pathname: string): Promise<void> {
    const m = /^\/locales\/([a-z]{2})\.json$/.exec(pathname);
    const lang = m?.[1];
    if (lang === undefined || !isLang(lang)) throw new HttpError(404, 'Not found.', 'err.http.notFound');
    const data = await readFile(new URL(`${lang}.json`, LOCALES_DIR));
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
    res.end(data);
  }

  async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
    const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '');
    if (rel.includes('..') || basename(rel).startsWith('.')) throw new HttpError(404, 'Not found.', 'err.http.notFound');
    const file = join(PUBLIC_DIR, rel);
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      throw new HttpError(404, 'Not found.', 'err.http.notFound');
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  }

  // The status and body of an error answer: the same status / message / key / params the handlers always put in it.
  function errorAnswer(err: unknown): { status: number; body: ApiErrorResponse } {
    const fields = isObjectLike(err) ? err : {};
    const status = fields['status'];
    const message = fields['message'];
    const key = fields['key'];
    const params = fields['params'];
    // Domain errors carry a status (HttpError) or an i18n key (coded). Anything else is a bug or a system failure (ENOSPC, EACCES…):
    // it is not the client's fault, so it is logged here and answered as a generic 500 without leaking the message (paths).
    if (!(typeof status === 'number' && status) && typeof key !== 'string') {
      console.error(errText(t, err));
      return { status: 500, body: { error: 'Unexpected error.', key: 'err.http.unexpected' } };
    }
    return {
      status: typeof status === 'number' && status ? status : 400,
      body: {
        error: typeof message === 'string' && message ? message : 'Unexpected error.',
        key: typeof key === 'string' && key ? key : message ? undefined : 'err.http.unexpected',
        params: isTranslateParams(params) ? params : undefined,
      },
    };
  }

  const server = createHttpServer(async (req, res) => {
    try {
      checkHostAndOrigin(req);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/auth') {
        if (req.method !== 'GET') {
          req.resume(); // discard the body, so the client gets the 405 instead of ECONNRESET
          throw new HttpError(405, 'Method not allowed.', 'err.http.methodNotAllowed');
        }
        return handleAuth(req, res, url);
      }
      // Everything requires a session, except /auth (which requires the token): another user on the
      // computer who connects to the port doesn't get even the static files, only 401.
      if (!hasValidSession(req)) {
        throw new HttpError(401, 'Invalid or ended session. Run npx nullbrand again to open a new one.', 'err.http.noSession');
      }
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') {
          req.resume(); // discard the body, so the client gets the 405 instead of ECONNRESET
          throw new HttpError(405, 'Method not allowed.', 'err.http.methodNotAllowed');
        }
        if (url.pathname.startsWith('/locales/')) return await serveLocale(res, url.pathname);
        return await serveStatic(res, url.pathname);
      }
      const route = matchRoute(req.method, url.pathname);
      if (!route) throw new HttpError(404, 'Route not found.', 'err.http.notFound');
      lastActivity = Date.now();
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await route.handler({ ...route.params, body, req, res });
      if (result !== undefined) send(res, 200, result);
    } catch (err) {
      const { status, body } = errorAnswer(err);
      if (!res.headersSent) {
        // /auth doesn't explain why it refused (wrong, used or expired token).
        if (req.url?.startsWith('/auth')) send(res, status, { error: 'Access denied.' });
        else send(res, status, body);
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      // Inside this asynchronous callback nothing may throw (it would crash the process): an address that is not a TCP one rejects instead.
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(coded('err.internal.invalid', 'Internal error: the server did not get a TCP address.', { what: 'server address' }));
        return;
      }
      actualPort = address.port;
      resolve({
        port: actualPort,
        token,
        url: `http://127.0.0.1:${actualPort}/auth?t=${token}`,
        close: async () => {
          await lock(true);
          return new Promise((r) => {
            bootstrapToken = null;
            clearTimeout(bootstrapTimer);
            clearInterval(idleTimer);
            server.close(() => r());
            server.closeAllConnections?.();
          });
        },
      });
    });
  });
}
