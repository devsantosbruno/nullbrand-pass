import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSource, checkPackageJson, checkProject } from './check-no-escape.mjs';
import { fileURLToPath } from 'node:url';

const rules = (text, name = 'x.ts') => checkSource(name, text).violations.map((v) => v.rule);

test('code that must PASS', () => {
  const ok = [
    'export const n: number = 1;',
    'const a = [1, 2] as const;',
    'const o = { k: 1 } as const;',
    'import { a as b } from "./m.js";\nexport { b as c };',
    'import * as ns from "./m.js";\nexport * as other from "./m.js";',
    'const raw: unknown = JSON.parse("1");',
    'async function f(r: { json(): Promise<unknown> }) { const body: unknown = await r.json(); return body; }',
    'async function f(fetchIt: () => Promise<{ json(): Promise<unknown> }>) { const body: unknown = await (await fetchIt()).json(); return body; }',
    'const cond = true; const v = cond ? 1 : {};',
    'const empty = {}; function g(): void {} try { g(); } catch {}',
    'const a = 1, b = 2; if (a !== b && !(a === b)) g2(); function g2(): void {}',
    'const x = Object.keys({}); const y = Object.fromEntries([["k", 1]]);',
    'const p = Promise.all([]);',
    '// the any type, x as Foo, a!.b and JSON.parse(x) in a comment are all fine\nexport const c = 1;',
    'export const s = "any as Foo a!.b JSON.parse(x) @ts" + `${1} x as Y`;',
    'export function isFoo(v: unknown): v is { a: string } { return typeof v === "object" && v !== null; }',
    'export const z = 1 satisfies number;',
  ];
  for (const code of ok) assert.deepEqual(rules(code.replace('@ts"', '@t"')), [], code);
});

test('`any` fails in every position', () => {
  for (const code of ['let a: any;', 'function f(x: any) {}', 'const m: Map<string, any> = new Map();', 'type T = any[];', 'const f = (): any => 1;', 'type U = string | any;']) {
    assert.ok(rules(code).includes('no-any'), code);
  }
});

test('type assertions fail, `as const` does not', () => {
  assert.ok(rules('const a = x as string;').includes('no-assertion'));
  assert.ok(rules('const a = <string>x;').includes('no-assertion'));
  assert.ok(rules('const a = x as unknown as string;').includes('no-assertion'));
  assert.ok(rules('const a = x as Foo<string>;').includes('no-assertion'));
  assert.deepEqual(rules('const a = ["x"] as const;'), []);
});

test('non-null assertions fail', () => {
  for (const code of ['const a = x!.y;', 'foo(x!);', 'const a = x!;', 'const a = x![0];', 'const a = (b as {c: number})!.c;', 'const a = x!\n.y;']) {
    assert.ok(rules(code).includes('no-non-null'), code);
  }
});

test('@ts- directives fail, even inside comments', () => {
  for (const code of ['// @ts-ignore\nconst a = 1;', '/* @ts-expect-error */ const a = 1;', '// @ts-nocheck', '// @ts-check\nconst a = 1;']) {
    assert.ok(rules(code).includes('ts-directive'), code);
  }
});

test('Function, Object and {} as types fail', () => {
  for (const code of ['let f: Function;', 'let o: Object;', 'let e: {};', 'type T = Array<{}>;', 'function f(x: {}): void {}', 'const g = (cb: Function) => cb;']) {
    assert.ok(rules(code).includes('no-banned-type'), code);
  }
});

test('JSON.parse and .json() must be assigned to a variable annotated unknown', () => {
  for (const code of [
    'const a = JSON.parse("1");',
    'let a = JSON.parse("1");',
    'const a: string = JSON.parse("1");',
    'foo(JSON.parse("1"));',
    'return_(JSON.parse("1")); function return_(v: unknown) { return v; }',
    'const a = JSON.parse("1").x;',
    'async function f(r: { json(): Promise<unknown> }) { const b = await r.json(); return b; }',
    'async function f(r: { json(): Promise<unknown> }) { return r.json(); }',
    'async function f(r: { json(): Promise<unknown> }) { const b: object = await r.json(); return b; }',
    'const n = JSON.parse(await readIt()).count; declare function readIt(): Promise<string>;',
  ]) {
    assert.ok(rules(code).includes('json-unknown'), code);
  }
});

