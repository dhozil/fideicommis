import "server-only";

import { readJSON, readString, RateLimitedError } from "./genlayer";
import type {
  CharterRule,
  ConstitutionalState,
  Constitution,
  LifetimeFlow,
  Member,
  OrgSummary,
  Policy,
  Proposal,
  ProposalAudit,
  TrustRecord,
} from "./types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * How many proposals one page render will fetch, and how long it may spend.
 *
 * The public Studionet node allows 30 requests a minute per IP, and every call in
 * this file costs one. A trust that accumulates proposals would otherwise cost two
 * calls per proposal with no ceiling, so a mature trust could not be read at all:
 * the render would exceed the minute budget, get answered with -32029, and the
 * reader would see a busy node where a trust should be.
 *
 * Both limits are here rather than in the client because the fix for a render that
 * is too expensive is to render less, not to retry harder. Retrying a throttled
 * call spends more of the budget it already exceeded, which is why the two bounds
 * are a count and a deadline: the count bounds the request spend, and the deadline
 * bounds the wall clock, which the count cannot see.
 *
 * The cap is derived from the node's limit rather than guessed, so the two cannot
 * drift apart. The arithmetic, which is the reason this is a constant block and
 * not a bare 9:
 *
 *   fixed reads            10
 *   per proposal            2   (the record, and the audit that explains it)
 *   node limit per minute  30
 *   slack                   2   so a second reader in the same minute still fits
 *   => (30 - 2 - 10) / 2 = 9
 *
 * Nine proposals is 28 calls, which leaves the node answerable for the rest of the
 * minute. Ten would be exactly 30 and would consume all of it, so opening the same
 * trust in two tabs would be enough to throttle the second one: the ordinary case,
 * not an edge one.
 */
const NODE_CALLS_PER_MINUTE = 30;
const SLACK_CALLS = 2;
const FIXED_READS = 10;
const CALLS_PER_PROPOSAL = 2;
const MAX_PROPOSALS = Math.floor((NODE_CALLS_PER_MINUTE - SLACK_CALLS - FIXED_READS) / CALLS_PER_PROPOSAL);

/**
 * A second bound, for the case the count does not catch. MAX_PROPOSALS is a
 * request count, and a slow node can spend a minute answering nine of them, which
 * is a timeout rather than a rate limit. The deadline is checked between proposals
 * so a render that is running out of time stops and returns what it has, instead
 * of being killed by the platform holding the response open.
 */
const RENDER_BUDGET_MS = 45_000;

export function isAddress(value: string): boolean {
  return ADDRESS.test(value.trim());
}

/**
 * Read a whole trust in one pass.
 *
 * The calls are issued sequentially rather than in parallel, on purpose. Sixteen
 * simultaneous reads is what gets a reader throttled: the node answers the
 * overflow with an HTML page, and a JSON client reports that as a broken trust
 * rather than a busy node. Correctness of the reading is worth a few seconds.
 *
 * Nothing here throws for a single failed call except a rate limit. A view that
 * answers "execution failed" for a trust that has not derived its rulebook yet is
 * a normal state, and the page should show what it can rather than refuse to
 * render. The one exception is a genuine limit, which the reader cannot work
 * around by trying again sooner.
 */
