"use client";

import { useCallback } from "react";
import { useAccount, useConfig } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { readContract } from "wagmi/actions";
import { formatUnits } from "viem";
import { LENDING_POOL_ABI, LENDING_POOL_ADDRESS } from "@/lib/contracts";
import { LENDING_ACCOUNT_QUERY_KEY } from "@/hooks/useLendingMarket";

type AccountTuple = [bigint, bigint, bigint];

export function useHealthFactor() {
  const { address, isConnected } = useAccount();
  const config = useConfig();

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: [LENDING_ACCOUNT_QUERY_KEY, LENDING_POOL_ADDRESS, address ?? "none"],
    enabled: !!address && isConnected,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<AccountTuple | null> => {
      if (!address) return null;
      const result = (await readContract(config, {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "getUserAccountData",
        args: [address],
      })) as AccountTuple;
      return result;
    },
  });

  const result = data ?? undefined;

  const totalCollateralUSD = result ? parseFloat(formatUnits(result[0], 18)) : 0;
  const totalDebtUSD = result ? parseFloat(formatUnits(result[1], 18)) : 0;

  let healthFactor: number | null = null;
  if (result && result[2] !== undefined) {
    const rawVal = result[2];
    // If debt is 0, health factor is uint256 max
    if (rawVal === 115792089237316195423570985008687907853269984665640564039457584007913129639935n) {
      healthFactor = null;
    } else {
      const val = parseFloat(formatUnits(rawVal, 18));
      healthFactor = val > 100 || !isFinite(val) ? null : val;
    }
  }

  const maxBorrow = totalCollateralUSD * 0.8; // 80% liquidation threshold
  const availableBorrowUSD = Math.max(0, maxBorrow - totalDebtUSD);

  const refetchAll = useCallback(async () => {
    return refetch();
  }, [refetch]);

  return {
    healthFactor,
    totalCollateralUSD,
    totalDebtUSD,
    availableBorrowUSD,
    // Initial load only — background poll must not swap numbers for skeletons
    isLoading: isPending && !data,
    isRefreshing: isFetching && !!data,
    error,
    refetch: refetchAll,
  };
}
