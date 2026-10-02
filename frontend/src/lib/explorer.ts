/**
 * Explorer links.
 *
 * GenLayer's Studionet explorer is at explorer-studio.genlayer.com and takes
 * etherscan-shaped paths: /address/<addr> and /tx/<hash>. Both routes were
 * checked against the live site before being used, because a link that 404s is
 * worse than no link: it looks like the reader is making an unverifiable claim
 * and sending you nowhere to check it.
 *
 * This module is imported by client components as well as server ones, so it
 * deliberately holds no chain client and no key. It is pure string work.
 */

const EXPLORER = "https://explorer-studio.genlayer.com";

export const EXPLORER_URL = EXPLORER;

export function addressOnExplorer(address: string): string {
  return `${EXPLORER}/address/${address}`;
}

export function txOnExplorer(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

/**
 * A short form for display next to a link, because a 66-character hash on its own
 * is unreadable and a truncated one has to say so.
 */
export function shortHash(hash: string, lead = 10, tail = 6): string {
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function shortAddress(address: string, lead = 8, tail = 6): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
