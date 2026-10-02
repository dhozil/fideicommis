"use client";

import { createClient, chains } from "genlayer-js";
import { walletProvider } from "./wallet";

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

/**
 * What the Equivalence Principle actually did, as reported by the chain.
 *
 * A write that returns nothing but "it worked" asks the user to take the app's word
 * for it, and this is the one place in the whole project where the answer is worth
 * showing rather than summarising. Four things are here and they are the whole
 * mechanism:
 *
 *   - what the leader executed, as the returned value
 *   - what each validator independently re-derived
 *   - whether they agreed
 *   - the raw VM output, if there is any
 *
 * `eq_outputs` is the slot the node puts the leader's output in. It is empty on a
 * rollback, which is one of the more honest things about it: there is no value to show
 * because nothing ran.
 */
export interface EquivalenceEvidence {
  /** What the leader's execution returned, as text. */
  leaderOutput: string | null;
  /** How many validators agreed, and how many there were. */
  agreed: number;
  validators: number;
  /** Every validator's execution result, in the order the node listed them. */
  perValidator: { address: string; result: string; vote: string | null }[];
  /** The VM's own stdout, when the node carries one. */
  stdout: string | null;
  /** The status string the node attached to the leader's result. */
  leaderStatus: string | null;
}

function textOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 0) ?? null;
  } catch {
    return String(value);
  }
}

/**
 * Pull the equivalence evidence out of a receipt.
 *
 * Everything is optional and everything degrades: a field the node does not carry
 * yields null or zero rather than an exception, because a receipt shape that gains a
 * key must not turn a settled transaction into a broken panel.
 */
export function equivalenceOf(receipt: unknown): EquivalenceEvidence {
  const data = (receipt as {
    consensus_data?: {
      leader_receipt?: {
        eq_outputs?: unknown;
        execution_result?: string;
        genvm_result?: { stdout?: string; stderr?: string };
        result?: { status?: string; payload?: unknown };
      }[];
      validators?: {
        execution_result?: string;
        vote?: string | null;
        node_config?: { address?: string };
      }[];
      votes?: Record<string, string>;
    };
  })?.consensus_data;

  const leader = data?.leader_receipt?.[0];
  const validators = data?.validators ?? [];

  // eq_outputs is a map of named outputs. One entry is the case worth reporting; more
  // than one is shown in full rather than picked from.
  const eqOutputs = leader?.eq_outputs;
  let leaderOutput: string | null = null;
  if (eqOutputs && typeof eqOutputs === "object" && !Array.isArray(eqOutputs)) {
    const values = Object.values(eqOutputs as Record<string, unknown>).filter(
      (value) => value !== undefined && value !== null && value !== "",
    );
    if (values.length === 1) leaderOutput = textOf(values[0]);
    else if (values.length > 1) {
      leaderOutput = Object.entries(eqOutputs as Record<string, unknown>)
        .map(([key, value]) => `${key}: ${textOf(value)}`)
        .join(" · ");
    }
  } else if (eqOutputs !== undefined && eqOutputs !== null) {
    leaderOutput = textOf(eqOutputs);
  }

  // The leader's own payload is what it returned, when it returned one at all.
  if (leaderOutput === null && leader?.result?.payload !== undefined) {
    leaderOutput = textOf(leader.result.payload);
  }

  const perValidator = validators.map((validator) => ({
    address: validator?.node_config?.address ?? "",
    result: String(validator?.execution_result ?? "UNKNOWN"),
    vote: validator?.vote ?? null,
  }));

  return {
    leaderOutput,
    agreed: perValidator.filter((v) => v.vote === "agree").length,
    validators: perValidator.length,
    perValidator,
    stdout: leader?.genvm_result?.stdout || null,
    leaderStatus: leader?.result?.status ?? null,
  };
}

/**
 * The engine's own answer about whether the leader returned. A transaction can
 * reach FINALIZED and still have rolled back, so this is the only honest test.
 */
function leaderSays(receipt: unknown): { ok: boolean; reason: string } {
  const leader = (receipt as { consensus_data?: { leader_receipt?: { execution_result?: string; error_code?: number; result?: { status?: string; payload?: unknown } }[] } })
    ?.consensus_data?.leader_receipt?.[0];
  if (!leader) return { ok: false, reason: "no leader receipt in the response" };
  const status = leader.result?.status;
  if (leader.execution_result === "SUCCESS" && (status === undefined || status === "return")) return { ok: true, reason: "" };
  const parts: string[] = [];
  if (leader.execution_result && leader.execution_result !== "SUCCESS") parts.push(`execution_result=${leader.execution_result}`);
  if (leader.error_code) parts.push(`error_code=${leader.error_code}`);
  if (status) parts.push(`result=${status}`);
  const payload = leader.result?.payload;
  if (payload !== undefined && payload !== null) {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    parts.push(`payload=${text.slice(0, 300)}`);
  }
  return { ok: false, reason: parts.join(" | ") || "the leader did not return" };
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

/** Operational policy: what burns, what a keeper is paid, how often. */
export const setPolicy = (trust: string, burn: bigint, keeper: bigint, tick: number, from?: string) =>
  submit(trust, "set_policy", [burn, keeper, tick], { from });

/** A member proposes. Anyone may propose; only a member may vote. */
export const submitProposal = (
  trust: string,
  title: string,
  body: string,
  kind: "GRANT" | "CHARTER_AMENDMENT" | "GOVERNANCE",
  amount: bigint,
  recipient: string,
  from?: string,
) => submit(trust, "submit_proposal", [title, body, kind, amount, recipient], { from });

export const castVote = (trust: string, proposalId: string, approve: boolean, from?: string) =>
  submit(trust, "cast_vote", [proposalId, approve], { from });

export const executeProposal = (trust: string, proposalId: string, from?: string) =>
  submit(trust, "execute_proposal", [proposalId], { from });

export const reviewDelivery = (trust: string, proposalId: string, evidenceUrl: string, from?: string) =>
  submit(trust, "review_delivery", [proposalId, evidenceUrl], { from });

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
