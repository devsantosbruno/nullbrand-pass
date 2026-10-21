import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowChrome } from '../chrome.js';

test('macOS gets a title strip in the page background above the layout, with the controls on it', () => {
  const dark = windowChrome('darwin', true);
  const light = windowChrome('darwin', false);
  assert.equal(dark.options.titleBarStyle, 'hiddenInset');
  assert.equal(dark.options.vibrancy, undefined);
  assert.notEqual(dark.options.backgroundColor, light.options.backgroundColor);
  assert.match(dark.css, /body \{ box-sizing: border-box; padding-top: 38px/);
  assert.match(dark.css, /background: var\(--bg\); -webkit-app-region: drag/);
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
