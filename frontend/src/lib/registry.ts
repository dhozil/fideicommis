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
process.env.NEXT_PUBLIC_FEATURED_TRUST ?? "0xaA49d2FEd44011AE5780573f78f7C66C6aabC848";

export const LISTED_TRUSTS: ListedTrust[] = [
  {
    // The first of three sister trusts, all deployed from the current source by the
    // same founder wallet, all frozen (`get_code_upgraders` returns `[]`), and each
    // walked the whole path: funded, a charter-violating proposal refused by the
    // committee, and two upkeep grants voted on, executed, reviewed against their
    // named public pages, and settled. Its grants keep the climate-adaptation
    // reference article reachable.
    address: "0xaA49d2FEd44011AE5780573f78f7C66C6aabC848",
    purpose: "Keeps the climate-adaptation reference article reachable. One refusal, two settled grants.",
    note: "Lived-in: p1 refused (R2/R3/R4), two grants settled at scores 97 and 97.",
  },
  {
    // The second sister trust. Its early upkeep proposals named a page outside the
    // chartered mission, and the committee refused every one of them — which is the
    // mission boundary working as designed, not a malfunction. The settled grants
    // keep the climate-resilience article reachable.
    address: "0x3DaAC199deb81F1d333FcbbB44efC9AF1E9FF3b5",
    purpose: "Keeps the climate-resilience article reachable. Off-mission grants refused, two settled.",
    note: "Lived-in: p1 refused, off-mission proposals refused, two grants settled at scores 85 and 100.",
  },
  {
    // The third sister trust. Its grants keep the climate-mitigation article reachable.
    address: "0xFA82908b7af9e09c11Ffd0D2E9655CBA238A6b37",
    purpose: "Keeps the climate-mitigation article reachable. One refusal, two settled grants.",
    note: "Lived-in: p1 refused, two grants settled at scores 100 and 90.",
  },
];

export function isListed(address: string): boolean {
  const needle = address.trim().toLowerCase();
  return LISTED_TRUSTS.some((trust) => trust.address.toLowerCase() === needle);
}
