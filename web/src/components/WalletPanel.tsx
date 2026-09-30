"use client";

import { useState } from "react";
import { useWallet, CHAIN_ID } from "@/lib/wallet";
import { shortAddress } from "@/lib/format";

/**
 * The connection control.
 *
 * Written so a reader can tell three things apart that dApps usually blur: which
 * wallet is present, whether it is on the right network, and whether the app
 * holds a key. It does not, and saying so is part of the interface rather than a
 * footnote, because this app points at a trust whose entire claim is that its
 * operator cannot take the money.
 */
export function WalletPanel() {
  const { address, wallets, selected, onStudionet, busy, error, connect, disconnect, switchNetwork } = useWallet();
  const [open, setOpen] = useState(false);

  if (!wallets.length) {
    return (
      <div className="wallet">
        <span className="wallet-none">No EVM wallet found in this browser</span>
        <span className="wallet-note">Reading needs no wallet. Sending a transaction does.</span>
      </div>
    );
  }

  if (address && !open) {
    return (
      <div className="wallet">
        <span className="wallet-addr" title={address}>
          {shortAddress(address)}
        </span>
        {!onStudionet ? (
          <button className="wallet-action warn" type="button" onClick={switchNetwork} disabled={busy}>
            Wrong network
          </button>
        ) : (
          <span className="wallet-ok">Studionet</span>
        )}
        <button className="wallet-action" type="button" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Account"}
        </button>
      </div>
    );
  }

  if (address && open) {
    return (
      <div className="wallet wallet-open">
        <dl className="wallet-detail">
          <dt>Connected</dt>
          <dd className="wrap">{address}</dd>
          <dt>Network</dt>
          <dd>{onStudionet ? `Studionet (${CHAIN_ID})` : `wrong network, expected ${CHAIN_ID}`}</dd>
          <dt>Wallet</dt>
          <dd>{selected === "rabby" ? "Rabby" : "MetaMask"}</dd>
        </dl>
        <p className="wallet-note">
          Signing happens in your wallet. This app holds no key and cannot move money on its own.
        </p>
        <div className="wallet-buttons">
          {!onStudionet ? (
            <button className="wallet-action warn" type="button" onClick={switchNetwork} disabled={busy}>
              Switch to Studionet
            </button>
          ) : null}
          <button className="wallet-action" type="button" onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
        </div>
        {error ? <p className="wallet-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="wallet wallet-open">
      <p className="wallet-note">Connect a wallet to fund this trust, propose, or vote.</p>
      <div className="wallet-buttons">
        {wallets.map((w) => (
          <button key={w.id} className="wallet-action primary" type="button" onClick={() => connect(w.id)} disabled={busy}>
            {w.icon ? <img className="wallet-icon" src={w.icon} alt="" aria-hidden /> : null}
            {busy ? "Connecting…" : `Connect ${w.name}`}
          </button>
        ))}
      </div>
      {error ? <p className="wallet-error">{error}</p> : null}
    </div>
  );
}
