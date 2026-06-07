"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#030712",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "24rem",
            margin: "1rem",
            padding: "1.5rem",
            textAlign: "center",
            borderRadius: "0.75rem",
            border: "1px solid rgba(255,255,255,0.08)",
            backgroundColor: "rgba(17,24,39,0.7)",
            color: "#f3f4f6",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h2>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              color: "#9ca3af",
            }}
          >
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "#ffffff",
              backgroundColor: "#10b981",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
