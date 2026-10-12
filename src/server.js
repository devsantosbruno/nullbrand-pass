// Servidor HTTP local da Web UI. Escuta SOMENTE em 127.0.0.1.
// Proteções: token de lançamento por processo (exigido em toda chamada de API),
// checagem de Host/Origin contra DNS rebinding e sites maliciosos, CSP restritiva,
// bloqueio automático por inatividade e chave mantida só em memória.
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize, basename } from 'node:path';
import { Vault, vaultExists, defaultVaultPath, readBackupItemsFromText } from './vault.js';
import { generatePassword, entropyBits } from './generator.js';
import { parseBitwardenExport } from './importers/bitwarden.js';
import { randomToken, safeEqual } from './crypto.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 10 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const SECURITY_HEADERS = {
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
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const publicItem = ({ password, totp, ...rest }) => ({ ...rest, hasPassword: Boolean(password), hasTotp: Boolean(totp) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startServer({
  vaultPath = defaultVaultPath(),
  port = 0,
  host = '127.0.0.1',
  idleMinutes = 15,
  token = randomToken(),
  onShutdown = () => {},
} = {}) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Por segurança o voltrama-pass só escuta em 127.0.0.1.');
  }
  let vault = null;
  let lastActivity = Date.now();
  let actualPort = port;

  const lock = () => {
    if (vault?.key) vault.key.fill(0);
    vault = null;
  };
  const idleTimer = setInterval(() => {
    if (vault && idleMinutes > 0 && Date.now() - lastActivity > idleMinutes * 60_000) lock();
  }, 10_000);
  idleTimer.unref();

  const requireVault = () => {
    if (!vault) throw new HttpError(423, 'Cofre bloqueado.');
    return vault;
  };

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Arquivo grande demais (máx. 10 MB).');
      chunks.push(chunk);
    }
    if (size === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'JSON inválido.');
    }
  }

  function send(res, status, body, extra = {}) {
    const isBuffer = Buffer.isBuffer(body) || typeof body === 'string';
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json; charset=utf-8',
      ...extra,
    });
    res.end(isBuffer ? body : JSON.stringify(body));
  }

  function checkOrigin(req) {
    const allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`]);
    if (!allowedHosts.has(req.headers.host)) throw new HttpError(403, 'Host não permitido.');
    const origin = req.headers.origin;
    if (origin && !allowedHosts.has(origin.replace(/^http:\/\//, ''))) throw new HttpError(403, 'Origem não permitida.');
  }

  const routes = {
    'GET /api/status': () => ({
      exists: vaultExists(vaultPath),
      unlocked: Boolean(vault),
      vaultPath,
      idleMinutes,
      count: vault ? vault.items.length : null,
    }),

    'POST /api/setup': async ({ body }) => {
      if (vaultExists(vaultPath)) throw new HttpError(409, 'O cofre já existe.');
      vault = await Vault.create(String(body.password || ''), vaultPath);
      return { ok: true };
    },

    'POST /api/unlock': async ({ body }) => {
      if (!vaultExists(vaultPath)) throw new HttpError(404, 'Nenhum cofre criado ainda.');
      try {
        vault = await Vault.unlock(String(body.password || ''), vaultPath);
      } catch (err) {
        if (err.code === 'WRONG_PASSWORD') {
          await sleep(800);
          throw new HttpError(401, err.message);
        }
        throw err;
      }
      return { ok: true };
    },

    'POST /api/lock': () => {
      lock();
      return { ok: true };
    },

    'GET /api/items': () => requireVault().list().map(publicItem),

    'GET /api/items/:id': ({ id }) => {
      const item = requireVault().get(id);
      if (!item) throw new HttpError(404, 'Item não encontrado.');
      return item;
    },

    'POST /api/items': async ({ body }) => requireVault().add(body),

    'PUT /api/items/:id': async ({ id, body }) => requireVault().update(id, body),

    'DELETE /api/items/:id': async ({ id }) => {
      await requireVault().remove(id);
      return { ok: true };
    },

    'POST /api/generate': ({ body }) => ({ password: generatePassword(body), bits: entropyBits(body) }),

    'POST /api/import/bitwarden': async ({ body }) => {
      const v = requireVault();
      const { items, ignored } = parseBitwardenExport(String(body.text || ''));
      const result = await v.merge(items);
      return { ...result, ignored };
    },

    'POST /api/import/backup': async ({ body }) => {
      const v = requireVault();
      let items;
      try {
        items = await readBackupItemsFromText(String(body.text || ''), String(body.password || ''));
      } catch (err) {
        if (err.code === 'WRONG_PASSWORD') throw new HttpError(401, 'Senha do backup incorreta.');
        throw new HttpError(400, err.message);
      }
      return v.merge(items);
    },

    'GET /api/export/backup': ({ res }) => {
      const v = requireVault();
      const date = new Date().toISOString().slice(0, 10);
      send(res, 200, v.serialize(), {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="voltrama-pass-backup-${date}.json"`,
      });
      return undefined;
    },

    'POST /api/password': async ({ body }) => {
      const v = requireVault();
      try {
        await Vault.unlock(String(body.current || ''), vaultPath);
      } catch (err) {
        if (err.code === 'WRONG_PASSWORD') {
          await sleep(800);
          throw new HttpError(401, 'Senha mestra atual incorreta.');
        }
        throw err;
      }
      await v.changePassword(String(body.next || ''));
      return { ok: true };
    },

    'POST /api/shutdown': ({ res }) => {
      send(res, 200, { ok: true });
      setTimeout(() => {
        lock();
        server.close();
        onShutdown();
      }, 50);
      return undefined;
    },
  };

  function matchRoute(method, pathname) {
    for (const [key, handler] of Object.entries(routes)) {
      const [m, pattern] = key.split(' ');
      if (m !== method) continue;
      const a = pattern.split('/');
      const b = pathname.split('/');
      if (a.length !== b.length) continue;
      const params = {};
      if (a.every((seg, i) => (seg.startsWith(':') ? ((params[seg.slice(1)] = decodeURIComponent(b[i])), true) : seg === b[i]))) {
        return { handler, params };
      }
    }
    return null;
  }

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '');
    if (rel.includes('..') || basename(rel).startsWith('.')) throw new HttpError(404, 'Não encontrado.');
    const file = join(PUBLIC_DIR, rel);
    let data;
    try {
      data = await readFile(file);
    } catch {
      throw new HttpError(404, 'Não encontrado.');
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  }

  const server = createHttpServer(async (req, res) => {
    try {
      checkOrigin(req);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido.');
        return await serveStatic(res, url.pathname);
      }
      if (!safeEqual(req.headers['x-voltrama-token'] || '', token)) {
        throw new HttpError(401, 'Sessão inválida. Abra o voltrama-pass pelo link mostrado no terminal.');
      }
      const route = matchRoute(req.method, url.pathname);
      if (!route) throw new HttpError(404, 'Rota não encontrada.');
      lastActivity = Date.now();
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      const result = await route.handler({ ...route.params, body, req, res });
      if (result !== undefined) send(res, 200, result);
    } catch (err) {
      const status = err.status || 400;
      if (!res.headersSent) send(res, status, { error: err.message || 'Erro inesperado.' });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      actualPort = server.address().port;
      resolve({
        port: actualPort,
        token,
        url: `http://127.0.0.1:${actualPort}/#t=${token}`,
        close: () =>
          new Promise((r) => {
            lock();
            clearInterval(idleTimer);
            server.close(() => r());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
