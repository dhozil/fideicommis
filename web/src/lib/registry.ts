/**
 * The directory of trusts this reader knows about.
 *
 * This used to live on-chain in a factory contract's own storage, and it was
 * removed along with the factory, for a reason worth repeating here: a directory
 * of live trusts is worth keeping, and on-chain state owned by one address is not.
 * So it is a file in this repository, which means it is reviewable in a diff and
 * changing it is an ordinary commit rather than an act of governance.
 *
 * An address here is a starting point, not a claim. Every figure on every page
 * that follows is read live from the contract's own view methods, so if one of
 * these is stale or wrong, the page says so rather than repeating this file.
 */

/**
 * `NEXT_PUBLIC_FEATURED_TRUST` overrides the first entry, which is how a deployment
 * points at its own freshly deployed trust without a code change.
 */
import type { ListedTrust } from "./types";

export const FEATURED_TRUST =
  process.env.NEXT_PUBLIC_FEATURED_TRUST ?? "0x76051A36dCB316bD7Bf272692B3e3f7930170597";

export const LISTED_TRUSTS: ListedTrust[] = [
  {
    address: FEATURED_TRUST,
    purpose: "The reference trust: open source climate adaptation research.",
    note: "Deployed from the current source on Studionet.",
  },
  {
    address: "0x89D3E2F937a265583BF308F2d5250445e1f7113F",
    purpose: "An earlier deployment of the same contract, kept so old claims stay checkable.",
    note: "Previous build. Figures here are that build's, not this one's.",
  },
];

export function isListed(address: string): boolean {
  const needle = address.trim().toLowerCase();
  return LISTED_TRUSTS.some((trust) => trust.address.toLowerCase() === needle);
}
