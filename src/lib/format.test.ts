import { describe, it, expect } from "vitest";
import { formatDistance, formatDuration } from "./format";

describe("formatDistance", () => {
  it("renders sub-kilometre distances in metres", () => {
    expect(formatDistance(0.5)).toBe("500 m");
    expect(formatDistance(0.123)).toBe("123 m");
    expect(formatDistance(0)).toBe("0 m");
  });

  it("renders kilometre distances with one decimal", () => {
    expect(formatDistance(1)).toBe("1.0 km");
    expect(formatDistance(12.34)).toBe("12.3 km");
  });
});

describe("formatDuration", () => {
  it("renders zero as 0 min", () => {
    expect(formatDuration(0)).toBe("0 min");
  });

  it("renders sub-hour durations in minutes", () => {
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(1800)).toBe("30 min");
  });

  it("renders over-hour durations as hours and minutes", () => {
    expect(formatDuration(3600)).toBe("1 h 0 min");
    expect(formatDuration(5400)).toBe("1 h 30 min");
    expect(formatDuration(7260)).toBe("2 h 1 min");
  });

  it("rolls minutes into hours instead of showing 60", () => {
    expect(formatDuration(59)).toBe("1 min");
    expect(formatDuration(3599)).toBe("1 h 0 min");
    expect(formatDuration(7199)).toBe("2 h 0 min");
  });
});