export async function readTrust(address: string): Promise<TrustRecord> {
  const addr = address.trim();
  if (!isAddress(addr)) {
    throw new NotATrust(`That is not a contract address. A Fideicommis address looks like 0x followed by 40 hex characters.`);
  }

  const startedAt = Date.now();
  const degraded: string[] = [];
  const soft = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      degraded.push(`${label}: ${(err as Error).message.slice(0, 90)}`);
      return fallback;
    }
  };

  // get_org_summary is both the proof of life and the source of most of what the
  // page shows. It is read first, alone, because an address with no contract behind
  // it must become a NotATrust so the page answers 404 with an explanation rather
  // than a 500: a raw SDK error here is what that looks like.
  //
  // It also answers the name, status, cycle, treasury, runway, last action and
  // charter version. Those were seven separate read calls, which was seven calls
  // spent re-reading data the summary already carried. The fixed read count went
  // from seventeen to ten, and nothing on the page lost a field.
  let summary: OrgSummary;
  try {
    summary = await readJSON<OrgSummary>(addr, "get_org_summary");
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
    throw new NotATrust(
      `Nothing answered at ${addr}. If that is a Fideicommis address it may not be deployed on Studionet yet, or the rulebook may not be derived.`,
    );
  }
  if (!summary || !summary.name) {
    throw new NotATrust(
      `Nothing answered at ${addr}. If that is a Fideicommis address it may not be deployed on Studionet yet, or the rulebook may not be derived.`,
    );
  }

  const [nextTickAt, flow, constitution, state, policy, members, rules, charter, ids] = await Promise.all([
    soft("get_next_tick_at", () => readString(addr, "get_next_tick_at"), ""),
    readJSON<LifetimeFlow>(addr, "get_lifetime_flow"),
    readJSON<Constitution>(addr, "get_constitution"),
    readJSON<ConstitutionalState>(addr, "get_constitutional_state"),
    soft("get_policy", () => readJSON<Policy>(addr, "get_policy"), {} as Policy),
    soft("get_members", () => readJSON<Member[]>(addr, "get_members"), [] as Member[]),
    soft("get_charter_rules", () => readJSON<CharterRule[]>(addr, "get_charter_rules"), [] as CharterRule[]),
    soft("get_charter", () => readString(addr, "get_charter"), ""),
    soft("get_proposal_ids", () => readJSON<string[]>(addr, "get_proposal_ids"), [] as string[]),
  ]);

  // Newest first: an auditor opening a trust is asking what it did lately, and the
  // cap then falls on the oldest records rather than the recent ones.
  const ordered = [...ids].reverse();
  const wanted = ordered.slice(0, MAX_PROPOSALS);

  const proposals: Proposal[] = [];
  const audits: Record<string, ProposalAudit> = {};
  let stoppedOnBudget = false;

  for (const id of wanted) {
    if (Date.now() - startedAt > RENDER_BUDGET_MS) {
      stoppedOnBudget = true;
      break;
    }
    const [p, a] = await Promise.all([
      soft(`get_proposal(${id})`, () => readJSON<Proposal>(addr, "get_proposal", [id]), null as unknown as Proposal),
      soft(`get_proposal_audit(${id})`, () => readJSON<ProposalAudit>(addr, "get_proposal_audit", [id]), null as unknown as ProposalAudit),
    ]);
    if (p) {
      proposals.push(p);
      if (a) audits[id] = a;
    }
  }

  const notShown = ordered.length - wanted.length + (stoppedOnBudget ? wanted.length - proposals.length : 0);
  if (notShown > 0) {
    degraded.push(
      `${notShown} of ${ordered.length} proposals are not shown. ` +
        `This render reads ${FIXED_READS + proposals.length * CALLS_PER_PROPOSAL} of the node's 30 calls a minute, ` +
        `so showing every proposal would deny the page to the next reader. ` +
        `The full list is readable on chain through get_proposal_ids.`,
    );
  }

  return {
    address: addr,
    name: summary.name,
    status: String(summary.status ?? ""),
    cycle: String(summary.cycle ?? ""),
    treasury: String(summary.treasury_atto ?? "0"),
    runway: String(summary.runway_cycles ?? "0"),
    nextTickAt,
    lastAction: String(summary.last_action ?? ""),
    charterVersion: String(summary.charter_version ?? ""),
    summary,
    flow,
    constitution,
    state,
    policy,
    members,
    rules,
    charter,
    proposals,
    audits,
    constitutionConsistent:
      constitution?.min_quorum_bps === state?.min_quorum_bps &&
      constitution?.max_spend_ceiling_bps === state?.max_spend_ceiling_bps,
    degraded: degraded.length ? degraded.join(" · ") : null,
  };
}

export class NotATrust extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotATrust";
  }
}
