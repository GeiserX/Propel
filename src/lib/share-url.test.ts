import { describe, it, expect } from "vitest";
import {
  roundCoord,
  formatLatLng,
  parseLatLng,
  buildStationQuery,
  parseStationParams,
  buildRouteQuery,
  parseRouteParams,
  MAX_VIA,
  type StationShareParams,
  type RouteShareParams,
} from "./share-url";

describe("roundCoord", () => {
  it("rounds to 5 decimal places", () => {
    expect(roundCoord(40.4167247)).toBe(40.41672);
    expect(roundCoord(-3.7037902)).toBe(-3.70379);
    expect(roundCoord(40.416725)).toBe(40.41673); // round half up
  });

  it("leaves already-short coordinates intact", () => {
    expect(roundCoord(0)).toBe(0);
    expect(roundCoord(12.5)).toBe(12.5);
  });

  it("rounds a negative coordinate on the .5 boundary toward +Infinity", () => {
    // Math.round rounds half toward +Infinity, so -3.703795 * 1e5 = -370379.5
    // -> Math.round(-370379.5) = -370379 -> -3.70379 (NOT -3.7038).
    // Pinned so a refactor to toFixed/Math.trunc (which would yield -3.7038
    // or -3.70379 by truncation) is caught.
    expect(roundCoord(-3.703795)).toBe(-3.70379);
    // Symmetric positive boundary still rounds up.
    expect(roundCoord(3.703795)).toBe(3.7038);
  });
});

describe("formatLatLng", () => {
  it("formats as lat,lng at 5dp", () => {
    expect(formatLatLng(40.4167247, -3.7037902)).toBe("40.41672,-3.70379");
  });

  it("rounds each component independently", () => {
    expect(formatLatLng(1.123456, 2.654321)).toBe("1.12346,2.65432");
  });

  it("formats a southern/western-hemisphere pair (both negative)", () => {
    // Buenos Aires: negative lat (south) and negative lng (west).
    expect(formatLatLng(-34.603722, -58.381592)).toBe("-34.60372,-58.38159");
  });
});

describe("parseLatLng", () => {
  it("parses a valid pair", () => {
    expect(parseLatLng("40.41672,-3.70379")).toEqual({ lat: 40.41672, lng: -3.70379 });
  });

  it("parses zero coordinates", () => {
    expect(parseLatLng("0,0")).toEqual({ lat: 0, lng: 0 });
  });

  it("parses a southern/western-hemisphere pair (both negative)", () => {
    expect(parseLatLng("-34.60372,-58.38159")).toEqual({ lat: -34.60372, lng: -58.38159 });
  });

  it("round-trips a negative pair through formatLatLng -> parseLatLng", () => {
    // Southern-hemisphere lat + western-hemisphere lng (both negative).
    expect(parseLatLng(formatLatLng(-33.86882, -58.38159))).toEqual({
      lat: -33.86882,
      lng: -58.38159,
    });
  });

  it("returns null on malformed input", () => {
    expect(parseLatLng("")).toBeNull();
    expect(parseLatLng("40.41672")).toBeNull();
    expect(parseLatLng("40.41672,-3.70379,5")).toBeNull();
    expect(parseLatLng("abc,def")).toBeNull();
    expect(parseLatLng("40.41672,")).toBeNull();
    expect(parseLatLng(",-3.70379")).toBeNull();
  });

  it("returns null when out of range", () => {
    expect(parseLatLng("91,0")).toBeNull();
    expect(parseLatLng("-91,0")).toBeNull();
    expect(parseLatLng("0,181")).toBeNull();
    expect(parseLatLng("0,-181")).toBeNull();
  });

  it("accepts the range boundaries", () => {
    expect(parseLatLng("90,180")).toEqual({ lat: 90, lng: 180 });
    expect(parseLatLng("-90,-180")).toEqual({ lat: -90, lng: -180 });
  });

  it("returns null on non-finite values", () => {
    expect(parseLatLng("Infinity,0")).toBeNull();
    expect(parseLatLng("NaN,0")).toBeNull();
  });
});

