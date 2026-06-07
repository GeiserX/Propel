import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Route } from "@/components/map/route-layer";
import { formatDistance, formatDuration } from "@/lib/format";
import { RouteAlternatives } from "./route-alternatives";

function makeRoute(distance: number, duration: number): Route {
  return {
    geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-3.6, 40.5]] },
    distance,
    duration,
    bbox: [-3.7, 40.4, -3.6, 40.5],
  };
}

const ROUTES: Route[] = [
  makeRoute(150.5, 5400),
  makeRoute(168.2, 6000),
  makeRoute(142.9, 6300),
];

describe("RouteAlternatives", () => {
  it("renders each route's distance and duration", () => {
    render(
      <RouteAlternatives
        routes={ROUTES}
        primaryRouteIndex={0}
        isLoading={false}
        onSelectRoute={() => {}}
      />,
    );

    for (const route of ROUTES) {
      expect(screen.getByText(formatDistance(route.distance))).toBeInTheDocument();
      expect(screen.getByText(formatDuration(route.duration))).toBeInTheDocument();
    }
  });

  it("highlights the selected route's duration with the semibold style", () => {
    render(
      <RouteAlternatives
        routes={ROUTES}
        primaryRouteIndex={1}
        isLoading={false}
        onSelectRoute={() => {}}
      />,
    );

    // The selected route renders its duration with `font-semibold`; the others do not.
    const selectedDuration = screen.getByText(formatDuration(ROUTES[1].duration));
    expect(selectedDuration).toHaveClass("font-semibold");

    const unselectedDuration = screen.getByText(formatDuration(ROUTES[0].duration));
    expect(unselectedDuration).not.toHaveClass("font-semibold");
  });

  it("does not render the duration text for the selected route while loading", () => {
    render(
      <RouteAlternatives
        routes={ROUTES}
        primaryRouteIndex={0}
        isLoading={true}
        onSelectRoute={() => {}}
      />,
    );

    // Selected (index 0) shows a spinner instead of its duration.
    expect(screen.queryByText(formatDuration(ROUTES[0].duration))).not.toBeInTheDocument();
    // Non-selected routes still show their durations.
    expect(screen.getByText(formatDuration(ROUTES[1].duration))).toBeInTheDocument();
  });

  it("fires onSelectRoute with the clicked index for a non-selected route", async () => {
    const user = userEvent.setup();
    const onSelectRoute = vi.fn();
    render(
      <RouteAlternatives
        routes={ROUTES}
        primaryRouteIndex={0}
        isLoading={false}
        onSelectRoute={onSelectRoute}
      />,
    );

    // Click the third route (index 2) which is not selected.
    await user.click(screen.getByText(formatDistance(ROUTES[2].distance)));
    expect(onSelectRoute).toHaveBeenCalledTimes(1);
    expect(onSelectRoute).toHaveBeenCalledWith(2);
  });

  it("does not fire onSelectRoute when the selected route is clicked", async () => {
    const user = userEvent.setup();
    const onSelectRoute = vi.fn();
    render(
      <RouteAlternatives
        routes={ROUTES}
        primaryRouteIndex={0}
        isLoading={false}
        onSelectRoute={onSelectRoute}
      />,
    );

    await user.click(screen.getByText(formatDistance(ROUTES[0].distance)));
    expect(onSelectRoute).not.toHaveBeenCalled();
  });
});
