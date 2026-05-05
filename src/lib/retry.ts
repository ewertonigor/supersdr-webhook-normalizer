/**
 * Compute the delay before the next retry, in milliseconds.
 *
 * Pattern: full-jitter exponential backoff
 *   base * 2^attempt, capped, with random jitter to spread thundering herds.
 *
 * `attempt` is 0-indexed (0 = first retry).
 */
export function backoffDelayMs(args: {
  attempt: number;
  baseMs?: number;
  capMs?: number;
}): number {
  const base = args.baseMs ?? 1000;
  const cap = args.capMs ?? 30_000;
  const exp = Math.min(cap, base * 2 ** args.attempt);
  return Math.floor(Math.random() * exp);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
