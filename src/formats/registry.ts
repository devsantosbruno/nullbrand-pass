import { jsonNested } from './json-nested.js';
import type { ImportAdapter } from './types.js';

/** Every known import layout. To add one, write an adapter and list it here. */
export const ADAPTERS: readonly ImportAdapter[] = [jsonNested];
