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
      <div className="p-6 font-sans">
        <div className="mb-3 font-semibold text-slate-800">Non-renderable object detected — preview</div>
        <div className="bg-slate-900 text-cyan-100 p-4 rounded-2xl text-xs overflow-auto max-h-[40vh] whitespace-pre-wrap break-words font-mono">
          {prettified}
        </div>
        <div className="mt-4 flex gap-3">
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
            className="px-4 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors duration-200 cursor-pointer font-medium text-sm"
          >
            Copy object
          </button>
          <button
            onClick={() => {
              // try to reload to clear transient render errors
              window.location.reload();
            }}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 transition-colors duration-200 cursor-pointer font-medium text-sm"
          >
            Reload page
          </button>
        </div>
        <div className="mt-4 text-slate-600 text-sm">
          Hint: The object keys (type, loc, msg, input) usually come from validation libraries (zod / joi / express-validator). You're probably rendering an error object directly somewhere in your page — replace that with a message like error.message or JSON.stringify(error).
        </div>
      </div>
    );
  } catch (err) {
    return <div className="text-slate-600 text-sm p-4">[non-renderable object]</div>;
  }
}

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-gradient-to-br from-[#ECFDF5] via-[#E6F7F3] to-[#F5F7F6] font-sans antialiased">
        {/* Global ambient background pattern */}
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-br from-[#2F7D5B]/5 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-[#2BAE9E]/5 to-transparent rounded-full blur-3xl" />
        </div>

        {/* Main content wrapper with subtle glass effect */}
        <div className="relative z-0">
          {/* Render children defensively */}
          <SafeRenderer node={children} />
        </div>

        {/* Enhanced Toaster with eco-tech styling */}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: {
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(12px)',
              borderRadius: '16px',
              padding: '12px 16px',
              fontSize: '14px',
              fontWeight: '500',
              border: '1px solid rgba(226, 232, 240, 0.8)',
              boxShadow: '0 10px 40px rgba(47, 125, 91, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
            },
            success: {
              iconTheme: {
                primary: '#2F7D5B',
                secondary: 'white',
              },
              style: {
                border: '1px solid rgba(47, 125, 91, 0.2)',
              },
            },
            error: {
              iconTheme: {
                primary: '#EF4444',
                secondary: 'white',
              },
              style: {
                border: '1px solid rgba(239, 68, 68, 0.2)',
              },
            },
          }}
        />
      </body>
    </html>
  );
}
