"use client";

import { useState } from "react";
import { useConnect } from "wagmi";
import { X, Wallet, AlertCircle, Link } from "lucide-react";

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WALLET_LOGOS: Record<string, string> = {
  injected:
    "https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg",
  metaMask:
    "https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg",
  walletConnect: "https://avatars.githubusercontent.com/u/37784886",
  rabby: "https://raw.githubusercontent.com/RabbyHub/logo/master/avatar.svg",
};

/** Resolve logo URL by connector id, falling back to a name-based lookup. */
function getLogoUrl(id: string, name: string): string | undefined {
  if (WALLET_LOGOS[id]) return WALLET_LOGOS[id];
  const nameLower = name.toLowerCase();
  if (nameLower.includes("metamask")) return WALLET_LOGOS["metaMask"];
  if (nameLower.includes("walletconnect")) return WALLET_LOGOS["walletConnect"];
  if (nameLower.includes("rabby")) return WALLET_LOGOS["rabby"];
  return undefined;
}

/** Per-wallet logo with an error fallback */
function WalletLogo({ id, name }: { id: string; name: string }) {
  const [errored, setErrored] = useState(false);
  const logoUrl = getLogoUrl(id, name);

  if (logoUrl && !errored) {
    return (
      <img
        src={logoUrl}
        alt={name}
        width={28}
        height={28}
        onError={() => setErrored(true)}
        className="object-contain"
        style={{ width: 28, height: 28 }}
      />
    );
  }

  // Fallback: chain-link icon from lucide
  return <Link size={20} className="text-gray-400" />;
}

/** Hide Phantom (and any other wallets we do not support on Arc Testnet). */
function isHiddenConnector(connector: { id: string; name: string; type?: string }): boolean {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  // EIP-6963 rdns / ids for Phantom: app.phantom, io.phantom, phantom
  if (name.includes("phantom") || id.includes("phantom")) return true;
  return false;
}

export function ConnectModal({ isOpen, onClose }: ConnectModalProps) {
  const { connect, connectors, isPending, error } = useConnect();

  if (!isOpen) return null;

  const visibleConnectors = connectors.filter((c) => !isHiddenConnector(c));

  const handleConnect = (connector: (typeof connectors)[0]) => {
    connect({ connector }, { onSuccess: () => onClose() });
  };

  const connectorLabels: Record<string, string> = {
    injected: "MetaMask",
    walletConnect: "WalletConnect",
    metaMask: "MetaMask",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full sm:w-[400px] bg-[#13131a] border border-[#2a2a3a] rounded-2xl p-6 shadow-2xl z-10 sm:max-h-auto max-h-screen overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Wallet className="text-blue-400" size={20} />
            <h2 className="text-lg font-semibold text-white">Connect Wallet</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-gray-400 text-sm mb-6">
          Connect your wallet to start swapping, lending, and borrowing on Arc Testnet.
        </p>

        <div className="space-y-3">
          {visibleConnectors.map((connector) => (
            <button
              key={connector.uid}
              onClick={() => handleConnect(connector)}
              disabled={isPending}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-[#2a2a3a] hover:border-blue-500/50 bg-[#1c1c26] hover:bg-[#1e1e2e] transition-all duration-200 min-h-[60px] group"
            >
              <div className="w-10 h-10 rounded-full bg-[#2a2a3a] flex items-center justify-center group-hover:scale-110 transition-transform overflow-hidden">
                <WalletLogo id={connector.id} name={connector.name} />
              </div>
              <div className="text-left">
                <div className="text-white font-medium">
                  {connectorLabels[connector.id] || connector.name}
                </div>
                <div className="text-gray-500 text-xs">
                  {connector.id === "injected" || connector.id === "metaMask" || connector.type === "injected"
                    ? "Browser Extension"
                    : "Mobile & Desktop"}
                </div>
              </div>
              {isPending && (
                <div className="ml-auto w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error.message.includes("rejected") ? "Connection rejected by user" : error.message}</span>
          </div>
        )}

        <p className="mt-6 text-center text-gray-600 text-xs">
          By connecting, you agree that this is a testnet with no real value.
        </p>
      </div>
    </div>
  );
}
