"use client";

import { useCallback } from "react";
import { useAccount, useConfig } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readContract } from "wagmi/actions";
import { formatUnits } from "viem";
import { LENDING_POOL_ABI, LENDING_POOL_ADDRESS } from "@/lib/contracts";
import { LENDING_ACCOUNT_QUERY_KEY } from "@/hooks/useLendingMarket";

export function useHealthFactor() {
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [LENDING_ACCOUNT_QUERY_KEY, LENDING_POOL_ADDRESS, address ?? "none"],
    enabled: !!address && isConnected,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
    queryFn: async () => {
      if (!address) return null;
      const result = (await readContract(config, {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "getUserAccountData",
        args: [address],
      })) as [bigint, bigint, bigint];
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
    await queryClient.invalidateQueries({ queryKey: [LENDING_ACCOUNT_QUERY_KEY] });
    return refetch();
  }, [queryClient, refetch]);

  return {
    healthFactor,
    totalCollateralUSD,
    totalDebtUSD,
    availableBorrowUSD,
    isLoading: isLoading || isFetching,
    error,
    refetch: refetchAll,
  };
}
