import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("TurkeyScraper", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.unstubAllGlobals(); });

  it("has correct country and source", async () => {
    const { TurkeyScraper } = await import("./turkey");
    const s = new TurkeyScraper();
    expect(s.country).toBe("TR");
    expect(s.source).toBe("fuelo_tr");
  });

  it("delegates to fetchFueloCountry", async () => {
    const mockFn = vi.fn().mockResolvedValue({ stations: [], prices: [] });
    vi.doMock("./fuelo", () => ({ fetchFueloCountry: mockFn }));
    const { TurkeyScraper } = await import("./turkey");
    const s = new TurkeyScraper();
    await s.fetch();
    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockFn.mock.calls[0][0].subdomain).toBe("tr");
    expect(mockFn.mock.calls[0][0].currency).toBe("TRY");
  });
});
