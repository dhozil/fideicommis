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
process.env.NEXT_PUBLIC_FEATURED_TRUST ?? "0x9f732c9c87bef27e18AC05F4f600271c2f376e78";

export const LISTED_TRUSTS: ListedTrust[] = [
  {
    // Deployed from the current source by the current founder wallet and frozen
    // (`get_code_upgraders` returns `[]`). Walked the whole path: funded, a
    // charter-violating proposal refused, two upkeep grants settled at 100 and
    // 80, both paid to an independent recipient wallet. Its grants keep the
    // climate-adaptation reference article reachable.
    address: "0x9f732c9c87bef27e18AC05F4f600271c2f376e78",
    purpose: "Keeps the climate-adaptation reference article reachable. One refusal, two settled grants.",
    note: "Current build. p1 refused, two grants settled at scores 100 and 100.",
  },
  {
    // The second trust under the current founder: same contract, a different
    // charter. Its grants keep the open-source reference article reachable.
    address: "0x1CAAa72820f37eC1F78C291913662a531b4Fd96f",
    purpose: "Keeps the open-source reference article reachable. One refusal, two settled grants.",
    note: "Current build. p1 refused, two grants settled at scores 100 and 80.",
  },
  {
    // The third trust under the current founder. Its grants keep the
    // public-health reference article reachable.
    address: "0x397A79540D08a043A4Bc2dd426A9EC828B3067c2",
    purpose: "Keeps the public-health reference article reachable. One refusal, two settled grants.",
    note: "Current build. p1 refused, two grants settled at scores 80 and 80.",
  },
];

export function isListed(address: string): boolean {
  const needle = address.trim().toLowerCase();
  return LISTED_TRUSTS.some((trust) => trust.address.toLowerCase() === needle);
}
