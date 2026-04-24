import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("EstoniaScraper", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it("has correct country and source", async () => {
    const { EstoniaScraper } = await import("./estonia");
    const s = new EstoniaScraper();
    expect(s.country).toBe("EE");
    expect(s.source).toBe("fuelo_ee");
  });

  it("delegates to fetchFueloCountry", async () => {
    const mockFn = vi.fn().mockResolvedValue({ stations: [], prices: [] });
    vi.doMock("./fuelo", () => ({ fetchFueloCountry: mockFn }));
    const { EstoniaScraper } = await import("./estonia");
    const s = new EstoniaScraper();
    await s.fetch();
    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockFn.mock.calls[0][0].subdomain).toBe("ee");
    expect(mockFn.mock.calls[0][0].currency).toBe("EUR");
  });
});