describe("buildStationQuery / parseStationParams round-trip", () => {
  it("round-trips a basic station", () => {
    const p: StationShareParams = {
      country: "ES",
      externalId: "12345",
      lat: 40.4167247,
      lng: -3.7037902,
    };
    const sp = buildStationQuery(p);
    expect(sp.get("station")).toBe("ES:12345");
    expect(sp.get("lat")).toBe("40.41672");
    expect(sp.get("lng")).toBe("-3.70379");

    const parsed = parseStationParams(sp);
    expect(parsed).toEqual({
      country: "ES",
      externalId: "12345",
      lat: 40.41672,
      lng: -3.70379,
    });
  });

  it("uppercases the country on build", () => {
    const sp = buildStationQuery({ country: "es", externalId: "abc", lat: 1, lng: 2 });
    expect(sp.get("station")).toBe("ES:abc");
    expect(parseStationParams(sp)?.country).toBe("ES");
  });

  it("splits on the first colon when externalId contains colons", () => {
    const p: StationShareParams = {
      country: "DE",
      externalId: "tankerkoenig:uuid:9876",
      lat: 52.52,
      lng: 13.405,
    };
    const sp = buildStationQuery(p);
    expect(sp.get("station")).toBe("DE:tankerkoenig:uuid:9876");

    const parsed = parseStationParams(sp);
    expect(parsed?.country).toBe("DE");
    expect(parsed?.externalId).toBe("tankerkoenig:uuid:9876");
  });

  it("returns null externalId when station value has no colon", () => {
    const sp = new URLSearchParams();
    sp.set("station", "ES");
    const parsed = parseStationParams(sp);
    expect(parsed).toEqual({ country: "ES", externalId: null, lat: null, lng: null });
  });

  it("yields null coords when lat/lng are out of range", () => {
    const sp = new URLSearchParams();
    sp.set("station", "ES:1");
    sp.set("lat", "999");
    sp.set("lng", "999");
    const parsed = parseStationParams(sp);
    expect(parsed?.country).toBe("ES");
    expect(parsed?.lat).toBeNull();
    expect(parsed?.lng).toBeNull();
  });

  it("parses lat/lng even without a station value", () => {
    const sp = new URLSearchParams();
    sp.set("lat", "40.41672");
    sp.set("lng", "-3.70379");
    const parsed = parseStationParams(sp);
    expect(parsed).toEqual({
      country: null,
      externalId: null,
      lat: 40.41672,
      lng: -3.70379,
    });
  });

  it("returns null when no station-ish params are present", () => {
    expect(parseStationParams(new URLSearchParams())).toBeNull();
    expect(parseStationParams(new URLSearchParams("foo=bar"))).toBeNull();
  });
});

