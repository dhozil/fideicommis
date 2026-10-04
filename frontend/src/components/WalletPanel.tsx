"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/explorer";
import { WalletChooser } from "@/components/WalletChooser";

/**
 * Connecting a wallet, in the chrome of every page.
 *
 * It lives in the header rather than on the trust page because connecting is not a
 * property of one trust. Someone who lands on the directory, reads how it works and
 * only then decides to act should not have to find a trust first in order to connect —
 * and once connected, the address and the disconnect control stay put instead of
 * scrolling away with the record they were reading.
 *
 * `compact` is the header variant: one line, no panel chrome, because the header is
 * 64px tall and a card there would push the nav around as it changes between connected
 * and not. The full panel still exists for the trust page, where there is room for the
 * figures and the actions.
 *
 * The failure states are the ones that actually happen, and none of them is "something
 * went wrong": no wallet installed, discovery still running, the user cancelled, the
 * wallet is locked, the wrong chain, or a network their wallet has never heard of.
 */
export function WalletPanel({ compact = false }: { compact?: boolean }) {
  const wallet = useWallet();
  const [choosing, setChoosing] = useState(false);
  const [open, setOpen] = useState(false);

  // The compact form is a summary line rather than a card, and it reveals the full
  // account detail on demand so the header does not grow a paragraph when connected.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const summary = wallet.settling
    ? "Looking…"
    : wallet.address
      ? shortAddress(wallet.address)
      : wallet.wallets.length
        ? `${wallet.wallets.length} wallet${wallet.wallets.length === 1 ? "" : "s"}`
        : "No wallet";

  return (
    <div className={`wallet${compact ? " is-compact" : ""}`}>
      {!wallet.address ? (
        <>
          {compact ? (
            <button
              type="button"
              className="wallet-connect"
              onClick={() => setChoosing(true)}
              disabled={wallet.busy}
            >
              {wallet.busy ? "Wait…" : "Connect wallet"}
            </button>
          ) : (
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
          )}
        </>
      ) : (
        <>
          {compact ? (
            <div className="wallet-summary">
              <button
                type="button"
                className="wallet-address"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen((value) => !value);
                }}
                aria-expanded={open}
                title={wallet.address}
              >
                {summary}
              </button>
              <button
                type="button"
                className="wallet-disconnect"
                onClick={() => wallet.disconnect()}
                disabled={wallet.busy}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <span className="eyebrow" style={{ marginBottom: 6 }}>
                Connected
              </span>
              <p
                className="data"
                style={{ margin: "0 0 10px", fontSize: "0.82rem", wordBreak: "break-all" }}
              >
                {wallet.address}
              </p>
              {!wallet.onStudionet ? (
                <button type="button" onClick={() => wallet.switchNetwork()} disabled={wallet.busy}>
                  {wallet.busy ? "Switching…" : "Switch to Studionet"}
                </button>
              ) : (
                <span className="seal" style={{ color: "var(--verified)" }}>
                  Studionet
                </span>
              )}
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={wallet.disconnect} disabled={wallet.busy}>
                  Disconnect
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* The expanded account detail, on demand rather than always, so a connected
          reader does not carry a card in the header on every page. */}
      {compact && open && wallet.address ? (
        <div className="wallet-detail" onClick={(event) => event.stopPropagation()}>
          <span className="eyebrow" style={{ marginBottom: 6 }}>
            {wallet.wallets.find((w) => w.id === wallet.selected)?.name ?? "Wallet"}
          </span>
          <p className="data" style={{ margin: "0 0 10px", fontSize: "0.8rem", wordBreak: "break-all" }}>
            {wallet.address}
          </p>
          {!wallet.onStudionet ? (
            <button type="button" onClick={() => wallet.switchNetwork()} disabled={wallet.busy}>
              {wallet.busy ? "Switching…" : "Switch to Studionet"}
            </button>
          ) : (
            <span className="seal" style={{ color: "var(--verified)" }}>
              Studionet
            </span>
          )}
        </div>
      ) : null}

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
        <p className="wallet-error" role="alert">
          {wallet.error}
        </p>
      ) : null}
    </div>
  );
}