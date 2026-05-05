/**
 * Side-effect imports — each adapter file calls `registry.register(...)` at
 * module load. Importing this file once (in server.ts) wires everything up.
 *
 * Adding a new provider:
 *   1. Create src/providers/foo.ts implementing ProviderAdapter
 *   2. Add `import "./foo.js";` below
 *   3. Done. No other file changes.
 */
import "./meta.js";
import "./evolution.js";
import "./zapi.js";

export { registry } from "./registry.js";
export type { NormalizedMessage, ProviderAdapter } from "./types.js";
export { AdapterError } from "./types.js";