describe("buildRouteQuery / parseRouteParams round-trip", () => {
  const from = { lat: 40.4167247, lng: -3.7037902 };
  const to = { lat: 41.3873974, lng: 2.168568 };

  it("round-trips with 0 waypoints", () => {
    const p: RouteShareParams = { from, to, via: [], fuel: "E5" };
    const sp = buildRouteQuery(p);
    expect(sp.get("from")).toBe("40.41672,-3.70379");
    expect(sp.get("to")).toBe("41.3874,2.16857");
    expect(sp.getAll("via")).toEqual([]);
    expect(sp.get("fuel")).toBe("E5");

    expect(parseRouteParams(sp)).toEqual({
      from: { lat: 40.41672, lng: -3.70379 },
      to: { lat: 41.3874, lng: 2.16857 },
      via: [],
      fuel: "E5",
    });
  });

  it("round-trips a route whose coords are all negative (southern + western)", () => {
    const negFrom = { lat: -34.603722, lng: -58.381592 }; // Buenos Aires
    const negTo = { lat: -33.448891, lng: -70.669266 }; // Santiago
    const negVia = [{ lat: -32.889458, lng: -68.84584 }]; // Mendoza
    const sp = buildRouteQuery({ from: negFrom, to: negTo, via: negVia, fuel: "E5" });
    expect(sp.get("from")).toBe("-34.60372,-58.38159");
    expect(sp.get("to")).toBe("-33.44889,-70.66927");
    expect(sp.getAll("via")).toEqual(["-32.88946,-68.84584"]);

    expect(parseRouteParams(sp)).toEqual({
      from: { lat: -34.60372, lng: -58.38159 },
      to: { lat: -33.44889, lng: -70.66927 },
      via: [{ lat: -32.88946, lng: -68.84584 }],
      fuel: "E5",
    });
  });

  it("round-trips with 2 waypoints in order", () => {
    const via = [
      { lat: 39.46975, lng: -0.37739 },
      { lat: 37.38909, lng: -5.98446 },
    ];
    const p: RouteShareParams = { from, to, via, fuel: "B7" };
    const sp = buildRouteQuery(p);
    expect(sp.getAll("via")).toEqual(["39.46975,-0.37739", "37.38909,-5.98446"]);

    const parsed = parseRouteParams(sp);
    expect(parsed?.via).toEqual(via);
    expect(parsed?.fuel).toBe("B7");
  });

  it("round-trips with 5 waypoints (the maximum)", () => {
    const via = [
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
      { lat: 4, lng: 4 },
      { lat: 5, lng: 5 },
    ];
    expect(via.length).toBe(MAX_VIA);
    const sp = buildRouteQuery({ from, to, via, fuel: "LPG" });
    const parsed = parseRouteParams(sp);
    expect(parsed?.via).toEqual(via);
  });

  it("caps via parsing at 5 entries, ignoring extras", () => {
    const sp = new URLSearchParams();
    sp.set("from", formatLatLng(from.lat, from.lng));
    sp.set("to", formatLatLng(to.lat, to.lng));
    for (let i = 1; i <= 8; i++) sp.append("via", `${i},${i}`);
    sp.set("fuel", "E10");

    const parsed = parseRouteParams(sp);
    expect(parsed?.via).toHaveLength(MAX_VIA);
    expect(parsed?.via).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
      { lat: 4, lng: 4 },
      { lat: 5, lng: 5 },
    ]);
  });

  it("drops malformed via entries while keeping valid ones (cap counts valid only)", () => {
    const sp = new URLSearchParams();
    sp.set("from", formatLatLng(from.lat, from.lng));
    sp.set("to", formatLatLng(to.lat, to.lng));
    sp.append("via", "1,1");
    sp.append("via", "garbage");
    sp.append("via", "999,999"); // out of range -> dropped
    sp.append("via", "2,2");
    sp.set("fuel", "CNG");

    const parsed = parseRouteParams(sp);
    expect(parsed?.via).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ]);
  });

  it("returns null when from is missing", () => {
    const sp = new URLSearchParams();
    sp.set("to", formatLatLng(to.lat, to.lng));
    sp.set("fuel", "E5");
    expect(parseRouteParams(sp)).toBeNull();
  });

  it("returns null when to is missing", () => {
    const sp = new URLSearchParams();
    sp.set("from", formatLatLng(from.lat, from.lng));
    sp.set("fuel", "E5");
    expect(parseRouteParams(sp)).toBeNull();
  });

  it("returns null when from is malformed", () => {
    const sp = new URLSearchParams();
    sp.set("from", "abc");
    sp.set("to", formatLatLng(to.lat, to.lng));
    expect(parseRouteParams(sp)).toBeNull();
  });

  it("passes fuel through as-is without validating it", () => {
    const sp = buildRouteQuery({ from, to, via: [], fuel: "NOT_A_REAL_FUEL" });
    expect(parseRouteParams(sp)?.fuel).toBe("NOT_A_REAL_FUEL");
  });

  it("defaults fuel to empty string when absent", () => {
    const sp = new URLSearchParams();
    sp.set("from", formatLatLng(from.lat, from.lng));
    sp.set("to", formatLatLng(to.lat, to.lng));
    expect(parseRouteParams(sp)?.fuel).toBe("");
  });

  it("returns null when no route params are present", () => {
    expect(parseRouteParams(new URLSearchParams())).toBeNull();
    expect(parseRouteParams(new URLSearchParams("foo=bar"))).toBeNull();
  });
});
