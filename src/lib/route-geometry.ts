/** Linear interpolation between two [lon,lat] points. */
export function lerpCoord(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Precompute cumulative segment lengths (degree-space) for a route LineString. */
export function buildRouteIndex(coords: [number, number][]): { cum: number[]; total: number } {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return { cum, total: cum[cum.length - 1] };
}

/**
 * Given a distance fraction (0–1) along the route, return the interpolated
 * point and its cumulative on-route time (seconds) from the durations array.
 */
export function sampleRoute(
  coords: [number, number][],
  durations: number[] | undefined,
  cum: number[],
  total: number,
  fraction: number,
): { point: [number, number]; time: number } {
  const clamped = Math.max(0, Math.min(1, fraction));
  if (total === 0 || coords.length < 2) {
    return { point: coords[0], time: durations?.[0] ?? 0 };
  }
  const target = clamped * total;
  // Find segment [i, i+1] containing the target cumulative distance
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < target) i++;
  const segLen = cum[i + 1] - cum[i];
  const segT = segLen > 0 ? (target - cum[i]) / segLen : 0;
  const point = lerpCoord(coords[i], coords[i + 1], segT);
  let time = 0;
  if (durations && durations.length === coords.length) {
    time = durations[i] + (durations[i + 1] - durations[i]) * segT;
  }
  return { point, time };
}

/** Project a point onto a LineString and return its fraction (0–1) along the line. */
export function projectOntoRoute(point: [number, number], coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  let bestDist = Infinity;
  let bestFrac = 0;
  let cumLen = 0;
  const segLens: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    segLens.push(Math.sqrt(dx * dx + dy * dy));
  }
  const totalLen = segLens.reduce((s, l) => s + l, 0);
  if (totalLen === 0) return 0;

  for (let i = 0; i < segLens.length; i++) {
    const ax = coords[i][0], ay = coords[i][1];
    const bx = coords[i + 1][0], by = coords[i + 1][1];
    const abx = bx - ax, aby = by - ay;
    const apx = point[0] - ax, apy = point[1] - ay;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
    const px = ax + t * abx, py = ay + t * aby;
    const dx = point[0] - px, dy = point[1] - py;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestFrac = (cumLen + t * segLens[i]) / totalLen;
    }
    cumLen += segLens[i];
  }
  return bestFrac;
}
