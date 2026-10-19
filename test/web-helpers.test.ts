// The DOM-free helpers of the web UI. The expected values are what the app produced before they were extracted (the three copies of
// the scheme regex were merged into normalizeUrl), so a change in behavior shows up here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostOf, isHttpUrl, normalizeUrl, siteDomain } from '../src/web/ui/url.js';
import { levelOf, strength, strengthLevel } from '../src/web/ui/strength.js';
import { withBusy } from '../src/web/ui/busy.js';
import type { BusyButton } from '../src/web/ui/busy.js';

test('url: normalizeUrl adds https:// only when there is no scheme', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('http://a.b:8080/x'), 'http://a.b:8080/x');
  assert.equal(normalizeUrl('HTTPS://Example.COM/'), 'HTTPS://Example.COM/');
  assert.equal(normalizeUrl('ftp://x'), 'ftp://x');
});

test('url: hostOf / siteDomain keep the outputs the app had', () => {
  const cases: readonly (readonly [input: string, host: string, domain: string])[] = [
    ['example.com', 'example.com', 'example.com'],
    ['www.example.com/x', 'example.com', 'www.example.com'], // hostOf drops "www.", siteDomain keeps the host as it is
    ['http://a.b:8080/x', 'a.b', 'a.b:8080'], // siteDomain keeps the port
    ['ftp://x', 'x', 'x'],
    ['http://[::1]:3000/', '[::1]', '[::1]:3000'],
    ['file:///etc/passwd', '', ''],
    ['not a url', 'not a url', 'not a url'], // does not parse: the input itself comes back
    ['javascript:alert(1)', 'javascript:alert(1)', 'javascript:alert(1)'],
  ];
  for (const [input, host, domain] of cases) {
    assert.equal(hostOf(input), host, `hostOf(${input})`);
    assert.equal(siteDomain(input), domain, `siteDomain(${input})`);
  }
});

test('url: only http(s) becomes a link; the link never carries another scheme', () => {
  for (const ok of ['example.com', 'http://a.b', 'HTTPS://a.b', 'a.b:8080/x']) assert.equal(isHttpUrl(ok), true, ok);
  for (const no of ['ftp://x', 'file:///etc/passwd', 'ssh://host', 'chrome://settings']) assert.equal(isHttpUrl(no), false, no);
  // A scheme without "//" is not a scheme to normalizeUrl: it becomes an https URL whose "host" is the word, which the browser
  // never runs as script. What must hold is that no produced href starts with javascript: / data:.
  for (const risky of ['javascript:alert(1)', 'data:text/html,<b>', 'vbscript:x']) {
    assert.doesNotMatch(normalizeUrl(risky), /^(javascript|data|vbscript):/i, risky);
  }
});

test('strength: thresholds of the meters (28 / 40 / 70 bits)', () => {
  assert.equal(strength(''), 0);
  assert.deepEqual(strengthLevel(''), { bits: 0, level: 'weak', active: 1 });
  assert.equal(strengthLevel('abc').level, 'weak');
  assert.equal(strengthLevel('Tr0ub4dor&3-xkcd-battery').level, 'strong');
  assert.equal(strengthLevel('Tr0ub4dor&3-xkcd-battery').active, 4);
  // Every bits value maps to exactly the (level, active) pair the 4-segment bar had.
  const edges: readonly (readonly [bits: number, level: string, active: number])[] = [[0, 'weak', 1], [27, 'weak', 1], [28, 'weak', 2], [39, 'weak', 2], [40, 'medium', 3], [69, 'medium', 3], [70, 'strong', 4], [200, 'strong', 4]];
  for (const [bits, level, active] of edges) assert.deepEqual(levelOf(bits), { level, active }, `${bits} bits`);
});

// A button that records every change, so the ORDER of what withBusy does is part of the test.
function fakeButton(): { btn: BusyButton; events: string[] } {
  const events: string[] = [];
  let disabled = false;
  let text: string | null = 'idle';
  const btn: BusyButton = {
    get disabled() { return disabled; },
    set disabled(v: boolean) { disabled = v; events.push(`disabled=${v}`); },
    get textContent() { return text; },
    set textContent(v: string | null) { text = v; events.push(`text=${v}`); },
  };
  return { btn, events };
}

test('withBusy: disabled + busy label while the work runs, restored after, result passed through', async () => {
  const { btn, events } = fakeButton();
  const result = await withBusy(btn, 'Working…', 'Go', async () => {
    events.push('work');
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(events, ['disabled=true', 'text=Working…', 'work', 'disabled=false', 'text=Go']);
});

test('withBusy: does not swallow errors, and restores the button before the caller sees them', async () => {
  const { btn, events } = fakeButton();
  await assert.rejects(withBusy(btn, 'Working…', 'Go', async () => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(events, ['disabled=true', 'text=Working…', 'disabled=false', 'text=Go']);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Go');
});

test('withBusy: an idle label given as a function is read when the work is over (the language may change meanwhile)', async () => {
  const { btn } = fakeButton();
  let label = 'Create';
  await withBusy(btn, 'Creating…', () => label, async () => { label = 'Criar'; });
  assert.equal(btn.textContent, 'Criar');
});

test('masked inputs: the HTML only says type="text" data-masked; the autofill attributes come from one place (S6)', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const inputs = [...html.matchAll(/<input\b[^>]*\bdata-masked\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(inputs.length >= 12, `masked inputs found: ${inputs.length}`);
  for (const tag of inputs) {
    assert.match(tag, /\btype="text"/, `a masked input is never type=password in the markup: ${tag}`);
    assert.match(tag, /\bautocomplete="off"/, tag);
    assert.doesNotMatch(tag, /autocapitalize|autocorrect|spellcheck|data-lpignore|data-1p-ignore|data-bwignore|data-form-type/, `${tag} repeats attributes that secretInputAttrs sets`);
  }
  // The single place that sets them has all of them.
  const js = readFileSync(new URL('../public/ui/secret-input.js', import.meta.url), 'utf8');
  for (const name of ['autocapitalize', 'autocorrect', 'spellcheck', 'autocomplete', 'data-lpignore', 'data-1p-ignore', 'data-bwignore', 'data-form-type']) {
    assert.ok(js.includes(name), `secret-input.js sets ${name}`);
  }
  // ...and app.js runs it before anything else of its own.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const firstStatement = app.split('\n').find((l) => l.trim() !== '' && !l.startsWith('import ') && !l.startsWith('//'));
  assert.equal(firstStatement, 'applySecretInputs(document);');
});
