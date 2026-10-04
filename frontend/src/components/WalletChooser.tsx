"use client";

import { useEffect, useRef } from "react";
import type { DiscoveredWallet } from "@/lib/eip6963";

/**
 * Choose a wallet, out of the ones this browser actually has.
 *
 * The reason this is a panel rather than one button per wallet: with two EVM wallets
 * installed, `window.ethereum` is a race, and an app that reads it connects whichever
 * wallet injected last. So the app asks (EIP-6963), the wallet answers with its own name
 * and icon, and the user picks. Nothing is connected until a row is chosen — which is the
 * point of the standard as much as the feature.
 *
 * The states are kept apart deliberately, because "no wallet" and "still looking" are
 * different answers and a panel that says "no wallet found" while discovery is still
 * settling has told the user something false:
 *
 *   - nothing yet          discovery has not finished, and that is stated
 *   - none installed       discovery finished and announced nothing
 *   - a list               every wallet that announced, with the icon it supplied
 *   - one row              no wallet announced and window.ethereum was there, so the
 *                          browser wallet is offered as a single fallback
 */

export function WalletChooser({
  wallets,
  settling,
  busy,
  selected,
  onPick,
  onDismiss,
  onRequestAgain,
}: {
  wallets: DiscoveredWallet[];
  settling: boolean;
  busy: boolean;
  selected: string | null;
  onPick: (id: string) => void;
  onDismiss: () => void;
  onRequestAgain: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const firstRow = useRef<HTMLButtonElement>(null);

  // Focus the first row so the panel is usable from the keyboard the moment it opens.
  useEffect(() => {
    if (wallets.length) firstRow.current?.focus();
  }, [wallets.length]);

  // Escape closes, and Tab stays inside while it is open. A modal that leaks focus to
  // the page behind it is a modal a keyboard user cannot get out of.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDismiss();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>("button")];
      // Spreading a NodeList: `querySelectorAll` is not an array, so indexing it under
      // `noUncheckedIndexedAccess` is possibly-undefined even after a length check.
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // One row that is not an announced wallet means the browser wallet was found by
  // reading window.ethereum, and the panel says so rather than presenting it as if it
  // had announced itself.
  const only = wallets.length === 1 ? wallets[0] : undefined;
  const legacy = only !== undefined && !only.announced;

  return (
    <div className="wallet-modal" onMouseDown={onDismiss}>
      <div
        className="wallet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-chooser-title"
        ref={panel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="wallet-head">
          <h3 id="wallet-chooser-title">Connect a wallet</h3>
          <button type="button" className="wallet-close" onClick={onDismiss} aria-label="Close">
            ×
          </button>
        </div>

        {wallets.length ? (
          <>
            <ul className="wallet-list">
              {wallets.map((wallet, index) => (
                <li key={wallet.id}>
                  <button
                    type="button"
                    className={`wallet-row${selected === wallet.id ? " is-current" : ""}`}
                    onClick={() => onPick(wallet.id)}
                    disabled={busy}
                    ref={index === 0 ? firstRow : undefined}
                  >
                    <WalletIcon wallet={wallet} />
                    <span className="wallet-name">
                      {wallet.name}
                      {selected === wallet.id ? <span className="wallet-tag">connected</span> : null}
                    </span>
                    {wallet.announced ? null : (
                      <span className="wallet-tag" title="This wallet does not support EIP-6963">
                        fallback
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {legacy ? (
              <p className="wallet-foot">
                This wallet did not announce itself, so it was found by reading{" "}
                <code>window.ethereum</code> directly. That is how one wallet is found
                when several are installed.
              </p>
            ) : (
              <p className="wallet-foot">
                Announced by each wallet over EIP-6963, so nothing here was guessed.
              </p>
            )}
          </>
        ) : settling ? (
          <p className="wallet-foot">
            Looking for wallets…
          </p>
        ) : (
          <div className="wallet-empty">
            <p className="wallet-foot" style={{ marginTop: 0 }}>
              No EVM wallet answered in this browser.
            </p>
            <p className="wallet-foot">
              A wallet is what holds your key, and this site never sees it — connecting is
              only how a transaction gets signed. Install one, then reload this page.
            </p>
            <div className="wallet-installs">
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer noopener">
                MetaMask
              </a>
              <a href="https://rabby.io/download" target="_blank" rel="noreferrer noopener">
                Rabby
              </a>
            </div>
            <button type="button" className="wallet-again" onClick={onRequestAgain}>
              Check again
            </button>
          </div>
        )}

        <p className="wallet-foot" style={{ marginBottom: 0 }}>
          Your key stays in your wallet. Nothing is sent to this site.
        </p>
      </div>
    </div>
  );
}

/**
 * A wallet's own icon, with a letter for one that supplies none.
 *
 * The icon is a data: URI the wallet handed over, so it goes in an <img src> and is
 * never treated as markup. On error it falls back to the letter rather than leaving a
 * broken image, because a wallet that supplies a URL this browser cannot load is
 * exactly the case where the name matters most.
 */
function WalletIcon({ wallet }: { wallet: DiscoveredWallet }) {
  return wallet.icon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="wallet-icon"
      src={wallet.icon}
      alt=""
      width={26}
      height={26}
      onError={(event) => {
        const img = event.currentTarget;
        const letter = wallet.name.trim().charAt(0).toUpperCase() || "?";
        img.style.display = "none";
        const holder = img.parentElement;
        if (holder && !holder.querySelector(".wallet-letter")) {
          const span = document.createElement("span");
          span.className = "wallet-letter";
          span.textContent = letter;
          span.setAttribute("aria-hidden", "true");
          holder.prepend(span);
        }
      }}
    />
  ) : (
    <span className="wallet-letter" aria-hidden="true">
      {wallet.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}