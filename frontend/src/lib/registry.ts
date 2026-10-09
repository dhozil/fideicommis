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
process.env.NEXT_PUBLIC_FEATURED_TRUST ?? "0x1178AB91ab373c89F82c6174d6c8b7A4020EdE65";

export const LISTED_TRUSTS: ListedTrust[] = [
  {
    // Deployed from the fixed source: dissolution needs a member vote plus the
    // delay, keeper rewards are capped per cycle, shares add up, and settle
    // payouts follow the consensus-bound score. Walked the whole path: funded,
    // a charter-violating proposal refused, two upkeep grants settled at 100
    // and 80. Earlier deployments predate these fixes and are no longer listed;
    // they stay reachable by address, superseded rather than patched, because
    // Studionet cannot upgrade a contract.
    address: "0x1178AB91ab373c89F82c6174d6c8b7A4020EdE65",
    purpose: "Keeps the climate-adaptation reference article reachable. One refusal, two settled grants.",
    note: "Current fixed build. p1 refused, two grants settled at scores 100 and 80.",
  },
];

export function isListed(address: string): boolean {
  const needle = address.trim().toLowerCase();
  return LISTED_TRUSTS.some((trust) => trust.address.toLowerCase() === needle);
}
