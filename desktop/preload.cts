// Runs in the sandboxed renderer before the page. It is a CommonJS file (.cts) because sandboxed preloads cannot be ES modules.
// The page does not need anything from the desktop shell, so the bridge only says which platform it runs on.
import electron = require('electron');

electron.contextBridge.exposeInMainWorld('nullbrandDesktop', Object.freeze({ platform: process.platform }));
