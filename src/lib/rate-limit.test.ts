import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// rateLimit/clientIp keep module-level state (the buckets Map). We reset modules
// before each test and import fresh inside each test so buckets start empty and
// tests are order-independent. Timers are faked so window-reset behaviour is
// deterministic.
describe("rate-limit", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("rateLimit", () => {
    it("allows under-limit requests with decreasing remaining", async () => {
      const { rateLimit } = await import("./rate-limit");

      const r1 = rateLimit("k", 3, 60_000);
      expect(r1.ok).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = rateLimit("k", 3, 60_000);
      expect(r2.ok).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = rateLimit("k", 3, 60_000);
      expect(r3.ok).toBe(true);
      expect(r3.remaining).toBe(0);
    });

    it("allows exactly the Nth request and blocks the (N+1)th (count >= limit)", async () => {
      const { rateLimit } = await import("./rate-limit");
      const limit = 5;

      // The first `limit` requests are allowed.
      for (let i = 0; i < limit; i++) {
        const r = rateLimit("boundary", limit, 60_000);
        expect(r.ok).toBe(true);
      }

      // The (limit + 1)th request is blocked — verifies `count >= limit`, not
      // an off-by-one that would allow limit+1.
      const over = rateLimit("boundary", limit, 60_000);
      expect(over.ok).toBe(false);
      expect(over.remaining).toBe(0);
    });

    it("resets the budget after the window elapses (now >= resetAt)", async () => {
      const { rateLimit } = await import("./rate-limit");
      const windowMs = 60_000;

      // Exhaust the budget.
      const first = rateLimit("reset", 2, windowMs);
      expect(first.ok).toBe(true);
      expect(rateLimit("reset", 2, windowMs).ok).toBe(true);
      expect(rateLimit("reset", 2, windowMs).ok).toBe(false);

      // Advancing to exactly resetAt (now >= resetAt) frees a fresh full budget.
      vi.setSystemTime(first.resetAt);
      const afterReset = rateLimit("reset", 2, windowMs);
      expect(afterReset.ok).toBe(true);
      expect(afterReset.remaining).toBe(1); // full budget minus this request
    });

    it("does not reset one millisecond before the window boundary", async () => {
      const { rateLimit } = await import("./rate-limit");
      const windowMs = 60_000;

      const first = rateLimit("edge", 1, windowMs);
      expect(first.ok).toBe(true);
      expect(rateLimit("edge", 1, windowMs).ok).toBe(false);

      // One ms before resetAt: still blocked.
      vi.setSystemTime(first.resetAt - 1);
      expect(rateLimit("edge", 1, windowMs).ok).toBe(false);

      // At resetAt: allowed again.
      vi.setSystemTime(first.resetAt);
      expect(rateLimit("edge", 1, windowMs).ok).toBe(true);
    });

    it("isolates buckets by key", async () => {
      const { rateLimit } = await import("./rate-limit");
      expect(rateLimit("a", 1, 60_000).ok).toBe(true);
      expect(rateLimit("a", 1, 60_000).ok).toBe(false);
      // A different key has its own budget.
      expect(rateLimit("b", 1, 60_000).ok).toBe(true);
    });
  });

  describe("clientIp", () => {
    it("parses the first value of x-forwarded-for", async () => {
      const { clientIp } = await import("./rate-limit");
      const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
      expect(clientIp(headers)).toBe("1.2.3.4");
    });

    it("trims whitespace around the first x-forwarded-for value", async () => {
      const { clientIp } = await import("./rate-limit");
      const headers = new Headers({ "x-forwarded-for": "  9.9.9.9  , 5.6.7.8" });
      expect(clientIp(headers)).toBe("9.9.9.9");
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
      const { clientIp } = await import("./rate-limit");
      const headers = new Headers({ "x-real-ip": "  4.3.2.1 " });
      expect(clientIp(headers)).toBe("4.3.2.1");
    });

    it("prefers x-forwarded-for over x-real-ip when both present", async () => {
      const { clientIp } = await import("./rate-limit");
      const headers = new Headers({
        "x-forwarded-for": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
      });
      expect(clientIp(headers)).toBe("1.1.1.1");
    });

    it('falls back to "unknown" when no proxy headers are present', async () => {
      const { clientIp } = await import("./rate-limit");
      const headers = new Headers();
      expect(clientIp(headers)).toBe("unknown");
    });
  });
});
