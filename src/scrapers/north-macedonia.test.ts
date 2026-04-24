import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("NorthMacedoniaScraper", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it("has correct country and source", async () => {
    const { NorthMacedoniaScraper } = await import("./north-macedonia");
    const s = new NorthMacedoniaScraper();
    expect(s.country).toBe("MK");
    expect(s.source).toBe("fuelo_mk");
  });

  it("delegates to fetchFueloCountry", async () => {
    const mockFn = vi.fn().mockResolvedValue({ stations: [], prices: [] });
    vi.doMock("./fuelo", () => ({ fetchFueloCountry: mockFn }));
    const { NorthMacedoniaScraper } = await import("./north-macedonia");
    const s = new NorthMacedoniaScraper();
    await s.fetch();
    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockFn.mock.calls[0][0].subdomain).toBe("mk");
    expect(mockFn.mock.calls[0][0].currency).toBe("MKD");
  });
});
