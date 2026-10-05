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
    // Deployed from the current source with a wallet that can sign for its own single
    // member, which makes it the only listed trust whose whole path is reachable from the
    // browser: its grants are voted on, executed, reviewed and settled rather than resting
    // at "assessed". It is also the trust that proved the timelock applies to GOVERNANCE and
    // CHARTER_AMENDMENT only, and that a GRANT deliberately does not wait.
    address: "0x0A3912aa80a403efDEf664A8e03895CCF5b137D8",
    purpose: "A completed cycle: two grants assessed, voted, paid, reviewed and settled.",
    note: "The only listed trust with settled deliveries, and the only one whose member is reachable from this repository.",
  },
  {
    // This one was missing from the directory while being the only deployment anyone could
    // actually act in. It is the trust whose single member is the address the repository's
    // own scripts are driven with, so a grant here can be voted on and executed rather than
    // only read; the other two have a member whose key exists nowhere in the repository, so
    // their proposals sit assessed and unvoted forever. A directory that lists two of the
    // three and omits the only live one is worse than no directory.
    //
    // Listed for completeness rather than for use: its `get_constitution` and
    // `get_constitutional_state` both refuse, on a build older than the current source.
    // Studionet cannot upgrade a contract, so that is permanent. Its reader page shows the
    // Constitution panel as unreadable, which is the honest rendering of a broken view.
    address: "0xaEDf11fD920Fc8C06EB6754387072C97D0e468aF",
    purpose: "A trust with history, listed with a warning: two of its views refuse.",
    note: "Broken on an older build. get_constitution and get_constitutional_state refuse, and cannot be repaired in place.",
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
