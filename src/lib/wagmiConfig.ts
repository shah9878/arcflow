import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";
import { WALLETCONNECT_PROJECT_ID } from "./constants";

// Safely guard against extension conflicts on window.ethereum
if (typeof window !== "undefined") {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, "ethereum");
    if (descriptor && !descriptor.configurable) {
      // Another extension has frozen window.ethereum — skip re-definition
      // This prevents "Cannot redefine property: ethereum" from crashing the app
    }
  } catch {
    // Ignore any errors during property inspection
  }
}

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  // Arc native USDC gas uses 18-dec precision; ERC-20 interface at 0x3600… uses 6-dec
  nativeCurrency: {
    decimals: 18,
    name: "USD Coin",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: "https://testnet.arcscan.app"
    },
  },
  testnet: true,
});

export const config = createConfig({
  chains: [arcTestnet],
  connectors: [
    // Use shimDisconnect:false to avoid Object.defineProperty on window.ethereum
    // which conflicts with extensions that freeze the property (Phantom, Coinbase, etc.)
    injected({ shimDisconnect: false }),
    walletConnect({ projectId: WALLETCONNECT_PROJECT_ID }),
  ],
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
  },
});

export const wagmiConfig = config;
