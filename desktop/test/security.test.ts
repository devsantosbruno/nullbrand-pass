import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appOrigin, isAllowedRequest, isAppUrl, isExternalLinkAllowed, menuTemplate, newDesktopSecret, webPreferences, withDesktopSecret } from '../security.js';

const origin = appOrigin(51234);

test('appOrigin is loopback http on the given port', () => {
  assert.equal(origin, 'http://127.0.0.1:51234');
});

test('isAppUrl accepts only the exact origin', () => {
  assert.ok(isAppUrl(origin, 'http://127.0.0.1:51234/'));
  assert.ok(isAppUrl(origin, 'http://127.0.0.1:51234/api/status?x=1'));
  for (const url of [
    'http://127.0.0.1:51235/',
    'https://127.0.0.1:51234/',
    'http://localhost:51234/',
    'http://127.0.0.1:51234.evil.example/',
    'http://127.0.0.1:51234@evil.example/',
    'https://example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    '',
    'not a url',
  ]) {
    assert.equal(isAppUrl(origin, url), false, url);
  }
});

test('isAllowedRequest adds data: images and nothing else', () => {
  assert.ok(isAllowedRequest(origin, 'http://127.0.0.1:51234/app.js'));
  assert.ok(isAllowedRequest(origin, 'data:image/svg+xml;base64,AAAA'));
  for (const url of ['https://example.com/x.png', 'ws://127.0.0.1:51234/', 'file:///tmp/x', 'ftp://example.com/', 'http://127.0.0.1:1/', '']) {
    assert.equal(isAllowedRequest(origin, url), false, url);
  }
});

test('the renderer has no Node, is sandboxed and isolated, and cannot embed or spellcheck', () => {
  const prefs = webPreferences('/app/preload.cjs', false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.nodeIntegrationInWorker, false);
  assert.equal(prefs.nodeIntegrationInSubFrames, false);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal(prefs.spellcheck, false);
  assert.equal(prefs.devTools, false);
  assert.equal(prefs.preload, '/app/preload.cjs');
});

test('the session partition is in memory', () => {
  const partition = webPreferences('', false).partition;
  assert.equal(typeof partition, 'string');
  assert.ok(partition && !partition.startsWith('persist:'));
});

test('the menu has no reload or developer-tools entry, and keeps the edit commands', () => {
  for (const platform of ['darwin', 'win32', 'linux'] satisfies NodeJS.Platform[]) {
    const text = JSON.stringify(menuTemplate(platform, 'nullbrand'));
    assert.doesNotMatch(text, /reload|forceReload|toggleDevTools/i, platform);
    for (const role of ['copy', 'paste', 'quit']) assert.ok(text.includes(`"${role}"`), `${platform} lacks ${role}`);
  }
});

test('only the project site may be opened in the system browser', () => {
  assert.ok(isExternalLinkAllowed('https://nullbrand.dev/#contact'));
  assert.ok(isExternalLinkAllowed('https://nullbrand.dev/'));
  for (const url of [
    'http://nullbrand.dev/#contact',
    'https://pass.nullbrand.dev/',
    'https://nullbrand.dev.evil.example/',
    'https://nullbrand.dev@evil.example/',
    'https://user:pw@nullbrand.dev/',
    'https://nullbrand.dev:8443/',
    'https://evil.example/?u=https://nullbrand.dev',
    'file:///etc/passwd',
    'javascript:alert(1)',
    '',
  ]) {
    assert.equal(isExternalLinkAllowed(url), false, url);
  }
});

test('newDesktopSecret is 256 bits of fresh randomness', () => {
  const a = newDesktopSecret();
  assert.match(a, /^[\w-]{43}$/);
  assert.notEqual(a, newDesktopSecret());
});

test('the launch secret is added only to requests to the app origin', () => {
  const add = (url: string, headers: Record<string, string> = {}) => withDesktopSecret(origin, url, headers, 'x-nullbrand-desktop', 'S3CRET');
  assert.deepEqual(add('http://127.0.0.1:51234/api/status', { Accept: '*/*' }), { Accept: '*/*', 'x-nullbrand-desktop': 'S3CRET' });
  for (const url of ['https://example.com/', 'http://127.0.0.1:51235/', 'http://localhost:51234/', 'http://127.0.0.1:51234@evil.example/', 'not a url']) {
    assert.deepEqual(add(url, { Accept: '*/*' }), { Accept: '*/*' }, url);
  }
});

test('a header the page set under the secret name is replaced or dropped, never forwarded', () => {
  const spoofed = { 'X-Nullbrand-Desktop': 'guess', Accept: '*/*' };
  assert.deepEqual(withDesktopSecret(origin, 'http://127.0.0.1:51234/', spoofed, 'x-nullbrand-desktop', 'S3CRET'), {
    Accept: '*/*',
    'x-nullbrand-desktop': 'S3CRET',
  });
  assert.deepEqual(withDesktopSecret(origin, 'https://example.com/', spoofed, 'x-nullbrand-desktop', 'S3CRET'), { Accept: '*/*' });
});
