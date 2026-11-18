export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Serialises request starts per host so two starts to the same host are never closer than `intervalMs`.
 * `acquire` resolves with the granted start time; callers log that value as the request start, so the logged starts
 * are spaced by exactly the interval the limiter enforced (a separate clock read after the await can land a
 * millisecond later than the grant and make the next gap look 1 ms short — D-47).
 */
export class HostRateLimiter {
  private readonly next = new Map<string, number>();
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly intervalMs: number, private readonly clock: Clock = realClock) {}

  acquire(host: string): Promise<number> {
    const key = host.toLowerCase();
    const prev = this.chains.get(key) ?? Promise.resolve();
    const turn = prev.then(async (): Promise<number> => {
      // Loop: timers can fire a millisecond early, and "never closer than the interval" must hold exactly.
      for (let wait = (this.next.get(key) ?? 0) - this.clock.now(); wait > 0; wait = (this.next.get(key) ?? 0) - this.clock.now()) {
        await this.clock.sleep(wait);
      }
      const start = this.clock.now();
      this.next.set(key, start + this.intervalMs);
      return start;
    });
    this.chains.set(
      key,
      turn.then(
        () => undefined,
        () => undefined,
      ),
    );
    return turn;
  }
}
