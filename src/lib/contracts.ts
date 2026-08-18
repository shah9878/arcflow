/**
 * ArcFlow contract config — paste addresses here after you deploy.
 *
 * Deploy order (Remix / Foundry / Hardhat — your choice):
 *  1. ArcFlowPriceOracle
 *  2. Oracle.setPrices([...tokens], [...prices])  // 1e18 = $1 per whole token
 *  3. ArcFlowLendingPool(oracleAddress)
 *  4. Pool.addSupportedAssets(tokens, baseRates, rateMultipliers)
 *  5. Replace the three addresses below
 *
 * Arc Testnet market tokens (ERC-20 amounts use token decimals):
 *  USDC   0x3600000000000000000000000000000000000000  (6 dec ERC-20; native gas is 18-dec view of same balance)
 *  EURC   0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a  (6 dec)
 *  cirBTC 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF  (8 dec)
 *
 * Oracle prices (USD per whole token, 1e18 = $1):
 *  USDC   = $1     → 1000000000000000000
 *  EURC   = $1.25  → 1250000000000000000
 *  cirBTC = $65000 → 65000000000000000000000
 *
 * setPrices tokens[] (same order as TOKEN_LIST):
 *  [USDC, EURC, cirBTC]
 * setPrices priceValues[]:
 *  [1000000000000000000, 1250000000000000000, 65000000000000000000000]
 *
 * Suggested rates (18-dec APR fraction; frontend shows apr% = rate/1e18 * 100):
 *  baseRate       20000000000000000   // 2%
 *  rateMultiplier 100000000000000000  // +10% at 100% util
 */

/** Oracle USD prices scaled by 1e18 — use when calling setPrice / setPrices after deploy */
export const ORACLE_PRICES = {
  USDC: 1_000_000_000_000_000_000n, // $1
  EURC: 1_250_000_000_000_000_000n, // $1.25
  cirBTC: 65_000_000_000_000_000_000_000n, // $65,000
} as const;

// ─── Paste deployed addresses ───────────────────────────────────────────────
// Deployed 2026-08-09 to Arc Testnet (see arcflow-contracts/deployments/arcTestnet.json)
export const SWAP_ROUTER_ADDRESS =
  "0x99e88B979f028D0ac63165AA2FFb9a22539309E7" as `0x${string}`;

/** DEX Router adapter — AppKit fallback on Arc Testnet */
export const ACHSWAP_ADAPTER_ADDRESS =
  "0xF82c88FbF46E109a3865647E5c4d4834b31f8AFB" as `0x${string}`;

/** ArcFlowLendingPool — must have contract code on Arc testnet */
export const LENDING_POOL_ADDRESS =
  "0xe9886fE76d194CE2cD6d9b6EB8733Ec53536c45d" as `0x${string}`;

/** ArcFlowPriceOracle */
export const PRICE_ORACLE_ADDRESS =
  "0xe92f8256EF01D6fC82053017184Df164E9094141" as `0x${string}`;

// ─── Arc native USDC (ERC-20 interface) ─────────────────────────────────────
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as `0x${string}`;

/** True when address is zero / empty placeholder */
export function isConfiguredAddress(addr: `0x${string}` | string): boolean {
  return !!addr && addr !== "0x0000000000000000000000000000000000000000";
}

export const SWAP_ROUTER_ABI = [
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const PRICE_ORACLE_ABI = [
  {
    name: "getPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tryGetPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setPrice",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setPrices",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokens", type: "address[]" },
      { name: "priceValues", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

/** Matches ArcFlowLendingPool public surface used by the app */
export const LENDING_POOL_ABI = [
  {
    name: "getSupportedAssets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "assets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "isSupported", type: "bool" },
      { name: "totalSupplied", type: "uint256" },
      { name: "totalBorrowed", type: "uint256" },
      { name: "lastUpdateTime", type: "uint256" },
      { name: "baseRate", type: "uint256" },
      { name: "rateMultiplier", type: "uint256" },
    ],
  },
  {
    name: "getBorrowRate",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getSupplyRate",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getUserAccountData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralValueUSD", type: "uint256" },
      { name: "totalBorrowValueUSD", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
  {
    name: "supplyShares",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "borrowShares",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "supplySharesToAmount",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "shares", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "borrowSharesToAmount",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "shares", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "oracle",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "repay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "addSupportedAsset",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "baseRate", type: "uint256" },
      { name: "rateMultiplier", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "addSupportedAssets",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokens", type: "address[]" },
      { name: "baseRates", type: "uint256[]" },
      { name: "rateMultipliers", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;
