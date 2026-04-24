import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("SwitzerlandScraper", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it("has correct country and source", async () => {
    const { SwitzerlandScraper } = await import("./switzerland");
    const s = new SwitzerlandScraper();
    expect(s.country).toBe("CH");
    expect(s.source).toBe("fuelo_ch");
  });

  it("delegates to fetchFueloCountry", async () => {
    const mockFn = vi.fn().mockResolvedValue({ stations: [], prices: [] });
    vi.doMock("./fuelo", () => ({ fetchFueloCountry: mockFn }));
    const { SwitzerlandScraper } = await import("./switzerland");
    const s = new SwitzerlandScraper();
    await s.fetch();
    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockFn.mock.calls[0][0].subdomain).toBe("ch");
    expect(mockFn.mock.calls[0][0].currency).toBe("CHF");
  });
});
