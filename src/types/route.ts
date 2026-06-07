import type { Route } from "@/components/map/route-layer";

export interface RouteState {
  routes: Route[];
  primaryIndex: number;
}

// Detour basis: "selected" measures detour against the chosen route's geometry
// (route-specific); "any" measures the global origin→station→destination optimum.
export type DetourBasis = "selected" | "any";
