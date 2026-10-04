"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, chains } from "genlayer-js";
import { createWalletClient, custom, type WalletClient } from "viem";
import { EXPLORER_URL } from "./explorer";
import {
  useEip6963,
  type DiscoveredWallet,
  type Eip1193Provider,
} from "./eip6963";

/**
 * Wallet connection.
 *
 * Discovery is EIP-6963 and lives in `eip6963.ts`, which is where the reasoning about
 * the `window.ethereum` race lives. What this module does with a discovered wallet is
 * the rest: connect, track the account and chain, switch network, sign.
 *
 * The identifier is the wallet's own EIP-6963 uuid rather than a hardcoded union of
 * "metamask" | "rabby". That union was the previous shape and it was wrong twice over:
 * it made every wallet that is not one of those two invisible, and it meant the app had
 * to guess a name to display for anything it found. A wallet that announces itself
 * already knows its own name, icon and rdns, and the app's job is to show them rather
 * than to name them.
 *
 * One deliberate difference from a typical dApp: this app never holds a key. The provider
 * is only ever asked to sign, the connection is the user's own wallet, and no private key
 * exists anywhere in the build. That is what makes it safe to point at a trust whose
 * whole point is that its operator cannot take the money.
 */

const RPC_URL = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;

const NETWORK = {
  chainId: CHAIN_ID_HEX,
  chainName: process.env.NEXT_PUBLIC_GENLAYER_CHAIN_NAME ?? "GenLayer Studio",
  nativeCurrency: {
    name: process.env.NEXT_PUBLIC_GENLAYER_SYMBOL ?? "GEN",
    symbol: process.env.NEXT_PUBLIC_GENLAYER_SYMBOL ?? "GEN",
    decimals: 18,
  },
  rpcUrls: [RPC_URL],
  // This was `[process.env.NEXT_PUBLIC_EXPLORER_URL].filter(Boolean)`, which is an
  // empty list unless a deployment sets the variable — so a wallet that had not
  // added this chain itself would show it with no "View on explorer" link, and the
  // one thing a user needs after a transaction is somewhere to look the transaction
  // up. It now defaults to the real explorer, and the same constant the reader links
  // to is the one handed to the wallet, so the two cannot disagree.
  blockExplorerUrls: [EXPLORER_URL],
};

type Provider = Eip1193Provider;

/**
 * A wallet id is whatever the wallet called itself, so this is an opaque string rather
 * than a union of the two wallets this app was first written against.
 */
export type WalletId = string;

export type WalletOption = DiscoveredWallet;

export type WalletState = {
  address: string | null;
  wallets: WalletOption[];
  selected: WalletId | null;
  chainId: number | null;
  onStudionet: boolean;
  busy: boolean;
  error: string | null;
  /** True while announcements may still be arriving, so the UI can hold off claiming none. */
  settling: boolean;
  connect: (id?: WalletId) => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  refresh: () => void;
};

/** Which provider is in use. Set only by an explicit choice, never by a fallback read. */
let active: Provider | null = null;
let activeId: WalletId | null = null;

export function walletProvider(): Provider | null {
  return active;
}

/** The last discovered list, so non-hook callers can reach the chosen provider. */
let discovered: WalletOption[] = [];

export function availableWallets(): WalletOption[] {
  return discovered;
}

async function call(method: string, params: unknown[] = []): Promise<unknown> {
  const provider = walletProvider();
  if (!provider) throw new Error("No Ethereum wallet is connected");
  return provider.request({ method, params });
}

export async function addNetwork(): Promise<void> {
  try {
    await call("wallet_addEthereumChain", [NETWORK]);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4001) throw new Error("You rejected adding the network");
    throw new Error(`Could not add the GenLayer network: ${(error as Error).message}`);
  }
}

