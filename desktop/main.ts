// Desktop shell: starts the local server of the core inside this process and shows its UI in one hardened window.
// No external browser is opened and no secret goes through a process argument; the bootstrap token only lives in memory (a stronger
// delivery is planned). The core (`./core`, a copy of the compiled ../src) is imported unchanged.
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from 'electron';
import { join } from 'node:path';
import { startServer, type RunningServer } from './core/src/server.js';
import { windowChrome } from './chrome.js';
import { appOrigin, isAllowedRequest, isAppUrl, isExternalLinkAllowed, menuTemplate, PARTITION, webPreferences } from './security.js';

const TITLE = 'nullbrand';

let server: RunningServer | null = null;
let window: BrowserWindow | null = null;
let closing = false;

// Every renderer, current or future, runs in the OS sandbox.
app.enableSandbox();

function fail(err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  dialog.showErrorBox(TITLE, `nullbrand could not start.\n\n${detail}`);
  app.exit(1);
  throw err;
}

// Navigation, popups, <webview> and permissions: the window can only ever show the local server.
function lockDown(origin: string): void {
  app.on('web-contents-created', (_event, contents) => {
    // Never a new window. The one allowed external link (the contact page) goes to the system browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalLinkAllowed(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(origin, url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isAppUrl(origin, url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !isAllowedRequest(origin, details.url) }));
}

function createWindow(url: string): BrowserWindow {
  const chrome = windowChrome(process.platform, nativeTheme.shouldUseDarkColors);
  const win = new BrowserWindow({
    ...chrome.options,
    title: TITLE,
    width: 1100,
    height: 760,
    // The UI switches to its stacked, phone-style layout at 900 px (static/styles.css); a desktop window never goes below that.
    minWidth: 920,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    webPreferences: webPreferences(join(import.meta.dirname, 'preload.cjs'), !app.isPackaged),
  });
  if (chrome.css) win.webContents.on('dom-ready', () => void win.webContents.insertCSS(chrome.css));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    window = null;
  });
  void win.loadURL(url).catch(fail);
  return win;
}

// Closing the server locks the vault, zeroes the key and clears the clipboard, so every way out of the app goes through here.
app.on('before-quit', (event) => {
  if (closing || server === null) return;
  closing = true;
  event.preventDefault();
  server.close().then(
    () => app.quit(),
    (err: unknown) => {
      console.error(err);
      app.exit(1);
    },
  );
});

app.on('window-all-closed', () => app.quit());

async function main(): Promise<void> {
  await app.whenReady();
  server = await startServer({ onShutdown: () => app.quit() });
  lockDown(appOrigin(server.port));
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(process.platform, TITLE)));
  window = createWindow(server.url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  main().catch(fail);
}
