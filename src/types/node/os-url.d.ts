// Hand-written typings for the subset of node:os and node:url nullbrand uses, so the project needs no @types/node.
declare module "node:os" {
  function homedir(): string;
}

declare module "node:url" {
  function fileURLToPath(url: string | URL): string;
}