export async function switchNetwork(): Promise<void> {
  try {
    await call("wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }]);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4902) await addNetwork();
    else if (code === 4001) throw new Error("You rejected switching the network");
    else throw new Error(`Could not switch network: ${(error as Error).message}`);
  }
}

/** A signing client for the connected provider. Never holds key material. */
export function walletClient(): WalletClient | null {
  const provider = walletProvider();
  if (!provider) return null;
  try {
    return createWalletClient({ chain: chains.studionet as never, transport: custom(provider as never) });
  } catch {
    return null;
  }
}

export function useWallet(): WalletState {
  const { wallets, settling, requestAgain } = useEip6963();
  const [address, setAddress] = useState<string | null>(null);
  const [selected, setSelected] = useState<WalletId | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => requestAgain(), [requestAgain]);

  // Available to non-hook callers such as actions.ts, which signs through the provider
  // the user chose rather than reaching for window.ethereum.
  useMemo(() => {
    discovered = wallets;
  }, [wallets]);

  const connect = useCallback(
    async (id?: WalletId) => {
      setBusy(true);
      setError(null);
      try {
        if (id) {
          const option = wallets.find((w) => w.id === id);
          if (!option) {
            throw new Error(
              "That wallet is no longer available. Close this panel and open it again to " +
                "see the wallets this browser has.",
            );
          }
          active = option.provider;
          activeId = option.id;
          setSelected(option.id);
          if (typeof window !== "undefined") {
            localStorage.setItem("fideicommis_wallet", option.id);
            localStorage.setItem("fideicommis_wallet_rdns", option.rdns);
          }
        }
        if (!active) throw new Error("Choose a wallet first");

        const accounts = (await active.request({ method: "eth_requestAccounts" })) as string[];
        if (!accounts?.length) throw new Error("That wallet returned no accounts");
        setAddress(accounts[0] ?? null);

        const hex = (await active.request({ method: "eth_chainId" })) as string;
        setChainId(Number.parseInt(hex, 16));
        if (Number.parseInt(hex, 16) !== CHAIN_ID) await switchNetwork();
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setBusy(false);
      }
    },
    [wallets],
  );

  const disconnect = useCallback(() => {
    active = null;
    activeId = null;
    setAddress(null);
    setSelected(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("fideicommis_wallet");
      localStorage.removeItem("fideicommis_wallet_rdns");
    }
  }, []);

  // Track the connected wallet, not window.ethereum. Listening to the wrong provider is
  // how a UI shows an account that the wallet the user picked no longer controls.
  useEffect(() => {
    if (!active) return;
    const provider = active;
    const onAccounts = (accounts: string[] | undefined) => setAddress(accounts?.[0] ?? null);
    const onChain = (hex: string | undefined) => setChainId(hex ? Number.parseInt(hex, 16) : null);

    provider
      .request({ method: "eth_accounts" })
      .then((a) => onAccounts(a as string[]))
      .catch(() => undefined);
    provider
      .request({ method: "eth_chainId" })
      .then((c) => onChain(c as string))
      .catch(() => undefined);
    provider.on?.("accountsChanged", onAccounts as never);
    provider.on?.("chainChanged", onChain as never);

    return () => {
      provider.removeListener?.("accountsChanged", onAccounts as never);
      provider.removeListener?.("chainChanged", onChain as never);
    };
  }, [selected, wallets.length]);

  // A previously chosen wallet is restored without prompting. Matched on rdns, which is
  // stable across versions, rather than on the uuid, which changes on every page load —
  // so remembering the uuid would restore nothing after a refresh.
  useMemo(() => {
    if (selected || typeof window === "undefined" || !wallets.length) return;
    const savedRdns = localStorage.getItem("fideicommis_wallet_rdns");
    const savedId = localStorage.getItem("fideicommis_wallet");
    if (!savedRdns && !savedId) return;
    const option = wallets.find((w) => w.rdns === savedRdns) ?? wallets.find((w) => w.id === savedId);
    if (!option) {
      // The wallet this browser was using is not here any more. Say so by not guessing:
      // clearing the stored choice is better than silently selecting a different wallet.
      localStorage.removeItem("fideicommis_wallet");
      localStorage.removeItem("fideicommis_wallet_rdns");
      return;
    }
    active = option.provider;
    activeId = option.id;
    setSelected(option.id);
  }, [wallets, selected]);

  return {
    address,
    wallets,
    selected,
    chainId,
    onStudionet: chainId === CHAIN_ID,
    busy,
    error,
    settling,
    connect,
    disconnect,
    switchNetwork,
    refresh,
  };
}

/**
 * Turn a wallet's rejection into a sentence.
 *
 * EIP-1193 error 4001 is the user pressing cancel, and the message a provider sends with
 * it is often a wall of JSON that means nothing to the person who triggered it. Naming
 * the cancel is the difference between a user retrying and a user giving up.
 */
function friendlyError(error: unknown): string {
  const code = (error as { code?: number }).code;
  const message = (error as Error)?.message ?? "Something went wrong";
  if (code === 4001) return "You cancelled in your wallet.";
  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return "You cancelled in your wallet.";
  }
  if (code === -32002) return "That request is already open in your wallet.";
  if (/locked|unlock/i.test(message)) return "Your wallet is locked. Unlock it and try again.";
  return message.length > 220 ? `${message.slice(0, 220)}…` : message;
}

export { CHAIN_ID, CHAIN_ID_HEX, NETWORK, RPC_URL };
