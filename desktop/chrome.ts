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

// macOS: no native title bar. A strip of the page's own background sits above the layout and holds the traffic lights,
// so nothing overlaps the UI. Chromium treats `-webkit-app-region: drag` as the area that moves the window.
const MAC_CSS = `
html, body { overflow: hidden; }
body { box-sizing: border-box; padding-top: 38px; }
/* Injected before the page's sheets, so a bare .app would lose to the page's own height; the narrow layout (<=900px) lets .app grow, so it stays out. */
@media (min-width: 901px) { html body .app { height: calc(100vh / var(--z) - 38px); } }
body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; height: 38px; z-index: 1000; background: var(--bg); -webkit-app-region: drag; }
`;

/** Window options and CSS for `platform`. `dark` is the system's current theme. */
export function windowChrome(platform: NodeJS.Platform, dark: boolean): WindowChrome {
  if (platform === 'darwin') {
    return {
      options: { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 12 }, backgroundColor: dark ? BG_DARK : BG_LIGHT },
      css: MAC_CSS,
    };
  }
  // Windows and Linux keep the native frame for now; only the background follows the system theme.
  return { options: { backgroundColor: dark ? BG_DARK : BG_LIGHT }, css: '' };
}
