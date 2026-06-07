import { NextResponse } from "next/server";

// In-memory cache — survives across requests in the same process
let cached: { rates: Record<string, number>; date: string; fetchedAt: number } | null = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

async function fetchRates(): Promise<{ rates: Record<string, number>; date: string }> {
  const res = await fetch(ECB_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`ECB returned ${res.status}`);
  const xml = await res.text();

  // Parse date: <Cube time="2026-03-18"> (ECB may emit single OR double quotes)
  const dateMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
  const date = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10);

  // Parse rates: <Cube currency="USD" rate="1.0934"/> (single OR double quotes)
  const rates: Record<string, number> = { EUR: 1 };
  const rateRegex = /currency=['"]([A-Z]+)['"]\s+rate=['"]([\d.]+)['"]/g;
  let match;
  while ((match = rateRegex.exec(xml)) !== null) {
    rates[match[1]] = parseFloat(match[2]);
  }

  // Currencies not published by ECB — add fixed/approximate rates
  if (!rates.BAM) rates.BAM = 1.95583; // Bosnia — pegged to EUR via currency board
  if (!rates.MKD) rates.MKD = 61.5;    // North Macedonia — approximate, managed float
  if (!rates.RSD) rates.RSD = 117.0;   // Serbia — approximate, managed float
  if (!rates.ARS) rates.ARS = 1200;    // Argentina — approximate, high inflation
  if (!rates.MDL) rates.MDL = 19.5;    // Moldova — approximate

  return { rates, date };
}

export async function GET() {
  try {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return NextResponse.json(
        { base: "EUR", rates: cached.rates, date: cached.date },
        { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
      );
    }

    const data = await fetchRates();
    cached = { ...data, fetchedAt: Date.now() };
    console.log(`[exchange-rates] Fetched ECB rates for ${data.date}: ${Object.keys(data.rates).length} currencies`);

    return NextResponse.json(
      { base: "EUR", ...data },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (err) {
    console.error("[exchange-rates] Failed to fetch ECB rates:", err);

    // Serve stale cache if available
    if (cached) {
      return NextResponse.json(
        { base: "EUR", rates: cached.rates, date: cached.date, stale: true },
        { headers: { "Cache-Control": "public, s-maxage=60" } },
      );
    }

    return NextResponse.json({ error: "Failed to fetch exchange rates" }, { status: 502 });
  }
}
