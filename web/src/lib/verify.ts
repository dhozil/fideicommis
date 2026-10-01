import "server-only";

import { chains, createClient } from "genlayer-js";
import type { OrgSummary } from "./types";

/**
 * Check a claim, yourself.
 *
 * The claim this reader makes about itself is that every figure on a trust page can be
 * obtained by calling the same view method yourself. This page is that claim, written
 * out: for an address, it lists each method this reader calls, what it uses the answer
 * for, and the exact call to make.
 *
 * The calls are run here, from the server, so the page can show a real answer next to
 * each method rather than a promise to produce one. That is the difference between
 * documentation and verification: anyone can paste one of these calls into their own
 * client and compare. A page that showed the number the reader computed would only be
 * checking itself, so what is shown here is the raw return value of a single call.
 */

export interface VerifyRow {
  method: string;
  /** What the reader does with the answer. */
  used: string;
  /** Which part of the page it ends up in. */
  shows: string;
  /** Whether a value came back, or why it did not. */
  outcome: "answered" | "empty" | "failed";
  value: string;
  error: string | null;
  ms: number;
}

const CLIENT = createClient({ chain: chains.studionet });

/**
 * The inventory, in the order the reader needs it.
 *
 * This is the whole surface. A method that is not on this list is not called by the
 * reader, which is a claim that can be checked by grepping for `get_` in the source,
 * and one worth making in a table rather than only in a comment.
 */
const INVENTORY: { method: string; used: string; shows: string }[] = [
  { method: "get_org_summary", used: "identity, status, cycle, treasury, runway, charter version", shows: "the header and the balance" },
  { method: "get_next_tick_at", used: "when the trust may next act", shows: "the header" },
  { method: "get_lifetime_flow", used: "the six conservation buckets", shows: "the ledger" },
  { method: "get_constitution", used: "the limits a vote cannot cross", shows: "the constitution panel" },
  { method: "get_constitutional_state", used: "quorum and ceiling as they are now", shows: "the two gauges" },
  { method: "get_policy", used: "burn per cycle, keeper reward, tick interval", shows: "the constitution panel" },
  { method: "get_members", used: "who holds which shares", shows: "membership" },
  { method: "get_charter_rules", used: "the rulebook the committee judges by", shows: "the rulebook" },
  { method: "get_charter", used: "the charter in force", shows: "the charter" },
  { method: "get_proposal_ids", used: "which proposals exist, in order", shows: "the decision list" },
  { method: "get_proposal", used: "one proposal: amount, recipient, votes, verdict", shows: "each decision" },
  { method: "get_proposal_audit", used: "the committee's stated reasoning", shows: "each decision" },
];

/** A short raw answer, clipped. Enough to recognise, not enough to fill a page. */
function clip(value: unknown, max = 320): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function verify(address: string): Promise<{
  rows: VerifyRow[];
  ids: string[];
  isTrust: boolean;
  name: string;
}> {
  const addr = address.trim();

  const run = async (method: string): Promise<{ value: unknown; ms: number; error: string | null }> => {
    const started = Date.now();
    try {
      const value = await CLIENT.readContract({
        address: addr as `0x${string}`,
        functionName: method,
        args: [] as never,
      });
      return { value, ms: Date.now() - started, error: null };
    } catch (err) {
      return { value: null, ms: Date.now() - started, error: (err as Error).message.slice(0, 160) };
    }
  };

  // Every method at once, which is one request's worth of the node's budget rather
  // than twelve. This is the same batch the reader itself uses, so the timings shown
  // here are the timings a visitor sees.
  const results = await Promise.all(INVENTORY.map((entry) => run(entry.method)));

  const idsRaw = results[9]?.value;
  let ids: string[] = [];
  if (typeof idsRaw === "string") {
    try {
      const parsed = JSON.parse(idsRaw);
      if (Array.isArray(parsed)) ids = parsed.map(String);
    } catch {
      ids = [];
    }
  }

  const summaryRaw = results[0]?.value;
  let name = "";
  let isTrust = false;
  if (typeof summaryRaw === "string") {
    try {
      const summary = JSON.parse(summaryRaw) as OrgSummary;
      name = String(summary.name ?? "");
      isTrust = Boolean(name);
    } catch {
      isTrust = false;
    }
  }

  // The two per-proposal methods are listed for every trust, but only called when
  // there is a proposal to call them for. Showing a call for p1 on a trust with no
  // proposals would be a call that fails, and a table of failures is noise.
  const rows: VerifyRow[] = INVENTORY.map((entry, index) => {
    const result = results[index];
    const perProposal = entry.method === "get_proposal" || entry.method === "get_proposal_audit";

    // Every entry maps one method to one call above, so this cannot be undefined in
    // practice. It is handled anyway because "undefined" in a table of what answers
    // would be indistinguishable from a node that did not answer, and that
    // distinction is the entire subject of this page.
    if (!result) {
      return { ...entry, outcome: "failed", value: "", error: "no result returned", ms: 0 };
    }

    if (perProposal) {
      return {
        ...entry,
        outcome: ids.length ? "answered" : "empty",
        value: ids.length
          ? `${ids.length} proposal${ids.length === 1 ? "" : "s"}: call once per id, e.g. ${entry.method}(${JSON.stringify(ids[0])})`
          : "no proposals, so there is nothing to call this for",
        error: null,
        ms: 0,
      };
    }
    if (result.error) {
      return { ...entry, outcome: "failed", value: "", error: result.error, ms: result.ms };
    }
    const text = clip(result.value);
    return {
      ...entry,
      outcome: text ? "answered" : "empty",
      value: text,
      error: null,
      ms: result.ms,
    };
  });

  return { rows, ids, isTrust, name };
}
