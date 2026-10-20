"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { LiveProvider } from "@/lib/live";
import { SessionProvider } from "./session-provider";

import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletProviders({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <SessionProvider>
            <LiveProvider>{children}</LiveProvider>
          </SessionProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
