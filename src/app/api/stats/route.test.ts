import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { headers?: Record<string, string>; status?: number }) => ({
      data,
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
    }),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/config", () => ({
  getConfig: vi.fn().mockReturnValue({
    defaultCountry: "ES",
    enabledCountries: ["ES", "DE"],
    defaultFuel: "B7",
    center: [-3.7, 40.4],
    zoom: 6,
  }),
  COUNTRIES: {
    ES: { code: "ES", name: "España", center: [-3.7, 40.4], zoom: 6 },
    DE: { code: "DE", name: "Deutschland", center: [10.45, 51.16], zoom: 6 },
  } as Record<string, { code: string; name: string; center: [number, number]; zoom: number }>,
}));

describe("stats API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns stats with totals and per-country breakdown", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { country: "ES", stations: 12000, prices: 180000, last_update: new Date("2026-04-20T10:00:00Z") },
      { country: "DE", stations: 15000, prices: 225000, last_update: new Date("2026-04-20T09:00:00Z") },
    ]);

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.status).toBe(200);
    expect(response.data.totals.stations).toBe(27000);
    expect(response.data.totals.prices).toBe(405000);
    expect(response.data.countries).toHaveLength(2);
    expect(response.data.countries[0].code).toBe("ES");
    expect(response.data.countries[0].name).toBe("España");
    expect(response.data.countries[0].stations).toBe(12000);
    expect(response.data.countries[0].lastUpdate).toBe("2026-04-20T10:00:00.000Z");
  });

  it("includes config in response", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.data.config.defaultCountry).toBe("ES");
    expect(response.data.config.enabledCountries).toEqual(["ES", "DE"]);
    expect(response.data.config.defaultFuel).toBe("B7");
    expect(response.data.config.center).toEqual([-3.7, 40.4]);
    expect(response.data.config.zoom).toBe(6);
  });

  it("sets cache-control header", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.headers["Cache-Control"]).toBe("public, s-maxage=300, stale-while-revalidate=600");
  });

  it("handles null last_update", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { country: "ES", stations: 100, prices: 0, last_update: null },
    ]);

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.data.countries[0].lastUpdate).toBeNull();
  });

  it("falls back to country code when not in COUNTRIES map", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { country: "XX", stations: 50, prices: 100, last_update: null },
    ]);

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.data.countries[0].code).toBe("XX");
    expect(response.data.countries[0].name).toBe("XX");
  });

  it("returns 500 when database fails", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(new Error("DB error"));

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.status).toBe(500);
    expect(response.data.error).toBe("Internal server error");
  });

  it("returns zero totals when no countries exist", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.data.totals.stations).toBe(0);
    expect(response.data.totals.prices).toBe(0);
    expect(response.data.countries).toHaveLength(0);
  });
});
