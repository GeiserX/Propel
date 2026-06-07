import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { headers?: Record<string, string>; status?: number }) => ({
      data,
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
    }),
  },
}));

describe("exchange-rates API", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and parses ECB XML rates", async () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time='2026-04-10'>
      <Cube currency='USD' rate='1.0934'/>
      <Cube currency='GBP' rate='0.8561'/>
      <Cube currency='CHF' rate='0.9584'/>
      <Cube currency='SEK' rate='11.0250'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.data.base).toBe("EUR");
    expect(response.data.rates.EUR).toBe(1);
    expect(response.data.rates.USD).toBeCloseTo(1.0934, 4);
    expect(response.data.rates.GBP).toBeCloseTo(0.8561, 4);
    expect(response.data.rates.CHF).toBeCloseTo(0.9584, 4);
    expect(response.data.date).toBe("2026-04-10");
  });

  it("adds approximate rates for non-ECB currencies", async () => {
    const mockXml = `<Cube><Cube time='2026-04-10'>
      <Cube currency='USD' rate='1.09'/>
    </Cube></Cube>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    // Should include fixed/approximate rates
    expect(response.data.rates.BAM).toBeCloseTo(1.95583, 4);
    expect(response.data.rates.MKD).toBeDefined();
    expect(response.data.rates.RSD).toBeDefined();
    expect(response.data.rates.ARS).toBeDefined();
    expect(response.data.rates.MDL).toBeDefined();
  });

  it("parses double-quoted ECB XML attributes", async () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time="2026-05-15">
      <Cube currency="USD" rate="1.0876"/>
      <Cube currency="GBP" rate="0.8499"/>
      <Cube currency="PLN" rate="4.2750"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { GET } = await import("./route");
    const response = (await GET()) as unknown as { data: { date: string; rates: Record<string, number> } };

    expect(response.data.date).toBe("2026-05-15");
    expect(response.data.rates.EUR).toBe(1);
    expect(response.data.rates.USD).toBeCloseTo(1.0876, 4);
    expect(response.data.rates.GBP).toBeCloseTo(0.8499, 4);
    expect(response.data.rates.PLN).toBeCloseTo(4.275, 4);
  });

  it("returns 502 when ECB fetch fails and no cache", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET()) as any;

    expect(response.status).toBe(502);
    expect(response.data.error).toBeDefined();
  });
});
