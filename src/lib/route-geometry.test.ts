import { describe, it, expect } from "vitest";
import { lerpCoord, buildRouteIndex, sampleRoute, projectOntoRoute } from "./route-geometry";

describe("lerpCoord", () => {
  const a: [number, number] = [0, 0];
  const b: [number, number] = [4, 2];

  it("returns a at t=0", () => {
    expect(lerpCoord(a, b, 0)).toEqual([0, 0]);
  });

  it("returns b at t=1", () => {
    expect(lerpCoord(a, b, 1)).toEqual([4, 2]);
  });

  it("returns the midpoint at t=0.5", () => {
    expect(lerpCoord(a, b, 0.5)).toEqual([2, 1]);
  });
});

describe("buildRouteIndex", () => {
  it("produces cumulative monotonic lengths and a matching total", () => {
    const coords: [number, number][] = [
      [0, 0],
      [2, 0],
      [4, 0],
    ];
    const { cum, total } = buildRouteIndex(coords);
    expect(cum).toEqual([0, 2, 4]);
    expect(total).toBe(4);
    for (let i = 1; i < cum.length; i++) {
      expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
    }
    expect(total).toBe(cum[cum.length - 1]);
  });
});

describe("sampleRoute", () => {
  const coords: [number, number][] = [
    [0, 0],
    [2, 0],
    [4, 0],
  ];
  const durations = [0, 100, 300];
  const { cum, total } = buildRouteIndex(coords);

  it("returns the first point and time 0 at fraction 0", () => {
    const { point, time } = sampleRoute(coords, durations, cum, total, 0);
    expect(point).toEqual([0, 0]);
    expect(time).toBe(0);
  });

  it("interpolates the midpoint of the route at fraction 0.5", () => {
    const { point, time } = sampleRoute(coords, durations, cum, total, 0.5);
    expect(point).toEqual([2, 0]);
    expect(time).toBe(100);
  });

  it("interpolates within the first segment at fraction 0.25", () => {
    const { point, time } = sampleRoute(coords, durations, cum, total, 0.25);
    expect(point).toEqual([1, 0]);
    expect(time).toBe(50);
  });

  it("interpolates within the second segment at fraction 0.75", () => {
    const { point, time } = sampleRoute(coords, durations, cum, total, 0.75);
    expect(point).toEqual([3, 0]);
    expect(time).toBe(200);
  });

  it("returns the last point and total time at fraction 1", () => {
    const { point, time } = sampleRoute(coords, durations, cum, total, 1);
    expect(point).toEqual([4, 0]);
    expect(time).toBe(300);
  });

  it("degenerates to the first point when total is 0", () => {
    const flat: [number, number][] = [
      [5, 5],
      [5, 5],
    ];
    const { point, time } = sampleRoute(flat, [42, 99], [0, 0], 0, 0.5);
    expect(point).toEqual([5, 5]);
    expect(time).toBe(42);
  });

  it("degenerates to the first point when fewer than 2 coords", () => {
    const single: [number, number][] = [[7, 8]];
    const { point, time } = sampleRoute(single, undefined, [0], 0, 0.5);
    expect(point).toEqual([7, 8]);
    expect(time).toBe(0);
  });
});

describe("projectOntoRoute", () => {
  const coords: [number, number][] = [
    [0, 0],
    [2, 0],
    [4, 0],
  ];

  it("returns the exact fraction for a point on a vertex", () => {
    expect(projectOntoRoute([2, 0], coords)).toBeCloseTo(0.5, 10);
  });

  it("returns 0 for the first vertex", () => {
    expect(projectOntoRoute([0, 0], coords)).toBeCloseTo(0, 10);
  });

  it("returns 1 for the last vertex", () => {
    expect(projectOntoRoute([4, 0], coords)).toBeCloseTo(1, 10);
  });

  it("projects a point off the line onto the nearest fraction", () => {
    // Point above the midpoint of the line projects to fraction 0.25 (x=1).
    expect(projectOntoRoute([1, 5], coords)).toBeCloseTo(0.25, 10);
  });

  it("returns 0 when fewer than 2 coords", () => {
    expect(projectOntoRoute([1, 1], [[0, 0]])).toBe(0);
  });

  it("returns 0 when the line has zero total length", () => {
    expect(
      projectOntoRoute(
        [1, 1],
        [
          [3, 3],
          [3, 3],
        ],
      ),
    ).toBe(0);
  });
});
