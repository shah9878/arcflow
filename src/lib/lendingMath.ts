import { formatUnits, parseUnits } from "viem";
import { ORACLE_PRICES } from "@/lib/contracts";
import type { Token } from "@/lib/tokenList";

/** Matches ArcFlowLendingPool.LIQUIDATION_THRESHOLD (0.8e18) */
export const LIQUIDATION_THRESHOLD = 0.8;

/**
 * Small buffer so rounding / share math doesn't push HF just under 1.0
 * and trip HEALTH_FACTOR_BELOW_THRESHOLD on-chain.
 */
export const HF_SAFETY_BUFFER = 1.002;

type OracleSymbol = keyof typeof ORACLE_PRICES;

export function getTokenUsdPrice(symbol: string): number {
  const key = symbol as OracleSymbol;
  const raw = ORACLE_PRICES[key];
  if (!raw) return 1;
  return Number(raw) / 1e18;
}

/**
 * Health factor after removing `withdrawAmount` of `token` from collateral.
 * null = infinite (no debt).
 */
export function previewHealthFactorAfterWithdraw(
  totalCollateralUSD: number,
  totalDebtUSD: number,
  tokenSymbol: string,
  withdrawAmount: number
): number | null {
  if (totalDebtUSD <= 0) return null;
  const price = getTokenUsdPrice(tokenSymbol);
  const newCollateral = Math.max(0, totalCollateralUSD - withdrawAmount * price);
  if (newCollateral <= 0) return 0;
  const hf = (newCollateral * LIQUIDATION_THRESHOLD) / totalDebtUSD;
  return hf > 100 || !isFinite(hf) ? null : hf;
}

/**
 * Max token amount user can withdraw while keeping HF >= 1.0 (with safety buffer).
 * Capped by their supplied balance of that token.
 */
export function getMaxWithdrawable(
  token: Token,
  userSupplyAmount: bigint,
  totalCollateralUSD: number,
  totalDebtUSD: number
): { maxAmount: string; maxRaw: bigint; limitedByDebt: boolean } {
  const supplyHuman = parseFloat(formatUnits(userSupplyAmount, token.decimals));
  if (supplyHuman <= 0 || userSupplyAmount <= BigInt(0)) {
    return { maxAmount: "0", maxRaw: BigInt(0), limitedByDebt: false };
  }

  // No debt → full supply is withdrawable
  if (totalDebtUSD <= 0) {
    return {
      maxAmount: formatMaxDisplay(supplyHuman, token.decimals),
      maxRaw: userSupplyAmount,
      limitedByDebt: false,
    };
  }

  // HF >= 1  ⇔  collateral * 0.8 >= debt
  // Keep a buffer so post-withdraw HF stays slightly above 1.0
  const minCollateralUSD = (totalDebtUSD * HF_SAFETY_BUFFER) / LIQUIDATION_THRESHOLD;
  const maxWithdrawUSD = Math.max(0, totalCollateralUSD - minCollateralUSD);

  const price = getTokenUsdPrice(token.symbol);
  if (price <= 0) {
    return { maxAmount: "0", maxRaw: BigInt(0), limitedByDebt: true };
  }

  const maxByHf = maxWithdrawUSD / price;
  const limitedByDebt = maxByHf + 1e-12 < supplyHuman;
  const maxHuman = Math.max(0, Math.min(supplyHuman, maxByHf));

  // Floor to token decimals so we never overshoot on-chain
  let maxRaw = BigInt(0);
  try {
    maxRaw = parseUnits(floorToDecimals(maxHuman, token.decimals), token.decimals);
  } catch {
    maxRaw = BigInt(0);
  }
  if (maxRaw > userSupplyAmount) maxRaw = userSupplyAmount;

  return {
    maxAmount: formatUnits(maxRaw, token.decimals),
    maxRaw,
    limitedByDebt,
  };
}

function floorToDecimals(value: number, decimals: number): string {
  if (!isFinite(value) || value <= 0) return "0";
  const factor = 10 ** Math.min(decimals, 8);
  const floored = Math.floor(value * factor + 1e-12) / factor;
  return floored.toFixed(Math.min(decimals, 8)).replace(/\.?0+$/, "") || "0";
}

function formatMaxDisplay(value: number, decimals: number): string {
  return floorToDecimals(value, decimals);
}

/** Map raw contract reverts to readable UI copy */
export function friendlyLendingError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Transaction failed";

  if (raw.includes("HEALTH_FACTOR_BELOW_THRESHOLD")) {
    return "Withdraw/borrow would drop your health factor below 1.0. Repay some debt first, or withdraw a smaller amount (use MAX for the safe limit).";
  }
  if (raw.includes("INSUFFICIENT_SUPPLY_BALANCE")) {
    return "Not enough supplied balance to withdraw that amount.";
  }
  if (raw.includes("INSUFFICIENT_POOL_LIQUIDITY")) {
    return "Pool does not have enough liquidity for this borrow right now.";
  }
  if (raw.includes("NO_DEBT")) {
    return "No debt to repay for this asset.";
  }
  if (raw.includes("User rejected") || raw.includes("user rejected") || raw.includes("denied")) {
    return "Transaction rejected in wallet.";
  }

  // Shorten huge viem dumps
  const hfMatch = raw.match(/ArcFlowLendingPool: ([A-Z0-9_]+)/);
  if (hfMatch) return `Pool rejected: ${hfMatch[1].replace(/_/g, " ").toLowerCase()}`;

  if (raw.length > 180) return raw.slice(0, 180) + "…";
  return raw;
}
