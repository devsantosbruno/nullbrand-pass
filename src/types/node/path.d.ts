// Hand-written typings for the subset of node:path nullbrand uses, so the project needs no @types/node.
declare module "node:path" {
  function join(...paths: string[]): string;
  function resolve(...paths: string[]): string;
  function normalize(path: string): string;
  function dirname(path: string): string;
  function basename(path: string, suffix?: string): string;
  function extname(path: string): string;
  const delimiter: ";" | ":";
}
