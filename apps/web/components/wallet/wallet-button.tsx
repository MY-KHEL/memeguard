"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { api, ApiError } from "@/lib/api-client";
import { shortAddress } from "@/lib/format";
import { useSession } from "./session-provider";
import { Button } from "@/components/ui/button";

function walletErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) {
    const m = err.message.toLowerCase();
    if (m.includes("reject") || m.includes("cancel") || m.includes("user")) return "Rejected in the wallet. Click Connect wallet to try again.";
    return err.message;
  }
  return "Wallet connection failed";
}

export function WalletButton() {
  const { publicKey, signMessage, connected, disconnect, connecting, wallets, wallet, select, connect } = useWallet();
  const { setVisible } = useWalletModal();
  const { me, refresh, logout, loading } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef<string | null>(null);
  const connectStarted = useRef(false);

  const installed = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    const address = publicKey.toBase58();
    attempted.current = address;
    setBusy(true);
    setError(null);
    try {
      const nonce = await api.authNonce(address);
      const sig = await signMessage(new TextEncoder().encode(nonce.message));
      await api.authVerify(address, bs58.encode(sig));
      await refresh();
    } catch (err) {
      setError(walletErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [publicKey, signMessage, refresh]);

  // WalletModal only select()s. autoConnect is off, so we must connect after a choice.
  useEffect(() => {
    if (me || connected || connecting || !wallet || connectStarted.current) return;
    connectStarted.current = true;
    void connect().catch((err: unknown) => {
      setError(walletErrorMessage(err));
      connectStarted.current = false;
    });
  }, [wallet, connected, connecting, me, connect]);

  useEffect(() => {
    if (!wallet) connectStarted.current = false;
  }, [wallet]);

  useEffect(() => {
    if (me || !connected || !publicKey || !signMessage || busy) return;
    const address = publicKey.toBase58();
    if (attempted.current === address) return;
    void signIn();
  }, [me, connected, publicKey, signMessage, busy, signIn]);

  async function signOut() {
    attempted.current = null;
    connectStarted.current = false;
    setError(null);
    await logout();
    if (connected) await disconnect();
  }

  function handleClick() {
    if (connected) {
      void signIn();
      return;
    }
    const phantom = installed.find((w) => w.adapter.name === "Phantom");
    const preferred = phantom ?? installed[0];
    if (preferred) {
      setError(null);
      select(preferred.adapter.name);
      return;
    }
    setError("Open http://localhost:3000 in Chrome or Brave with Phantom installed. Cursor preview cannot see the extension.");
    setVisible(true);
  }

  if (loading) return <span className="text-xs text-muted-foreground">…</span>;

  if (me) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{shortAddress(me.wallet, 4)}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>
          Disconnect
        </Button>
      </div>
    );
  }

  const label = busy ? "Signing…" : connecting ? "Connecting…" : connected ? "Sign in" : "Connect wallet";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {error ? <span className="hidden max-w-[14rem] text-right text-[11px] text-destructive md:block">{error}</span> : null}
        <Button type="button" size="sm" disabled={busy || connecting} onClick={handleClick}>
          <span className="sm:hidden">{busy ? "Signing…" : connecting ? "…" : connected ? "Sign in" : "Connect"}</span>
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </div>
      {error ? <p className="max-w-[16rem] text-right text-[11px] text-destructive md:hidden">{error}</p> : null}
      {installed.length === 0 ? (
        <p className="max-w-[16rem] text-right text-[11px] text-muted-foreground">
          Open http://localhost:3000 in Chrome or Brave with Phantom installed. Cursor preview cannot see the extension.
        </p>
      ) : null}
    </div>
  );
}
