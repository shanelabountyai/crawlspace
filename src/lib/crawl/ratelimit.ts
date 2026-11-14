export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Serialises request starts per host so two starts to the same host are never closer than `intervalMs`. */
export class HostRateLimiter {
  private readonly next = new Map<string, number>();
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly intervalMs: number, private readonly clock: Clock = realClock) {}

  acquire(host: string): Promise<void> {
    const key = host.toLowerCase();
    const prev = this.chains.get(key) ?? Promise.resolve();
    const turn = prev.then(async () => {
      // Loop: timers can fire a millisecond early, and "never closer than the interval" must hold exactly.
      for (let wait = (this.next.get(key) ?? 0) - this.clock.now(); wait > 0; wait = (this.next.get(key) ?? 0) - this.clock.now()) {
        await this.clock.sleep(wait);
      }
      this.next.set(key, this.clock.now() + this.intervalMs);
    });
    this.chains.set(key, turn.catch(() => undefined));
    return turn;
  }
}
