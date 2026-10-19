// The adapters, in one place. Adding a layout means writing an adapter and listing it here.
import { jsonNested } from './json-nested.js';
import type { ImportAdapter } from './types.js';

export const ADAPTERS: readonly ImportAdapter[] = [jsonNested];
