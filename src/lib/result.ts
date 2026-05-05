/**
 * Result<T, E> — explicit success/failure without throwing.
 *
 * Why not exceptions?
 *  - Adapter normalization can fail in expected ways (unsupported message type,
 *    missing field). Throwing for those bloats stack traces and forces try/catch
 *    at every call site.
 *  - Result types compose better with TypeScript's exhaustive checking.
 *
 * Usage:
 *   const r = adapter.normalize(payload);
 *   if (!r.ok) return reply.code(422).send({ error: r.error.message });
 *   const message = r.value;
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/**
 * Wrap a thrown value (for boundaries with libraries that still throw).
 */
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
