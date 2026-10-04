"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * EIP-6963 wallet discovery, with a legacy fallback.
 *
 * The standard is `eip6963:announceProvider` / `eip6963:requestProvider`: a wallet
 * announces itself by name, icon and rdns, and a dApp asks for the list. The reason
 * that matters is that `window.ethereum` is a race. With two EVM wallets installed,
 * both write to the same property, and whichever injected last wins — so an app that
 * reads `window.ethereum` silently connects the wrong wallet, and the user is shown an
 * address from a wallet they did not choose. Discovery by announcement avoids the race
 * entirely because nothing is claimed by overwriting.
 *
 * So `window.ethereum` is a *fallback*, consulted only for a wallet that never
 * announces, and never at the same time as an announcement. A user with MetaMask and
 * Rabby gets both, named, with icons, and picks.
 *
 * Two details that are easy to get wrong and are the difference between this working
 * and not:
 *
 *   - The request must be dispatched *after* the listener is attached, and it must be
 *     dispatched on every mount. A wallet that was already installed announces again
 *     in response, so the list is not empty on a second visit — but only if the
 *     request is re-sent. Reading a cache on mount is what produces "no wallet found"
 *     on the second page load of a session.
 *   - Wallets announce asynchronously. The list is empty for a moment after mount, so
 *     discovery is given a short window to settle before "none installed" is claimed,
 *     and the claim is about *no announcement*, not about no wallet.
 */

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  name?: string;
}

export interface ProviderInfo {
  /** Unique per wallet per page load, and the spec's own deduplication key. */
  uuid: string;
  name: string;
  /** A data: URI the wallet supplies. Rendered as an <img>, never as HTML. */
  icon: string;
  /** Reverse DNS name, e.g. io.metamask. Stable across versions, unlike the name. */
  rdns: string;
}

interface ProviderDetail {
  info: ProviderInfo;
  provider: Eip1193Provider;
}

export interface DiscoveredWallet {
  /** The wallet's own uuid, which is unique per announcement. */
  id: string;
  name: string;
  icon: string;
  rdns: string;
  provider: Eip1193Provider;
  /** True when found by announcement rather than by sniffing window.ethereum. */
  announced: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  }
}

/**
 * How long to wait for announcements before reporting that there are none.
 *
 * Exported because the ordering guarantee — listener first, request second, and the
 * request re-dispatched on every mount — is the part of this module that is easy to
 * break and invisible in a screenshot. `tests/check_wallet_discovery.mts` asserts it
 * against this source rather than against a copy of the effect body.
 */
export const DISCOVERY_MS = 600;

/**
 * How a legacy wallet is named when it never announced.
 *
 * Only `window.ethereum` is available in that case, so there is nothing to read a name
 * from. The flags MetaMask and Rabby both set are checked, and anything unrecognised is
 * reported by its own property name rather than being called "MetaMask" — which is
 * what a dApp does that assumes, and it is how a user ends up unsure which wallet is
 * about to sign.
 */
export function legacyName(provider: Eip1193Provider): string {
  if (provider.isRabby) return "Rabby";
  if (provider.isMetaMask) return "MetaMask";
  const declared = typeof provider.name === "string" ? provider.name.trim() : "";
  if (declared) return declared;
  return "Browser wallet";
}

export function legacyRdns(provider: Eip1193Provider): string {
  if (provider.isRabby) return "io.rabby";
  if (provider.isMetaMask) return "io.metamask";
  return "unknown";
}

