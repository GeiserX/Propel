import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("SlovakiaScraper", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it("has correct country and source", async () => {
    const { SlovakiaScraper } = await import("./slovakia");
    const s = new SlovakiaScraper();
    expect(s.country).toBe("SK");
    expect(s.source).toBe("fuelo_sk");
  });

  it("delegates to fetchFueloCountry", async () => {
    const mockFn = vi.fn().mockResolvedValue({ stations: [], prices: [] });
    vi.doMock("./fuelo", () => ({ fetchFueloCountry: mockFn }));
    const { SlovakiaScraper } = await import("./slovakia");
    const s = new SlovakiaScraper();
    await s.fetch();
    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockFn.mock.calls[0][0].subdomain).toBe("sk");
    expect(mockFn.mock.calls[0][0].currency).toBe("EUR");
  });
});
