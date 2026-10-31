const WINDOW_MS = 15 * 60_000;
/** Wrong passwords allowed per account from one address in the window. */
const PER_ACCOUNT = 10;
/** Wrong passwords allowed from one address across all accounts (stops password spraying). */
const PER_ADDRESS = 50;

/**
 * Counts failed logins only, so a whole hospital signing in from one shared
 * network address never locks itself out; repeated wrong passwords do.
 */
export class LoginGuard {
  private failures = new Map<string, { count: number; resetAt: number }>();

  private hits(key: string, now: number) {
    const f = this.failures.get(key);
    return f && f.resetAt > now ? f.count : 0;
  }

  /** Minutes until the caller may try again, or 0 if allowed. */
  blockedFor(ip: string, email: string, now = Date.now()): number {
    const keys = [`${ip}|${email.toLowerCase()}`, ip];
    const limits = [PER_ACCOUNT, PER_ADDRESS];
    let wait = 0;
    keys.forEach((k, i) => {
      if (this.hits(k, now) >= limits[i]) wait = Math.max(wait, this.failures.get(k)!.resetAt - now);
    });
    return Math.ceil(wait / 60_000);
  }

  recordFailure(ip: string, email: string, now = Date.now()) {
    for (const k of [`${ip}|${email.toLowerCase()}`, ip]) {
      const count = this.hits(k, now);
      this.failures.set(k, { count: count + 1, resetAt: count ? this.failures.get(k)!.resetAt : now + WINDOW_MS });
    }
    if (this.failures.size > 10_000) {
      for (const [k, f] of this.failures) if (f.resetAt <= now) this.failures.delete(k);
    }
  }

  recordSuccess(ip: string, email: string) {
    this.failures.delete(`${ip}|${email.toLowerCase()}`);
  }
}