export function iconFromName(name: string): string {
  // A wallet with no icon still needs something to look at, and a letter from its own
  // name is honest where a generic wallet glyph would be a guess.
  //
  // A name that is empty or whitespace falls back to "?" rather than producing no icon
  // at all: the first version returned an empty string here, which rendered as a blank
  // square in the row. A row that looks broken is worse than one showing a question mark.
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="6" fill="#1b1f23"/>` +
    `<text x="16" y="21" font-family="ui-monospace,monospace" font-size="15" ` +
    `fill="#c8b273" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function fromLegacy(provider: Eip1193Provider): DiscoveredWallet {
  const name = legacyName(provider);
  return {
    id: `legacy:${legacyRdns(provider)}`,
    name,
    icon: iconFromName(name),
    rdns: legacyRdns(provider),
    provider,
    announced: false,
  };
}

/**
 * A wallet is only the same wallet if it is the same object or the same rdns.
 *
 * Comparing by name would merge two wallets a user has both installed and happened to
 * have named the same thing; comparing by uuid alone would show the same wallet twice if
 * it announced more than once.
 */
export function dedupe(wallets: DiscoveredWallet[]): DiscoveredWallet[] {
  const seen = new Map<string, DiscoveredWallet>();
  for (const wallet of wallets) {
    // Keyed on rdns alone for every entry, announced or sniffed. The first version
    // prefixed the sniffed key with `legacy:`, which meant an announced MetaMask and the
    // same MetaMask read from window.ethereum became two rows for one wallet — the
    // duplicate this whole exercise exists to avoid. Whether an entry was announced is
    // what decides which one wins, not which bucket it is filed under.
    const key = wallet.rdns || wallet.id;
    const existing = seen.get(key);
    // An announced entry always wins over a sniffed one for the same wallet: it carries
    // a name and an icon the wallet chose for itself.
    if (!existing || (wallet.announced && !existing.announced)) {
      seen.set(key, wallet);
    }
  }
  // Announced wallets first, then by name, so the list is stable between visits. A list
  // that reorders itself is a list that makes people tap the wrong row.
  return [...seen.values()].sort((a, b) => {
    if (a.announced !== b.announced) return a.announced ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export interface Discovery {
  wallets: DiscoveredWallet[];
  /** True while announcements may still be arriving, so the UI should not claim none. */
  settling: boolean;
  /** Asks wallets to announce again, for one installed while the page was open. */
  requestAgain: () => void;
}

/**
 * Listen for announcements for as long as the component is mounted.
 *
 * The listener is attached synchronously inside the effect and the request is dispatched
 * immediately after, because a wallet that announced before this ran would otherwise
 * never be asked again. Both halves matter; the ordering is the whole mechanism.
 */
export function useEip6963(): Discovery {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [settling, setSettling] = useState(true);
  const announced = useRef(new Map<string, DiscoveredWallet>());

  useEffect(() => {
    let cancelled = false;

    const collect = () => {
      if (cancelled) return;
      const found = [...announced.current.values()];
      // The legacy read happens only here, and only as a fallback: if anything
      // announced, that is the authoritative list and window.ethereum is not consulted,
      // because it would reintroduce exactly the race this avoids.
      const withLegacy: DiscoveredWallet[] =
        found.length > 0
          ? found
          : window.ethereum
            ? [fromLegacy(window.ethereum)]
            : [];
      setWallets(dedupe(withLegacy));
    };

    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderDetail>).detail;
      if (!detail?.provider || !detail?.info?.uuid) return;
      announced.current.set(detail.info.uuid, {
        id: detail.info.uuid,
        name: detail.info.name || "Wallet",
        icon: detail.info.icon ?? "",
        rdns: detail.info.rdns ?? "",
        provider: detail.provider,
        announced: true,
      });
      collect();
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    // Re-dispatched on every mount. A wallet that was already installed announces again
    // in response, so this is what makes the list populate on a second visit rather than
    // only the first.
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const timer = window.setTimeout(() => {
      collect();
      if (cancelled) return;
      setSettling(false);
    }, DISCOVERY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
    };
  }, []);

  // A wallet installed while the page is open announces on the next request, and a
  // page that says "no wallet" while one is being installed is a dead end.
  const requestAgain = useCallback(() => {
    setSettling(true);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }, []);

  return { wallets, settling, requestAgain };
}