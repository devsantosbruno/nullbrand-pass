// Decisions of the desktop shell that do not need Electron to run, so they can be tested with plain Node: what the window may load,
// how the renderer is locked down, and the application menu. main.ts only wires them to Electron.
import type { MenuItemConstructorOptions, WebPreferences } from 'electron';

/** In-memory session partition (no `persist:` prefix): the session cookie, cache and storage never reach the disk. */
export const PARTITION = 'nullbrand';

/** The only origin the window may show or talk to: the local server, on loopback and an ephemeral port. */
export function appOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** True when `raw` is a URL on `origin`. Anything that does not parse is refused. */
export function isAppUrl(origin: string, raw: string): boolean {
  try {
    return new URL(raw).origin === origin;
  } catch {
    return false;
  }
}

/** The only external site the window may send the user to (opened in the system browser, never inside the window). */
export const EXTERNAL_ORIGIN = 'https://nullbrand.dev';

/** True when `raw` is an https link on {@link EXTERNAL_ORIGIN}. Other schemes, hosts, ports and userinfo tricks are refused. */
export function isExternalLinkAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === EXTERNAL_ORIGIN && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/**
 * True when a network request of the window may go out. Besides the app origin, `data:` is allowed because the CSP allows
 * `img-src data:` (inline icons). Nothing else: no other host, no `file:`, no websocket.
 */
export function isAllowedRequest(origin: string, raw: string): boolean {
  try {
    return new URL(raw).protocol === 'data:' || isAppUrl(origin, raw);
  } catch {
    return false;
  }
}

/**
 * Renderer settings. The page is remote-origin content (the local server), so it gets no Node, runs in the OS sandbox with context
 * isolation, and never loads insecure content. `spellcheck: false` also keeps Chromium from downloading dictionaries, which would be
 * an outbound connection.
 */
export function webPreferences(preloadPath: string, devTools: boolean): WebPreferences {
  return {
    preload: preloadPath,
    partition: PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    safeDialogs: true,
    devTools,
  };
}

/** The application menu. No reload or developer-tools entries; the Edit menu is what makes copy and paste work on macOS. */
export function menuTemplate(platform: NodeJS.Platform, appName: string): MenuItemConstructorOptions[] {
  const edit: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
  };
  if (platform === 'darwin') {
    return [
      {
        label: appName,
        submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }],
      },
      edit,
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
    ];
  }
  return [{ label: 'File', submenu: [{ role: 'quit' }] }, edit, { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }];
}
