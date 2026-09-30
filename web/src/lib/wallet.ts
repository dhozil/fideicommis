"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, chains } from "genlayer-js";
import { createWalletClient, custom, type WalletClient } from "viem";

/**
 * Wallet connection, EIP-6963.
 *
 * The shape here follows the StrataSure reader, because it is the established
 * convention in this workspace and a reviewer of either project should not have
 * to learn the same wallet plumbing twice. The discovery model is the part that
 * matters: EIP-6963 announces every installed EVM wallet by name, so the app
 * offers the wallet that is actually present instead of assuming MetaMask and
 * silently ignoring Rabby.
 *
 * One deliberate difference from a typical dApp: this app never holds a key.
 * The provider is only ever asked to sign, the connection is the user's own
 * wallet, and no private key exists anywhere in the build. That is what makes it
 * safe to point at a trust whose whole point is that its operator cannot take
 * the money.
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
  blockExplorerUrls: process.env.NEXT_PUBLIC_EXPLORER_URL ? [process.env.NEXT_PUBLIC_EXPLORER_URL] : [],
};

type Provider = {
  isMetaMask?: boolean;
  isRabby?: boolean;
  name?: string;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  /** EIP-1193 event API. Present on every real injected wallet. */
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

type ProviderInfo = { uuid: string; name: string; icon: string; rdns: string };
type ProviderDetail = { info: ProviderInfo; provider: Provider };

export type WalletId = "metamask" | "rabby";

export type WalletOption = {
  id: WalletId;
  name: string;
  icon: string;
  rdns: string;
  provider: Provider;
};

export type WalletState = {
  address: string | null;
  wallets: WalletOption[];
  selected: WalletId | null;
  chainId: number | null;
  onStudionet: boolean;
  busy: boolean;
  error: string | null;
  connect: (id?: WalletId) => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  refresh: () => void;
};

declare global {
  interface Window {
    ethereum?: Provider & { providers?: Provider[] };
  }
}

function kindOf(provider: Provider, info?: ProviderInfo): WalletId | null {
  const name = `${(provider as { name?: string }).name ?? ""} ${info?.name ?? ""}`.toLowerCase();
  const rdns = (info?.rdns ?? "").toLowerCase();
  if (provider.isRabby || name.includes("rabby") || rdns.includes("rabby")) return "rabby";
  if (provider.isMetaMask || name.includes("metamask") || rdns.includes("metamask")) return "metamask";
  return null;
}

function optionOf(provider: Provider, info?: ProviderInfo): WalletOption | null {
  const id = kindOf(provider, info);
  if (!id) return null;
  return { id, name: id === "metamask" ? "MetaMask" : "Rabby", icon: info?.icon ?? "", rdns: info?.rdns ?? id, provider };
}

const announced = new Map<string, WalletOption>();
let active: Provider | null = null;
let activeId: WalletId | null = null;

function legacy(): Provider[] {
  if (typeof window === "undefined" || !window.ethereum) return [];
  const list = window.ethereum.providers?.length ? window.ethereum.providers : [window.ethereum];
  return list.filter((p, i) => list.indexOf(p) === i);
}

export function availableWallets(): WalletOption[] {
  const found = new Map<string, WalletOption>();
  announced.forEach((o) => found.set(o.id, o));
  legacy().forEach((p) => {
    const o = optionOf(p);
    if (o) found.set(o.id, o);
  });
  return (["metamask", "rabby"] as WalletId[]).map((id) => found.get(id)).filter((o): o is WalletOption => Boolean(o));
}

export function walletProvider(): Provider | null {
  if (active) return active;
  if (typeof window !== "undefined" && window.ethereum) return window.ethereum;
  return availableWallets()[0]?.provider ?? null;
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
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [selected, setSelected] = useState<WalletId | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // EIP-6963 discovery, and the legacy fallback for wallets that never announce.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderDetail>).detail;
      if (!detail?.provider || !detail?.info) return;
      const option = optionOf(detail.provider, detail.info);
      if (option) {
        announced.set(option.id, option);
        setWallets(availableWallets());
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setWallets(availableWallets());

    const onAccounts = (accounts: string[] | undefined) => setAddress(accounts?.[0] ?? null);
    const onChain = (hex: string | undefined) => setChainId(hex ? Number.parseInt(hex, 16) : null);
    const provider = window.ethereum;
    provider?.request({ method: "eth_accounts" }).then((a) => onAccounts(a as string[])).catch(() => undefined);
    provider?.request({ method: "eth_chainId" }).then((c) => onChain(c as string)).catch(() => undefined);
    provider?.on?.("accountsChanged", onAccounts as never);
    provider?.on?.("chainChanged", onChain as never);

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      provider?.removeListener?.("accountsChanged", onAccounts as never);
      provider?.removeListener?.("chainChanged", onChain as never);
    };
  }, []);

  const connect = useCallback(
    async (id?: WalletId) => {
      setBusy(true);
      setError(null);
      try {
        if (id) {
          const option = availableWallets().find((w) => w.id === id);
          if (!option) throw new Error(`${id === "metamask" ? "MetaMask" : "Rabby"} was not found in this browser`);
          active = option.provider;
          activeId = option.id;
          setSelected(option.id);
          if (typeof window !== "undefined") localStorage.setItem("fideicommis_wallet", option.id);
        }
        const accounts = (await call("eth_requestAccounts")) as string[];
        if (!accounts?.length) throw new Error("No accounts returned");
        setAddress(accounts[0] ?? null);

        const hex = (await call("eth_chainId")) as string;
        setChainId(Number.parseInt(hex, 16));
        if (Number.parseInt(hex, 16) !== CHAIN_ID) await switchNetwork();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const disconnect = useCallback(() => {
    active = null;
    activeId = null;
    setAddress(null);
    setSelected(null);
    if (typeof window !== "undefined") localStorage.removeItem("fideicommis_wallet");
  }, []);

  // Remember the choice across reloads without prompting.
  useMemo(() => {
    if (selected || typeof window === "undefined" || !wallets.length) return;
    const saved = localStorage.getItem("fideicommis_wallet") as WalletId | null;
    if (!saved) return;
    const option = saved ? wallets.find((w) => w.id === saved) : wallets[0];
    if (option && option.provider) {
      active = option.provider;
      activeId = option.id;
      setSelected(option.id);
    }
  }, [wallets, selected]);

  return {
    address,
    wallets,
    selected,
    chainId,
    onStudionet: chainId === CHAIN_ID,
    busy,
    error,
    connect,
    disconnect,
    switchNetwork,
    refresh,
  };
}

export { CHAIN_ID, CHAIN_ID_HEX, NETWORK, RPC_URL };
