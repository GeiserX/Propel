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

describe("config API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns config with enabled countries", async () => {
    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.status).toBe(200);
    expect(response.data.defaultCountry).toBe("ES");
    expect(response.data.defaultFuel).toBe("B7");
    expect(response.data.center).toEqual([-3.7, 40.4]);
    expect(response.data.zoom).toBe(6);
    expect(response.data.enabledCountries).toHaveLength(2);
    expect(response.data.enabledCountries[0]).toEqual({
      code: "ES",
      name: "España",
      center: [-3.7, 40.4],
      zoom: 6,
    });
    expect(response.data.enabledCountries[1]).toEqual({
      code: "DE",
      name: "Deutschland",
      center: [10.45, 51.16],
      zoom: 6,
    });
  });

  it("sets cache-control header", async () => {
    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.headers["Cache-Control"]).toBe(
      "public, s-maxage=3600, stale-while-revalidate=7200",
    );
  });

  it("falls back to code when country not in COUNTRIES map", async () => {
    const { getConfig } = await import("@/lib/config");
    vi.mocked(getConfig).mockReturnValue({
      defaultCountry: "ES",
      enabledCountries: ["ES", "XX"],
      defaultFuel: "B7",
      center: [-3.7, 40.4],
      zoom: 6,
      clusterStations: true,
    });

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    const xx = response.data.enabledCountries.find(
      (c: { code: string }) => c.code === "XX",
    );
    expect(xx).toBeDefined();
    expect(xx.name).toBe("XX");
    expect(xx.center).toBeUndefined();
    expect(xx.zoom).toBeUndefined();
  });
});
