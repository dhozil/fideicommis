"use client";

import { createClient, chains } from "genlayer-js";
import { walletProvider } from "./wallet";
import { equivalenceOf, leaderSays, type EquivalenceEvidence } from "./equivalence";

/**
 * The extractor lives in `./equivalence` so the server can use it too, which is what lets
 * `/verify` show a stranger what a committee did rather than only letting the person
 * who signed the transaction see it. It is re-exported because two callers outside this
 * directory still import it from here, and a re-export is a smaller change than moving
 * every one of them.
 */
export { equivalenceOf, leaderSays };
export type { EquivalenceEvidence };

/** The SDK does not export its client type by name, so it is derived. */
type GenClient = ReturnType<typeof createClient>;

/**
 * The signed write path.
 *
 * Everything that spends money or changes the constitution goes through here, and
 * nothing else in the app is allowed to sign. Two rules are enforced here rather
 * than left to convention:
 *
 * 1. The receipt is only believed once its hash matches the transaction that was
 *    just submitted. A receipt from an earlier transaction looks exactly like a
 *    success, and a UI that reports one as the other is worse than no UI.
 * 2. The leading edge of a write is refused on the client, before it costs gas,
 *    when the contract would certainly reject it anyway. A grant above the
 *    constitutional ceiling is the obvious case.
 *
 * The caller still has to be a member, and the contract still has to agree. This
 * is a courtesy layer, not a security boundary, and the UI says so.
 */

export type WriteResult =
  | { ok: true; hash: string; equivalence: EquivalenceEvidence }
  | {
      ok: false;
      phase: "submit" | "receipt" | "execute" | "rejected";
      reason: string;
      hash?: string;
      equivalence?: EquivalenceEvidence;
    };

/**
 * How far along a write is, reported as it happens.
 *
 * This exists because the two waits below answer different questions and the user
 * should be able to tell them apart. `sent` means the node has the transaction and
 * nothing has settled. `settling` means consensus is running, which on Studionet takes
 * a minute or two and looks identical to a hang if the page says nothing.
 */
export type WriteStage = "sending" | "in-consensus";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The two status waits, and why there are two.
 *
 * GenLayer has seven transaction statuses — UNINITIALIZED, PENDING, PROPOSING,
 * COMMITTING, REVEALING, ACCEPTED, UNDETERMINED, FINALIZED — and ACCEPTED sits before
 * the consensus stages finish. So waiting only for ACCEPTED answers "does the node have
 * this transaction", not "did it happen", and this project's own rule is the reason that
 * matters: a transaction can reach FINALIZED and still have rolled back, and only
 * consensus_data.leader_receipt[0].result.payload says which.
 *
 * Whether an ACCEPTED receipt already carries a leader receipt was not measured here,
 * because Studionet had no transactions in the last twelve blocks to inspect and an
 * honest answer would not be a guess. It does not need to be: the UI does not claim a
 * conclusion on ACCEPTED either way. It waits for FINALIZED, and only then reads the
 * leader receipt. That is correct whether or not ACCEPTED would have been enough.
 *
 * ACCEPTED is still waited for, because it is the fast failure. A wallet rejection, a
 * bad argument or a missing balance surfaces there in a second, rather than after two
 * minutes of a spinner.
 */
async function settle(
  client: GenClient,
  hash: string,
  onStage?: (stage: WriteStage) => void,
): Promise<{ ok: true; receipt: unknown } | { ok: false; phase: "receipt" | "execute"; reason: string }> {
  const wait = (status: string, retries: number) =>
    client.waitForTransactionReceipt({
      hash: hash as unknown as Parameters<GenClient["waitForTransactionReceipt"]>[0]["hash"],
      status: status as never,
      interval: 4000,
      retries,
    }) as Promise<unknown>;

  try {
    await wait("ACCEPTED", 30);
  } catch (err) {
    return { ok: false, phase: "receipt", reason: (err as Error).message };
  }

  onStage?.("in-consensus");

  let receipt: unknown;
  try {
    // 150 retries at four seconds is ten minutes, which is well past a Studionet
    // consensus and still short of a user deciding the page is broken.
    receipt = await wait("FINALIZED", 150);
  } catch (err) {
    return { ok: false, phase: "receipt", reason: (err as Error).message };
  }

  const seen = hashOf(receipt);
  if (seen && seen.toLowerCase() !== hash.toLowerCase()) {
    return {
      ok: false,
      phase: "receipt",
      reason: `the receipt is for another transaction: ${seen} != ${hash}`,
    };
  }

  return { ok: true, receipt };
}

function clientFor(address?: string): GenClient {
  const provider = walletProvider() as never;
  const config: Record<string, unknown> = { chain: chains.studionet, provider };
  if (address) config.account = address as `0x${string}`;
  return createClient(config as never);
}

function hashOf(receipt: unknown): string | null {
  const r = receipt as Record<string, unknown> | null;
  const raw = r?.transaction_hash ?? r?.transactionHash ?? r?.hash ?? r?.to_transaction_hash;
  return raw === undefined || raw === null ? null : String(raw);
}

