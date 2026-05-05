/**
 * Tiny re-export so the rest of the code doesn't reach into Fastify directly.
 * Fastify already wires pino for us — see server.ts.
 */
export type { FastifyBaseLogger as Logger } from "fastify";
