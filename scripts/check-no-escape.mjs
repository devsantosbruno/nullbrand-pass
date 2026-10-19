// Guard against type-system escape hatches. Plain Node + the TypeScript parser (the project's only devDependency).
// Parsing real syntax (not grepping text) is what keeps comments and strings from causing false positives.
//
//   node scripts/check-no-escape.mjs [dir ...]     (default dirs: src bin test)
//
// Fails (exit 1) on, in every .ts / .d.ts file:
//   - the `any` type                             - `as X` / <X>x assertions (only `as const` is allowed)
//   - non-null assertions (x!, x!.y, x![0])      - `@ts-` anywhere (also in comments: ignore / expect-error / nocheck)
//   - the types `Function`, `Object` and `{}`    - JSON.parse(...) / .json() whose result is not assigned to a variable
//                                                  annotated `: unknown`
// and, only under src/web/ (the browser code; S1/S2 of the front-end spec):
//   - innerHTML / outerHTML / insertAdjacentHTML / document.write / document.writeln   (user data must only reach textContent)
//   - eval / new Function / Function(...) / a string passed to setTimeout or setInterval  (the CSP has no 'unsafe-eval')
//   - setAttribute('style', ...) and .style.cssText / cssText:                           (the CSP has no inline styles)
// and, project-wide:
//   - any .js / .mjs / .cjs file under src/
//   - any package in `dependencies` (or optional/peer), or in `devDependencies` other than `typescript`.
// It also lists every use of the `unknown` type (file:line) for review.
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TS_FILE = /\.(ts|mts|cts)$/;
const JS_FILE = /\.(js|mjs|cjs)$/;

const WEB_FILE = /^src[\\/]web[\\/]/;
const HTML_SINKS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML']);
// The name of a property access / property assignment / element access with a string literal (`a.b`, `{ b: 1 }`, `a['b']`).
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}
const isIdent = (node, name) => ts.isIdentifier(node) && node.text === name;

const line = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function isConstAssertion(node) {
  const type = node.type;
  return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'const' && !type.typeArguments;
}

// `JSON.parse(x)` or `<expr>.json()` must be the initializer of `const|let name: unknown = [await] ...`.
function isBoundaryCall(node) {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const isParse = ts.isIdentifier(callee.expression) && callee.expression.text === 'JSON' && callee.name.text === 'parse';
  const isJson = callee.name.text === 'json' && node.arguments.length === 0;
  if (!isParse && !isJson) return null;
  return isParse ? 'JSON.parse' : '.json()';
}

