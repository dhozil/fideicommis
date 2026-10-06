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
process.env.NEXT_PUBLIC_FEATURED_TRUST ?? "0x03D0d63AC67F4D0D478d7F506530DCFD99bA338f";

export const LISTED_TRUSTS: ListedTrust[] = [
  {
    // Deployed from the current source, and frozen: `get_code_upgraders` returns `[]`, so
    // no address can replace its code. Its member is the founder that deployed it, which
    // makes it the trust whose whole path is reachable from a browser — grants voted on,
    // executed, reviewed and settled rather than resting at "assessed".
    address: "0x03D0d63AC67F4D0D478d7F506530DCFD99bA338f",
    purpose: "The reference trust: an auditable ledger of climate-adaptation reference material.",
    note: "Current build. Frozen — no address can replace this code.",
  },
];

export function isListed(address: string): boolean {
  const needle = address.trim().toLowerCase();
  return LISTED_TRUSTS.some((trust) => trust.address.toLowerCase() === needle);
}
