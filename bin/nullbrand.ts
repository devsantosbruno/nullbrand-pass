#!/usr/bin/env node
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 14)) {
  console.error(`nullbrand requires Node.js 22.14 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
const { main, reportOutputError } = await import('../src/cli.js');
const { guardStdio } = await import('../src/stdio.js');
guardStdio(process, {
  exit: () => process.exit(),
  fail: () => { process.exitCode = 1; },
  report: reportOutputError,
});
await main();
