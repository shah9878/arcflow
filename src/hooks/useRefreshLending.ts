"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LENDING_ACCOUNT_QUERY_KEY,
  LENDING_MARKET_QUERY_KEY,
} from "@/hooks/useLendingMarket";

/**
 * Soft-refresh lend/borrow UI after a confirmed tx.
 * Uses refetchQueries (keeps previous data painted) — never clears cache mid-flight,
 * so the page does not flicker skeletons or zero values.
 */
export function useRefreshLending() {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    // Short delay so public RPC has the mined block
    await new Promise((r) => setTimeout(r, 500));

    await Promise.all([
      queryClient.refetchQueries({
        queryKey: [LENDING_MARKET_QUERY_KEY],
        type: "active",
      }),
      queryClient.refetchQueries({
        queryKey: [LENDING_ACCOUNT_QUERY_KEY],
        type: "active",
      }),
      queryClient.refetchQueries({ queryKey: ["readContract"], type: "active" }),
      queryClient.refetchQueries({ queryKey: ["balance"], type: "active" }),
    ]);

    // One follow-up for laggy RPCs — still soft (placeholderData stays)
    await new Promise((r) => setTimeout(r, 1500));
    await Promise.all([
      queryClient.refetchQueries({
        queryKey: [LENDING_MARKET_QUERY_KEY],
        type: "active",
      }),
      queryClient.refetchQueries({
        queryKey: [LENDING_ACCOUNT_QUERY_KEY],
        type: "active",
      }),
      queryClient.refetchQueries({ queryKey: ["readContract"], type: "active" }),
      queryClient.refetchQueries({ queryKey: ["balance"], type: "active" }),
    ]);
  }, [queryClient]);
}
