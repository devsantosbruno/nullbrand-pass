import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowChrome } from '../chrome.js';

test('macOS gets the integrated title bar, the sidebar material and a drag area that spares the controls', () => {
  const { options, css } = windowChrome('darwin', true);
  assert.equal(options.titleBarStyle, 'hiddenInset');
  assert.equal(options.vibrancy, 'sidebar');
  assert.match(css, /#sidebar\.sidebar \{ background: transparent; padding-top: 48px/);
  assert.match(css, /-webkit-app-region: drag/);
  assert.match(css, /-webkit-app-region: no-drag/);
});

test('Windows and Linux keep the native frame and only match the system theme', () => {
  for (const platform of ['win32', 'linux'] satisfies NodeJS.Platform[]) {
    const dark = windowChrome(platform, true);
    const light = windowChrome(platform, false);
    assert.equal(dark.css, '', platform);
    assert.equal(dark.options.titleBarStyle, undefined, platform);
    assert.equal(dark.options.vibrancy, undefined, platform);
    assert.notEqual(dark.options.backgroundColor, light.options.backgroundColor, platform);
  }
});
