"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/explorer";
import { WalletChooser } from "@/components/WalletChooser";

/**
 * Connecting a wallet.
 *
 * The button opens a list of the wallets this browser has, discovered over EIP-6963,
 * rather than connecting on click. That is deliberate: `window.ethereum` is a single
 * slot that several wallets write to, so an app that reads it connects whichever one
 * injected last. Asking first is what makes the choice the user's.
 *
 * The failure states are the ones that actually happen, and none of them is "something
 * went wrong": no wallet installed, discovery still running, the user cancelled, the
 * wallet is locked, the wrong chain, or a network their wallet has never heard of.
 */
export function WalletPanel() {
  const wallet = useWallet();
  const [choosing, setChoosing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="panel" style={{ padding: 14, minWidth: 250 }}>
      {!wallet.address ? (
        <>
          <span className="eyebrow" style={{ marginBottom: 8 }}>
            Act on a trust
          </span>
          <button type="button" onClick={() => setChoosing(true)} disabled={wallet.busy}>
            Connect wallet
          </button>
          <p className="faint" style={{ fontSize: "0.78rem", margin: "10px 0 0" }}>
            {wallet.settling
              ? "Looking for installed wallets…"
              : wallet.wallets.length
                ? `${wallet.wallets.length} wallet${wallet.wallets.length === 1 ? "" : "s"} available — you pick which one.`
                : "No wallet detected. This page reads without one."}
          </p>
        </>
      ) : (
        <>
          <span className="eyebrow" style={{ marginBottom: 6 }}>
            Connected
          </span>
          <p
            className="data"
            style={{ margin: "0 0 10px", fontSize: "0.82rem", wordBreak: "break-all" }}
          >
            {shortAddress(wallet.address)}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!wallet.onStudionet ? (
              <button type="button" onClick={() => wallet.switchNetwork()} disabled={wallet.busy}>
                {wallet.busy ? "Switching…" : "Switch to Studionet"}
              </button>
            ) : (
              <span className="seal" style={{ color: "var(--verified)" }}>
                Studionet
              </span>
            )}
            <button type="button" onClick={wallet.disconnect} disabled={wallet.busy}>
              Disconnect
            </button>
          </div>
          {copied ? (
            <p className="faint" style={{ fontSize: "0.78rem", margin: "10px 0 0" }}>
              Address copied.
            </p>
          ) : null}
        </>
      )}

      {choosing ? (
        <WalletChooser
          wallets={wallet.wallets}
          settling={wallet.settling}
          busy={wallet.busy}
          selected={wallet.selected}
          onDismiss={() => setChoosing(false)}
          onRequestAgain={wallet.refresh}
          onPick={async (id) => {
            setChoosing(false);
            await wallet.connect(id);
          }}
        />
      ) : null}

      {wallet.error ? (
        <p
          role="alert"
          style={{
            margin: "12px 0 0",
            fontSize: "0.82rem",
            color: "var(--breach)",
            maxWidth: "none",
          }}
        >
          {wallet.error}
        </p>
      ) : null}
    </div>
  );
}