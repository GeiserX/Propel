import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Pumperly - Energy Route Planner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0c111b 0%, #1a2332 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 28,
            background: "linear-gradient(135deg, #34d399, #22d3ee)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 32,
          }}
        >
          <svg
            width="72"
            height="72"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M19.5 5L11 18h6l-3 9L22 14h-6l3.5-9z"
              fill="#0c111b"
            />
          </svg>
        </div>
        {/* Title */}
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            background: "linear-gradient(90deg, #34d399, #22d3ee)",
            backgroundClip: "text",
            color: "transparent",
            lineHeight: 1.2,
          }}
        >
          Pumperly
        </div>
        {/* Subtitle */}
        <div
          style={{
            fontSize: 28,
            color: "#94a3b8",
            marginTop: 16,
            textAlign: "center",
            maxWidth: 700,
          }}
        >
          Find the cheapest fuel &amp; EV charging along your route
        </div>
      </div>
    ),
    { ...size },
  );
}
