import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDetourStream } from "@/lib/use-detour-stream";
import type { StationsGeoJSONCollection } from "@/types/station";
import type { RouteState } from "@/types/route";

// --- Fixtures -------------------------------------------------------------

function makeStation(id: string, routeFraction: number | null): StationsGeoJSONCollection["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      id,
      name: id,
      brand: null,
      address: "",
      city: "",
      fuelType: "E5",
      currency: "EUR",
      routeFraction,
    } as StationsGeoJSONCollection["features"][number]["properties"],
  };
}

function makeStations(ids: { id: string; routeFraction: number | null }[]): StationsGeoJSONCollection {
  return { type: "FeatureCollection", features: ids.map((s) => makeStation(s.id, s.routeFraction)) };
}

// A minimal route using detourBasis "any" so the hook never touches
// buildRouteIndex/sampleRoute (route-relative geometry path).
function makeRouteState(): RouteState {
  return {
    primaryIndex: 0,
    routes: [
      {
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        distance: 100,
        duration: 3600,
        bbox: [0, 0, 1, 1],
        durations: [0, 3600],
      },
    ],
  };
}

// Build a ReadableStream that emits the given string in fixed-size byte
// slices, letting us exercise partial-line buffering across reads.
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

function ndjsonResponse(stream: ReadableStream<Uint8Array>): Response {
  // jsdom lacks a full Response with a body reader; fake the shape the hook uses.
  return { ok: true, body: stream } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDetourStream", () => {
  it("streams detourMin values into detourMap", async () => {
    fetchMock.mockResolvedValueOnce(
      ndjsonResponse(
        streamFromChunks([
          JSON.stringify({ id: "a", detourMin: 1.5 }) + "\n",
          JSON.stringify({ id: "b", detourMin: 4.2 }) + "\n",
        ]),
      ),
    );

    const stations = makeStations([
      { id: "a", routeFraction: 0.1 },
      { id: "b", routeFraction: 0.2 },
    ]);
    const routeState = makeRouteState();

    const { result } = renderHook(() =>
      useDetourStream({ primaryStations: stations, routeState, detourBasis: "any" }),
    );

    await waitFor(() => {
      expect(result.current.detourMap).toEqual({ a: 1.5, b: 4.2 });
    });
    await waitFor(() => expect(result.current.detoursLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("buffers partial lines split across stream chunks", async () => {
    // Split a single NDJSON record across two byte-chunks, and emit a trailing
    // record with no final newline (flushed by the closing-buffer logic).
    fetchMock.mockResolvedValueOnce(
      ndjsonResponse(
        streamFromChunks([
          '{"id":"a","detou', // partial — must be buffered
          'rMin":2.5}\n{"id":"b","detourMin":3.5}\n',
        ]),
      ),
    );

    const stations = makeStations([
      { id: "a", routeFraction: 0.1 },
      { id: "b", routeFraction: 0.2 },
    ]);
    const routeState = makeRouteState();

    const { result } = renderHook(() =>
      useDetourStream({ primaryStations: stations, routeState, detourBasis: "any" }),
    );

    await waitFor(() => {
      expect(result.current.detourMap).toEqual({ a: 2.5, b: 3.5 });
    });
  });

  it("backfills never-seen eligible stations as -1", async () => {
    // Stream only reports "a"; "b" is eligible but never seen → backfilled -1.
    fetchMock.mockResolvedValueOnce(
      ndjsonResponse(streamFromChunks([JSON.stringify({ id: "a", detourMin: 1.0 }) + "\n"])),
    );

    const stations = makeStations([
      { id: "a", routeFraction: 0.1 },
      { id: "b", routeFraction: 0.2 },
    ]);
    const routeState = makeRouteState();

    const { result } = renderHook(() =>
      useDetourStream({ primaryStations: stations, routeState, detourBasis: "any" }),
    );

    await waitFor(() => {
      expect(result.current.detourMap).toEqual({ a: 1.0, b: -1 });
    });
  });

  it("chunks eligible stations into requests of <=150 (3 chunks for 301)", async () => {
    const count = 301; // → 150 + 150 + 1 = 3 chunks
    const stations = makeStations(
      Array.from({ length: count }, (_, i) => ({ id: `s${i}`, routeFraction: i / count })),
    );

    // Each fetch call returns a stream covering exactly the chunk it was given.
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { stations: { id: string }[] };
      expect(body.stations.length).toBeLessThanOrEqual(150);
      const ndjson = body.stations.map((s) => JSON.stringify({ id: s.id, detourMin: 1 })).join("\n") + "\n";
      return Promise.resolve(ndjsonResponse(streamFromChunks([ndjson])));
    });
    const routeState = makeRouteState();

    const { result } = renderHook(() =>
      useDetourStream({ primaryStations: stations, routeState, detourBasis: "any" }),
    );

    await waitFor(() => expect(result.current.detoursLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(Object.keys(result.current.detourMap)).toHaveLength(count);
  });

  it("aborts the prior stream when stationKey changes on re-run", async () => {
    const abortedSignals: AbortSignal[] = [];
    // First call: a fetch that stays pending until its signal aborts, then
    // rejects with an AbortError — matching real fetch semantics. This keeps
    // the request "in-flight" without leaving an unclosed ReadableStream open
    // (which would hang the worker), while still proving the abort fires.
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      abortedSignals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    // Second call: resolves normally for the new station set.
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { stations: { id: string }[] };
      const ndjson = body.stations.map((s) => JSON.stringify({ id: s.id, detourMin: 7 })).join("\n") + "\n";
      return Promise.resolve(ndjsonResponse(streamFromChunks([ndjson])));
    });

    const initial = makeStations([{ id: "a", routeFraction: 0.1 }]);
    const next = makeStations([{ id: "z", routeFraction: 0.5 }]);
    const routeState = makeRouteState();

    const { result, rerender } = renderHook(
      ({ stations }) => useDetourStream({ primaryStations: stations, routeState, detourBasis: "any" }),
      { initialProps: { stations: initial } },
    );

    // Let the first effect kick off its fetch.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Changing the station set changes stationKey → effect re-runs → prior abort.
    rerender({ stations: next });

    await waitFor(() => expect(abortedSignals[0]?.aborted).toBe(true));
    await waitFor(() => {
      expect(result.current.detourMap).toEqual({ z: 7 });
    });
  });
});