function assignedToUnknown(node) {
  let parent = node.parent;
  while (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return ts.isVariableDeclaration(parent) && parent.type !== undefined && parent.type.kind === ts.SyntaxKind.UnknownKeyword;
}

/** Checks one TypeScript source. Returns { violations, unknowns }. */
export function checkSource(fileName, text) {
  const violations = [];
  const unknowns = [];
  const isDeclarationFile = fileName.endsWith('.d.ts');
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const add = (node, rule, message) => violations.push({ file: fileName, line: line(sf, node), rule, message });
  const isWeb = WEB_FILE.test(fileName);

  function checkWebMember(node) {
    const name = memberName(node);
    if (name === null) return;
    if (HTML_SINKS.has(name)) add(node, 'web-html-sink', `\`${name}\`: user data must only reach the DOM through textContent / el()`);
    if (name === 'cssText') add(node, 'web-inline-style', '`cssText` (use a class, or style.setProperty)');
  }
  function checkWebCall(node) {
    const callee = node.expression;
    const first = node.arguments[0];
    if (isIdent(callee, 'eval') || isIdent(callee, 'Function')) add(node, 'web-eval', `\`${callee.text}(...)\` (the CSP has no unsafe-eval)`);
    if ((isIdent(callee, 'setTimeout') || isIdent(callee, 'setInterval')) && first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))) {
      add(node, 'web-eval', `\`${callee.text}\` with a string (that is eval)`);
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      if (isIdent(callee.expression, 'document') && (method === 'write' || method === 'writeln')) add(node, 'web-html-sink', `\`document.${method}\``);
      if (method === 'setAttribute' && first && ts.isStringLiteralLike(first) && first.text.toLowerCase() === 'style') add(node, 'web-inline-style', "`setAttribute('style', ...)` (the CSP has no inline styles)");
    }
  }

  // `@ts-` is searched in the raw text on purpose: the directives live in comments.
  text.split('\n').forEach((content, i) => {
    if (content.includes('@ts-')) violations.push({ file: fileName, line: i + 1, rule: 'ts-directive', message: 'a "@ts-" directive' });
  });

  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.AnyKeyword:
        add(node, 'no-any', 'the type `any`');
        break;
      case ts.SyntaxKind.UnknownKeyword:
        unknowns.push({ file: fileName, line: line(sf, node), text: text.split('\n')[line(sf, node) - 1].trim() });
        break;
      case ts.SyntaxKind.AsExpression:
        if (!isConstAssertion(node)) add(node, 'no-assertion', 'a type assertion (`as X`); only `as const` is allowed');
        break;
      case ts.SyntaxKind.TypeAssertionExpression:
        add(node, 'no-assertion', 'a type assertion (`<X>value`)');
        break;
      case ts.SyntaxKind.NonNullExpression:
        add(node, 'no-non-null', 'a non-null assertion (`!`)');
        break;
      case ts.SyntaxKind.TypeLiteral:
        if (node.members.length === 0) add(node, 'no-banned-type', 'the type `{}`');
        break;
      case ts.SyntaxKind.TypeReference:
        if (ts.isIdentifier(node.typeName) && (node.typeName.text === 'Function' || node.typeName.text === 'Object')) {
          add(node, 'no-banned-type', `the type \`${node.typeName.text}\``);
        }
        break;
      case ts.SyntaxKind.CallExpression: {
        const kind = isDeclarationFile ? null : isBoundaryCall(node);
        if (kind && !assignedToUnknown(node)) {
          add(node, 'json-unknown', `${kind} must be assigned right away to a variable annotated \`: unknown\``);
        }
        if (isWeb) checkWebCall(node);
        break;
      }
      case ts.SyntaxKind.NewExpression:
        if (isWeb && isIdent(node.expression, 'Function')) add(node, 'web-eval', '`new Function(...)` (the CSP has no unsafe-eval)');
        break;
      case ts.SyntaxKind.PropertyAccessExpression:
      case ts.SyntaxKind.ElementAccessExpression:
      case ts.SyntaxKind.PropertyAssignment:
      case ts.SyntaxKind.ShorthandPropertyAssignment:
        if (isWeb) checkWebMember(node);
        break;
      default:
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { violations, unknowns };
}

/** Checks the parsed package.json. Returns violations. */
export function checkPackageJson(pkg, file = 'package.json') {
  const violations = [];
  const names = (field) => Object.keys(pkg[field] ?? {});
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of names(field)) violations.push({ file, line: 0, rule: 'dependencies', message: `${field} must be empty (found "${name}")` });
  }
  for (const name of names('devDependencies')) {
    if (name !== 'typescript') violations.push({ file, line: 0, rule: 'dependencies', message: `devDependencies may only hold "typescript" (found "${name}")` });
  }
  return violations;
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Runs every check over a project root. */
export function checkProject(root, { dirs = ['src', 'bin', 'test'] } = {}) {
  const violations = [];
  const unknowns = [];
  for (const dir of dirs) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file);
      if (TS_FILE.test(file)) {
        const result = checkSource(rel, readFileSync(file, 'utf8'));
        violations.push(...result.violations);
        unknowns.push(...result.unknowns);
      } else if (dir === 'src' && JS_FILE.test(file)) {
        violations.push({ file: rel, line: 0, rule: 'js-in-src', message: `${extname(file)} file in src/` });
      }
    }
  }
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    violations.push(...checkPackageJson(pkg));
  }
  return { violations, unknowns };
}

function main() {
  const args = process.argv.slice(2);
  const dirs = args.filter((a) => !a.startsWith('--'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { violations, unknowns } = checkProject(root, dirs.length ? { dirs } : {});

  console.log(`unknown uses (review): ${unknowns.length}`);
  for (const u of unknowns) console.log(`  ${u.file}:${u.line}  ${u.text}`);
  if (violations.length > 0) {
    console.error(`\ncheck-no-escape: ${violations.length} violation(s)`);
    for (const v of violations) console.error(`  ${v.file}${v.line ? ':' + v.line : ''}  [${v.rule}] ${v.message}`);
    process.exit(1);
  }
  console.log('\ncheck-no-escape: OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
