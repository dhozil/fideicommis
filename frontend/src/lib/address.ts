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