async function submit(
  address: string,
  method: string,
  args: unknown[],
  opts: { value?: bigint; from?: string; onStage?: (stage: WriteStage) => void } = {},
): Promise<WriteResult> {
  if (!ADDRESS.test(address)) return { ok: false, phase: "rejected", reason: "That is not a contract address" };
  const client = clientFor(opts.from);
  let hash: string;
  try {
    hash = (await client.writeContract({
      address: address as `0x${string}`,
      functionName: method,
      args: args as never,
      value: opts.value ?? 0n,
      consensusMaxRotations: 5,
    })) as string;
  } catch (err) {
    return { ok: false, phase: "submit", reason: (err as Error).message };
  }

  opts.onStage?.("sending");

  const settled = await settle(client, hash, opts.onStage);
  if (!settled.ok) return { ok: false, phase: settled.phase, reason: settled.reason, hash };

  // Only now, on a FINALIZED receipt, is the leader receipt the authority on whether
  // this happened. A rollback here is a real outcome and is reported as one.
  // Read the evidence before the verdict, so both outcomes can report what the
  // committee actually did. A rollback is exactly when a user most wants to see it.
  const equivalence = equivalenceOf(settled.receipt);
  const verdict = leaderSays(settled.receipt);
  if (!verdict.ok) {
    return { ok: false, phase: "execute", reason: verdict.reason, hash, equivalence };
  }
  return { ok: true, hash, equivalence };
}

/* --------------------------------------------------------------------------
 * The actions this app offers. Each one is deliberately on the list rather than
 * generated: the point of an allow-list is that a reader can audit it, and a
 * dynamic dispatch over the ABI cannot be.
 * -------------------------------------------------------------------------- */

/** Anyone may run the cycle. The trust pays the caller. */
export const advanceCycle = (trust: string, from?: string, onStage?: (stage: WriteStage) => void) =>
  submit(trust, "advance_cycle", [], { from, onStage });

/** Anyone may fund it, and funding revives a dormant trust permanently. */
export const fund = (trust: string, amount: bigint, from?: string, onStage?: (stage: WriteStage) => void) =>
  submit(trust, "fund", [], { value: amount, from, onStage });

/**
 * Operational policy: what burns, what a keeper is paid, how often.
 *
 * Every helper takes `onStage` because every write has the same two waits, and a
 * button that cannot say which one it is in is a button that looks stuck. Four of
 * these six were written without it, so a proposal sent from the UI would have gone
 * silent for two minutes and then appeared to have failed.
 */
export const setPolicy = (
  trust: string,
  burn: bigint,
  keeper: bigint,
  tick: number,
  from?: string,
  onStage?: (stage: WriteStage) => void,
) => submit(trust, "set_policy", [burn, keeper, tick], { from, onStage });

/** A member proposes. Anyone may propose; only a member may vote. */
export const submitProposal = (
  trust: string,
  title: string,
  body: string,
  kind: "GRANT" | "CHARTER_AMENDMENT" | "GOVERNANCE",
  amount: bigint,
  recipient: string,
  from?: string,
  onStage?: (stage: WriteStage) => void,
) => submit(trust, "submit_proposal", [title, body, kind, amount, recipient], { from, onStage });

export const castVote = (
  trust: string,
  proposalId: string,
  approve: boolean,
  from?: string,
  onStage?: (stage: WriteStage) => void,
) => submit(trust, "cast_vote", [proposalId, approve], { from, onStage });

export const executeProposal = (
  trust: string,
  proposalId: string,
  from?: string,
  onStage?: (stage: WriteStage) => void,
) => submit(trust, "execute_proposal", [proposalId], { from, onStage });

export const reviewDelivery = (
  trust: string,
  proposalId: string,
  evidenceUrl: string,
  from?: string,
  onStage?: (stage: WriteStage) => void,
) => submit(trust, "review_delivery", [proposalId, evidenceUrl], { from, onStage });

/**
 * Refuses a write the contract would certainly reject, before it costs gas.
 *
 * Only the ceiling check is here, because it is the one a user gets wrong most
 * and the one with a number to compare against. Everything else is left to the
 * contract, which is the authority.
 */
export function preflightGrant(amount: bigint, treasury: bigint, ceilingBps: number, maxCeilingBps: number): string | null {
  if (amount <= 0n) return "Enter an amount";
  const ceiling = (treasury * BigInt(Math.trunc(ceilingBps))) / 10000n;
  if (amount > ceiling) return `That is above this trust's ceiling: ${formatGen(ceiling)} GEN is the most one grant can be`;
  if (ceilingBps > maxCeilingBps) return "This trust's ceiling is above the constitutional maximum, which should not be possible";
  if (amount > treasury) return "That is more than the trust holds";
  return null;
}

export function formatGen(atto: bigint): string {
  const whole = atto / 10n ** 18n;
  const frac = (atto % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac}`;
}

export function parseGen(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (frac.length > 18) return null;
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac || "0").padEnd(18, "0"));
}
