/**
 * Reading the Equivalence Principle out of a receipt.
 *
 * This used to live inside `actions.ts`, which meant the only place the project's
 * central claim could be inspected was the wallet panel — and that panel is reachable
 * only by someone who personally signed a transaction through this site. An auditor
 * arriving with a hash had nowhere to go but the explorer or a hand-written client,
 * which is the same position a reader is in when asked to take a project's word for
 * something.
 *
 * So the extractor is here on its own, with no `"use client"` and no `server-only`,
 * because it is pure string work over an object it is handed. That lets the server read
 * a receipt on a stranger's behalf on `/verify`, and lets the client do the same thing
 * for a transaction the user just sent, and there is exactly one parser, so the two
 * cannot report different things about the same receipt.
 *
 * The bundle guard is the reason this separation is deliberate. `server-only` and
 * `"use client"` are both one line away from being wrong, so a module that has to be
 * reachable from both sides is neither, and earns its neutrality by importing nothing.
 */

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

export interface EquivalenceEvidence {
  /** What the leader's execution returned, as text. Null when it returned nothing. */
  leaderOutput: string | null;
  /**
   * What the leader said instead of returning, when it did not return.
   *
   * This used to be folded into `leaderOutput`, which meant a rolled-back write was
   * displayed as a `rollback` mark followed by what looked exactly like a returned
   * value — the error text, under a heading that said "output". The module's own
   * comment had claimed there was nothing to show because nothing ran, and the code
   * said otherwise; the code was right about the data and wrong about the label.
   *
   * So the two are separate. A rollback now reads as a rollback with a reason, and a
   * genuine return still reads as one.
   */
  leaderError: string | null;
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

  // eq_outputs is the slot the node puts the leader's output in. One entry is the case
  // worth reporting; more than one is shown in full rather than picked from.
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

  // A leader that returned can carry its value in `result.payload` instead of
  // `eq_outputs`, so that is consulted — but only when it returned. On a rollback the
  // same field holds the reason it rolled back, and putting that in `leaderOutput`
  // would render an error under a heading that claims a value came back.
  const payload = leader?.result?.payload;
  const payloadText =
    payload === undefined || payload === null ? null : textOf(payload);
  const returned =
    leader?.execution_result === "SUCCESS" &&
    (leader?.result?.status === undefined || leader?.result?.status === "return");

  let leaderError: string | null = null;
  if (leaderOutput === null && payloadText !== null) {
    if (returned) leaderOutput = payloadText;
    else leaderError = payloadText;
  }
  // A leader that neither returned nor explained itself still has an execution result
  // worth naming, which is usually more informative than silence.
  if (
    leaderError === null &&
    !returned &&
    leader &&
    typeof leader.execution_result === "string" &&
    leader.execution_result !== "SUCCESS"
  ) {
    leaderError = `execution_result=${leader.execution_result}`;
  }

  const perValidator = validators.map((validator) => ({
    address: validator?.node_config?.address ?? "",
    result: String(validator?.execution_result ?? "UNKNOWN"),
    vote: validator?.vote ?? null,
  }));

  return {
    leaderOutput,
    leaderError,
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
 *
 * This is also the part most worth showing a stranger, because it is the one that
 * contradicts the status. A rolled-back transaction carries FINALIZED just like a
 * settled one, so "the explorer says finalized" and "the leader returned" are two
 * separate claims, and only the second one is about what happened.
 */
export function leaderSays(receipt: unknown): { ok: boolean; reason: string } {
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

/**
 * Whether a receipt carries consensus data at all.
 *
 * A pending transaction and a settled one are both "found", and reporting them the
 * same way would be the exact error this project exists to avoid — a page that shows
 * "0 of 0 agreed" for a transaction that simply has not run yet reads as a committee
 * that refused, which is a very different claim from one that has not been asked.
 */
export function hasConsensus(receipt: unknown): boolean {
  const data = (receipt as { consensus_data?: unknown })?.consensus_data;
  if (!data || typeof data !== "object") return false;
  const leader = (data as { leader_receipt?: unknown[] }).leader_receipt;
  return Array.isArray(leader) && leader.length > 0;
}
