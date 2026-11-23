import { MIN_INTERVAL_MS } from "./config";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Idle hosts are forgotten once this many are remembered, so the process-wide limiter cannot grow without bound. */
export const LIMITER_SWEEP_AT = 256;

/**
 * Serialises request starts per host so two starts to the same host are never closer than `intervalMs`.
 * `acquire` resolves with the granted start time; callers log that value as the request start, so the logged starts
 * are spaced by exactly the interval the limiter enforced (a separate clock read after the await can land a
 * millisecond later than the grant and make the next gap look 1 ms short — D-47).
 */
export class HostRateLimiter {
  private readonly next = new Map<string, number>();
  private readonly chains = new Map<string, Promise<void>>();
  /** Requests that have asked for a slot on a host and not been granted it yet. */
  private readonly waiting = new Map<string, number>();

  constructor(private readonly intervalMs: number, private readonly clock: Clock = realClock) {}

  /** Hosts with a remembered slot (tests). */
  get size(): number {
    return this.next.size;
  }

  acquire(host: string): Promise<number> {
    const key = host.toLowerCase();
    this.sweep();
    this.waiting.set(key, (this.waiting.get(key) ?? 0) + 1);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const turn = prev.then(async (): Promise<number> => {
      try {
        // Loop: timers can fire a millisecond early, and "never closer than the interval" must hold exactly.
        for (let wait = (this.next.get(key) ?? 0) - this.clock.now(); wait > 0; wait = (this.next.get(key) ?? 0) - this.clock.now()) {
          await this.clock.sleep(wait);
        }
        const start = this.clock.now();
        this.next.set(key, start + this.intervalMs);
        return start;
      } finally {
        const left = (this.waiting.get(key) ?? 1) - 1;
        if (left > 0) this.waiting.set(key, left);
        else this.waiting.delete(key);
      }
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

  /**
   * Forget hosts whose next slot has passed and that nobody is waiting on. Forgetting such a host changes nothing:
   * its next request could start at once anyway. Hosts with a slot still ahead, or a queue, are always kept.
   */
  private sweep(): void {
    if (this.next.size < LIMITER_SWEEP_AT) return;
    const now = this.clock.now();
    for (const [key, at] of this.next) {
      if (at <= now && !this.waiting.has(key)) {
        this.next.delete(key);
        this.chains.delete(key);
      }
    }
  }
}

const SHARED = Symbol.for("crawlspace.hostRateLimiter");
type SharedHolder = { [SHARED]?: HostRateLimiter };

/**
 * The one limiter every scan in this process shares, so two scans of the same host still keep 1 request/second
 * between them (PRD-02 requirement 3; review 2026-11-20, CQ-8). In memory, one process (D-29). Kept on `globalThis`
 * like the scan service, so separately bundled copies of this module still share it.
 */
export function sharedHostRateLimiter(): HostRateLimiter {
  const g = globalThis as SharedHolder;
  g[SHARED] ??= new HostRateLimiter(MIN_INTERVAL_MS, realClock);
  return g[SHARED];
}
