// How the window looks around the UI. Pure, so it can be tested on plain Node; main.ts applies it.
// The UI itself (../static) is untouched: the extra CSS is injected by the shell, which also keeps the browser version as it was.
import type { BrowserWindowConstructorOptions } from 'electron';

/** What a platform gets: window options and CSS injected into the page after it loads. */
export interface WindowChrome {
  readonly options: BrowserWindowConstructorOptions;
  readonly css: string;
}

// The UI's own page backgrounds (--bg of static/styles.css), used so the window never flashes the wrong colour while it loads.
const BG_DARK = '#0b0c0d';
const BG_LIGHT = '#f7f8f9';

// macOS: no title bar, the traffic lights sit on the UI, and the sidebar is the system's translucent "sidebar" material.
// Chromium treats `-webkit-app-region: drag` as the area that moves the window; interactive elements are excluded from it.
const MAC_CSS = `
html, body { background: transparent !important; }
#screen-setup, #screen-unlock { background: var(--bg); }
.app .list-pane, .app .detail-pane { background: var(--bg); }
/* #sidebar: the page's own .sidebar rules come later with the same weight, so a class alone would lose. */
#sidebar.sidebar { background: transparent; padding-top: 48px; }
.app.sidebar-collapsed .list-head { padding-left: 32px; }
body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; height: 38px; z-index: 1; -webkit-app-region: drag; }
button, a, input, select, textarea, label, summary, [role="menuitem"], [tabindex] { -webkit-app-region: no-drag; }
`;

/** Window options and CSS for `platform`. `dark` is the system's current theme. */
export function windowChrome(platform: NodeJS.Platform, dark: boolean): WindowChrome {
  if (platform === 'darwin') {
    return {
      options: { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar', backgroundColor: '#00000000' },
      css: MAC_CSS,
    };
  }
  // Windows and Linux keep the native frame for now; only the background follows the system theme.
  return { options: { backgroundColor: dark ? BG_DARK : BG_LIGHT }, css: '' };
}
