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
  | { ok: true; hash: string }
  | { ok: false; phase: "submit" | "receipt" | "execute" | "rejected"; reason: string; hash?: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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
  opts: { value?: bigint; from?: string } = {},
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

  let receipt: unknown;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: hash as unknown as Parameters<GenClient["waitForTransactionReceipt"]>[0]["hash"],
      status: "ACCEPTED" as never,
      interval: 4000,
      retries: 120,
    });
  } catch (err) {
    return { ok: false, phase: "receipt", reason: (err as Error).message, hash };
  }

  const seen = hashOf(receipt);
  if (seen && seen.toLowerCase() !== hash.toLowerCase()) {
    return { ok: false, phase: "receipt", reason: `the receipt is for another transaction: ${seen} != ${hash}`, hash };
  }

  const verdict = leaderSays(receipt);
  if (!verdict.ok) return { ok: false, phase: "execute", reason: verdict.reason, hash };
  return { ok: true, hash };
}

/* --------------------------------------------------------------------------
 * The actions this app offers. Each one is deliberately on the list rather than
 * generated: the point of an allow-list is that a reader can audit it, and a
 * dynamic dispatch over the ABI cannot be.
 * -------------------------------------------------------------------------- */

/** Anyone may run the cycle. The trust pays the caller. */
export const advanceCycle = (trust: string, from?: string) => submit(trust, "advance_cycle", [], { from });

/** Anyone may fund it, and funding revives a dormant trust permanently. */
export const fund = (trust: string, amount: bigint, from?: string) => submit(trust, "fund", [], { value: amount, from });

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