test('`unknown` uses are listed with file and line', () => {
  const { unknowns } = checkSource('a/b.ts', 'const a = 1;\nfunction f(v: unknown): void {}\nconst c: unknown = 2;\n');
  assert.deepEqual(unknowns.map((u) => [u.file, u.line]), [['a/b.ts', 2], ['a/b.ts', 3]]);
  assert.match(unknowns[0].text, /function f\(v: unknown\)/);
});

test('package.json: dependencies must be empty and devDependencies only typescript', () => {
  assert.deepEqual(checkPackageJson({ devDependencies: { typescript: '6.0.3' } }), []);
  assert.deepEqual(checkPackageJson({ dependencies: {}, devDependencies: {} }), []);
  assert.deepEqual(checkPackageJson({}), []);
  assert.equal(checkPackageJson({ dependencies: { left: '1.0.0' } }).length, 1);
  assert.equal(checkPackageJson({ optionalDependencies: { x: '1' } }).length, 1);
  assert.equal(checkPackageJson({ peerDependencies: { x: '1' } }).length, 1);
  assert.equal(checkPackageJson({ devDependencies: { typescript: '6.0.3', eslint: '9.0.0' } }).length, 1);
});

test('project: .js/.mjs/.cjs in src/ fail, other directories may keep .js', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nb-escape-'));
  try {
    await mkdir(join(root, 'src', 'deep'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { typescript: '6.0.3' } }));
    await writeFile(join(root, 'src', 'ok.ts'), 'export const a = 1;\n');
    await writeFile(join(root, 'test', 'old.test.js'), 'let x = JSON.parse("1");\n');
    let result = checkProject(root);
    assert.deepEqual(result.violations, []);
    await writeFile(join(root, 'src', 'deep', 'legacy.js'), 'export {};\n');
    await writeFile(join(root, 'src', 'm.mjs'), 'export {};\n');
    await writeFile(join(root, 'src', 'c.cjs'), 'module.exports = 1;\n');
    result = checkProject(root);
    assert.deepEqual(result.violations.map((v) => v.rule), ['js-in-src', 'js-in-src', 'js-in-src']);
    await rm(join(root, 'src', 'deep', 'legacy.js'));
    await rm(join(root, 'src', 'm.mjs'));
    await rm(join(root, 'src', 'c.cjs'));
    assert.deepEqual(checkProject(root).violations, []);
    await writeFile(join(root, 'src', 'bad.ts'), 'export const a: any = 1;\n');
    assert.deepEqual(checkProject(root).violations.map((v) => v.rule), ['no-any']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('src/web/: HTML sinks, eval and inline styles fail (and only there)', () => {
  const web = (text) => rules(text, 'src/web/features/x.ts');
  const bad = [
    ['const n = document.body; n.innerHTML = "x";', 'web-html-sink'],
    ['const s = n.outerHTML;', 'web-html-sink'],
    ['n.insertAdjacentHTML("beforeend", s);', 'web-html-sink'],
    ['const a = el("div", { innerHTML: s });', 'web-html-sink'],
    ['n["innerHTML"] = s;', 'web-html-sink'],
    ['document.write(s); document.writeln(s);', 'web-html-sink'],
    ['eval(s);', 'web-eval'],
    ['const f = new Function("return 1");', 'web-eval'],
    ['setTimeout("run()", 10); setInterval(`x${1}`, 10);', 'web-eval'],
    ['n.setAttribute("style", "color:red");', 'web-inline-style'],
    ['n.setAttribute("STYLE", "color:red");', 'web-inline-style'],
    ['n.style.cssText = "color:red";', 'web-inline-style'],
  ];
  for (const [code, rule] of bad) assert.ok(web(code).includes(rule), code);
  for (const [code] of bad) assert.deepEqual(rules(code, 'src/server.ts').filter((r) => r.startsWith('web-')), [], code);
  const good = [
    'n.textContent = s; n.style.width = "3px"; n.style.setProperty("--w", "3px");',
    'n.setAttribute("aria-label", s); n.setAttribute("role", "menu");',
    'setTimeout(() => run(), 10); setInterval(run, 10);',
    'const html = 1; const innerHTMLish = 2; const o = { textContent: s };',
  ];
  for (const code of good) assert.deepEqual(web(code), [], code);
});

test('the front-end sources pass the web rules today', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { violations } = checkProject(root, { dirs: ['src/web'] });
  assert.deepEqual(violations, []);
});
