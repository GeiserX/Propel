import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("LithuaniaScraper", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it("has correct country and source", async () => {
    const { LithuaniaScraper } = await import("./lithuania");
    const s = new LithuaniaScraper();
    expect(s.country).toBe("LT");
    expect(s.source).toBe("fuelo_lt");
  });

  it("delegates to fetchFueloCountry", async () => {
    const mockFn = vi.fn().mockResolvedValue({ stations: [], prices: [] });
    vi.doMock("./fuelo", () => ({ fetchFueloCountry: mockFn }));
    const { LithuaniaScraper } = await import("./lithuania");
    const s = new LithuaniaScraper();
    await s.fetch();
    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockFn.mock.calls[0][0].subdomain).toBe("lt");
    expect(mockFn.mock.calls[0][0].currency).toBe("EUR");
  });
});
