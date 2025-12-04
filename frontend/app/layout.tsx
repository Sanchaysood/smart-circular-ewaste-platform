"use client";

import React from "react";
import "./globals.css";
import { Toaster } from "react-hot-toast";

type Props = {
  children: React.ReactNode;
};

/**
 * SafeRenderer: defensive renderer to avoid "Objects are not valid as a React child"
 * - Renders valid React elements normally
 * - Recursively renders arrays
 * - Renders primitives
 * - Converts plain objects into a readable JSON preview (so app doesn't crash)
 */
function SafeRenderer({ node }: { node: any }) {
  // null / undefined
  if (node === null || node === undefined) return null;

  // React elements (JSX)
  if (React.isValidElement(node)) return node;

  // Primitives
  const t = typeof node;
  if (t === "string" || t === "number" || t === "boolean") {
    return <>{String(node)}</>;
  }

  // Arrays -> render recursively
  if (Array.isArray(node)) {
    return (
      <>
        {node.map((child, i) => (
          <React.Fragment key={i}>
            <SafeRenderer node={child} />
          </React.Fragment>
        ))}
      </>
    );
  }

  // Functions -> don't call them here
  if (t === "function") return null;

  // Objects -> show JSON preview (this avoids crash)
  try {
    const prettified = JSON.stringify(node, null, 2);
    if (typeof window !== "undefined") {
      // Log to console to help you debug
      // eslint-disable-next-line no-console
      console.warn("SafeRenderer: rendering non-React object as JSON preview:", node);
    }
    return (
      <div style={{ padding: 16, fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" }}>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>Non-renderable object detected — preview</div>
        <div style={{ background: "#0b1221", color: "#d6f8ff", padding: 12, borderRadius: 8, fontSize: 12, overflow: "auto", maxHeight: "40vh", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {prettified}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              try {
                navigator.clipboard.writeText(prettified);
                // eslint-disable-next-line no-alert
                alert("Object copied to clipboard. Paste it here so I can fix the offending component.");
              } catch {
                // eslint-disable-next-line no-alert
                alert("Copy failed — view object in console.");
              }
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              background: "#0f172a",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Copy object
          </button>
          <button
            onClick={() => {
              // try to reload to clear transient render errors
              window.location.reload();
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              background: "#fff",
              color: "#111827",
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </div>
        <div style={{ marginTop: 10, color: "#555", fontSize: 13 }}>
          Hint: The object keys `{`{type, loc, msg, input}`}` usually come from validation libraries (zod / joi / express-validator). You're probably rendering an error object directly (e.g. `{error}`) somewhere in your page — replace that with a message like `error.message` or `JSON.stringify(error)`.
        </div>
      </div>
    );
  } catch (err) {
    return <div>[non-renderable object]</div>;
  }
}

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en">
      <head />
      <body>
        {/* Render children defensively */}
        <SafeRenderer node={children} />

        {/* Toaster (client) */}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 14,
            },
          }}
        />
      </body>
    </html>
  );
}
