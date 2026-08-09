"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { useState, useEffect } from "react";
import { installCircleFetchPatch } from "@/lib/patchCircleFetch";

installCircleFetchPatch();

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Poll/refresh at most every 30s; tx success still force-refetches
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  // Suppress "Cannot redefine property: ethereum" errors thrown by browser
  // wallet extensions (Phantom, Coinbase, etc.) that fight over window.ethereum.
  // This is an extension-level conflict the app cannot control.
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      if (event.message?.includes("Cannot redefine property: ethereum")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("error", handler, true);
    return () => window.removeEventListener("error", handler, true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
