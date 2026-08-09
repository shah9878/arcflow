"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LENDING_ACCOUNT_QUERY_KEY,
  LENDING_MARKET_QUERY_KEY,
} from "@/hooks/useLendingMarket";

/**
 * Force-refresh all lend/borrow UI data after a successful on-chain tx.
 * Invalidates market + account queries (and ERC-20 balance reads) so the
 * lend page updates immediately without a full page reload.
 */
export function useRefreshLending() {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    // Brief delay so public RPC nodes catch up with the mined block
    await new Promise((r) => setTimeout(r, 400));

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [LENDING_MARKET_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: [LENDING_ACCOUNT_QUERY_KEY] }),
      // wagmi v2 read hooks use these prefixes
      queryClient.invalidateQueries({ queryKey: ["readContract"] }),
      queryClient.invalidateQueries({ queryKey: ["readContracts"] }),
      queryClient.invalidateQueries({ queryKey: ["balance"] }),
    ]);

    // Second pass shortly after for stubborn RPCs / multicall lag
    await new Promise((r) => setTimeout(r, 1200));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [LENDING_MARKET_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: [LENDING_ACCOUNT_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: ["readContract"] }),
      queryClient.invalidateQueries({ queryKey: ["balance"] }),
    ]);
  }, [queryClient]);
}
