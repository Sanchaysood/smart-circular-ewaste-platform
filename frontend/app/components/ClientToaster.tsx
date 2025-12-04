// app/components/ClientToaster.tsx
"use client";

import React from "react";
import { Toaster } from "react-hot-toast";

export default function ClientToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3500,
        style: {
          borderRadius: "8px",
          padding: "8px 12px",
          fontSize: "14px",
        },
      }}
    />
  );
}
