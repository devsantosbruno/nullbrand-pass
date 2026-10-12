#!/usr/bin/env node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 10)) {
  console.error(`voltrama-pass precisa do Node.js 20.10 ou mais novo (você tem ${process.versions.node}).`);
  process.exit(1);
}
const { main } = await import('../src/cli.js');
await main();
