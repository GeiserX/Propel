import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("BulgariaScraper", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it("has correct country and source", async () => {
    const { BulgariaScraper } = await import("./bulgaria");
    const s = new BulgariaScraper();
    expect(s.country).toBe("BG");
    expect(s.source).toBe("fuelo_bg");
  });

  it("delegates to fetchFueloCountry", async () => {
    const mockFn = vi.fn().mockResolvedValue({ stations: [], prices: [] });
    vi.doMock("./fuelo", () => ({ fetchFueloCountry: mockFn }));
    const { BulgariaScraper } = await import("./bulgaria");
    const s = new BulgariaScraper();
    await s.fetch();
    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockFn.mock.calls[0][0].subdomain).toBe("bg");
    expect(mockFn.mock.calls[0][0].currency).toBe("EUR");
  });
});
