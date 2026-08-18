import Link from "next/link";
import { ArrowRight, Zap, PiggyBank, CreditCard, GitBranch, Share2, ExternalLink } from "lucide-react";

const stats = [
  { label: "Total Value Locked", value: "$0" },
  { label: "Total Swaps", value: "0" },
  { label: "Active Users", value: "0" },
  { label: "Supported Tokens", value: "8" },
];

const features = [
  {
    icon: <Zap className="text-blue-400" size={28} />,
    title: "Instant Swaps",
    description: "Instant token swaps with sub-second finality on Arc Testnet. Lightning fast, zero friction.",
    color: "from-blue-500/10 to-transparent",
    border: "border-blue-500/20",
  },
  {
    icon: <PiggyBank className="text-emerald-400" size={28} />,
    title: "Earn Yield",
    description: "Deposit assets and earn real yield on your holdings. No minimums, no lock-ups.",
    color: "from-emerald-500/10 to-transparent",
    border: "border-emerald-500/20",
  },
  {
    icon: <CreditCard className="text-purple-400" size={28} />,
    title: "Borrow Freely",
    description: "Borrow against your collateral instantly. No credit check. No paperwork.",
    color: "from-purple-500/10 to-transparent",
    border: "border-purple-500/20",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center text-center px-4 pt-20 pb-24 overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full bg-blue-600/10 blur-[120px] pointer-events-none" />
        <div className="absolute top-32 left-1/2 -translate-x-1/2 w-[400px] h-[300px] rounded-full bg-indigo-600/10 blur-[80px] pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Live on Arc Testnet
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-tight tracking-tight mb-6">
            The Future of{" "}
            <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-400 bg-clip-text text-transparent">
              DeFi on Arc
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Swap tokens, earn yield, and borrow — all with USDC gas fees.{" "}
            <span className="text-gray-200 font-medium">Sub-second finality.</span>
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/swap"
              className="group inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base transition-all duration-200 shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 min-h-[52px]"
            >
              Launch App
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="https://docs.arc.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-[#2a2a3a] text-gray-300 hover:text-white hover:border-gray-500 font-medium text-base transition-all duration-200 min-h-[52px]"
            >
              View Docs
              <ExternalLink size={16} className="text-gray-500" />
            </a>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="px-4 pb-16 max-w-5xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center justify-center p-5 rounded-2xl border border-[#2a2a3a] text-center"
              style={{ background: "#13131a" }}
            >
              <div className="text-2xl sm:text-3xl font-bold text-white mb-1">{stat.value}</div>
              <div className="text-xs sm:text-sm text-gray-500 font-medium">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-4 pb-24 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Everything you need in DeFi</h2>
          <p className="text-gray-500">Powered by Arc Testnet's ultra-fast infrastructure</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`relative p-6 rounded-2xl border ${feature.border} overflow-hidden group hover:scale-[1.02] transition-transform duration-200`}
              style={{ background: "#13131a" }}
            >
              <div className={`absolute inset-0 bg-gradient-to-b ${feature.color} opacity-50`} />
              <div className="relative z-10">
                <div className="mb-4 w-12 h-12 rounded-xl bg-[#1c1c26] flex items-center justify-center">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1a1a2e] px-4 py-10">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-0.5 mb-1">
              <span className="text-lg font-bold text-white">Arc</span>
              <span className="text-lg font-bold text-blue-500">Flow</span>
              <span className="text-lg font-bold text-gray-400 ml-1">Finance</span>
            </div>
            <p className="text-gray-600 text-sm">ArcFlow Finance © 2026</p>
            <p className="text-gray-600 text-xs mt-1">Powered by Arc Testnet · Gas paid in USDC</p>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://twitter.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-gray-500 hover:text-white transition-colors text-sm"
            >
              <Share2 size={16} />
              Twitter
            </a>
            <span className="text-gray-700">·</span>
            <a
              href="https://discord.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-white transition-colors text-sm"
            >
              Discord
            </a>
            <span className="text-gray-700">·</span>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-gray-500 hover:text-white transition-colors text-sm"
            >
              <GitBranch size={16} />
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
