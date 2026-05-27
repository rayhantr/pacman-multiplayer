/**
 * Server type entry point. The actual definitions live in `src/shared/types.ts`
 * (the single source of truth shared with the client); this file simply re-exports
 * them so server modules can continue importing from `./types.js`.
 */
export type * from '../shared/types.js';
