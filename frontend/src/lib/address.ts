/**
 * Address shape, on its own.
 *
 * This was imported from trust.ts, which is `server-only` because it holds the chain
 * client. So a client component that needed to check whether something looked like
 * an address pulled the whole reader into the browser bundle, and the build refused
 * it. The shape check has no business talking to a node, so it lives here now and
 * trust.ts re-exports it, which keeps one definition rather than two.
 *
 * It is deliberately only a shape check. Whether an address is a Fideicommis is a
 * question about the chain, and only the server can answer it.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: string): boolean {
  return ADDRESS.test(value.trim());
}

/**
 * Transaction-hash shape.
 *
 * 32 bytes of hex, so 0x and 64 characters. It is a shape check and nothing more —
 * whether a hash names a transaction this node has heard of is a question about the
 * chain, and only the server can answer it. A visitor pasting a hash gets either a
 * report or "the node has no record of this", never a guess.
 */
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function isTxHash(value: string): boolean {
  return HASH.test(value.trim());
}
