"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/explorer";

/**
 * Connecting a wallet.
 *
 * Discovery is EIP-6963 rather than a list of window.ethereum sniff, so the page
 * does not have to guess which wallet is installed. Signing happens in the browser
 * through the injected provider; this site never sees a key, which is why it can
 * offer to act on a trust without asking anyone to trust it with anything.
 *
 * The failure states are the ones that actually happen and none of them are
 * "something went wrong": no wallet installed, the user dismissed the prompt,
 * rejected the request, switched to the wrong chain, or a network that is not in
 * their wallet at all.
 */
export function WalletPanel() {
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="panel" style={{ padding: 14, minWidth: 250 }}>
      {!wallet.wallets.length ? (
        <>
          <span className="eyebrow" style={{ marginBottom: 6 }}>
            No wallet found
          </span>
          <p className="muted" style={{ fontSize: "0.86rem", margin: 0 }}>
            This page reads without one. Install a wallet such as MetaMask or Rabby to
            fund the trust or advance its cycle.
          </p>
        </>
      ) : !wallet.address ? (
        <>
          <span className="eyebrow" style={{ marginBottom: 8 }}>
            Act on a trust
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {wallet.wallets.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => wallet.connect(entry.id)}
                disabled={wallet.busy}
                style={{ padding: "9px 13px", fontSize: "0.7rem" }}
              >
                {entry.name}
              </button>
            ))}
          </div>
          <p className="faint" style={{ fontSize: "0.78rem", margin: "10px 0 0" }}>
            Your key stays in the wallet. Nothing is sent to this site.
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
