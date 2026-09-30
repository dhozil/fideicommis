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

  // The name is the proof of life. Anything that is not a Fideicommis fails here,
  // and has to become a NotATrust so the page answers 404 with an explanation
  // rather than a 500: a raw SDK error here is what an address with no contract
  // behind it looks like.
  let name: string;
  try {
    name = await readString(addr, "get_org_name");
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
    throw new NotATrust(
      `Nothing answered at ${addr}. If that is a Fideicommis address it may not be deployed on Studionet yet, or the rulebook may not be derived.`,
    );
  }
  if (!name) {
    throw new NotATrust(
      `Nothing answered at ${addr}. If that is a Fideicommis address it may not be deployed on Studionet yet, or the rulebook may not be derived.`,
    );
  }

  const [status, cycle, treasury, runway, nextTickAt, lastAction, charterVersion] = await Promise.all([
    soft("get_status", () => readString(addr, "get_status"), ""),
    soft("get_cycle", () => readString(addr, "get_cycle"), ""),
    soft("get_treasury", () => readString(addr, "get_treasury"), "0"),
    soft("get_runway_cycles", () => readString(addr, "get_runway_cycles"), "0"),
    soft("get_next_tick_at", () => readString(addr, "get_next_tick_at"), ""),
    soft("get_last_action", () => readString(addr, "get_last_action"), ""),
    soft("get_charter_version", () => readString(addr, "get_charter_version"), ""),
  ]);

  const [summary, flow, constitution, state, policy, members, rules, charter, ids] = await Promise.all([
    soft("get_org_summary", () => readJSON<OrgSummary>(addr, "get_org_summary"), {} as OrgSummary),
    readJSON<LifetimeFlow>(addr, "get_lifetime_flow"),
    readJSON<Constitution>(addr, "get_constitution"),
    readJSON<ConstitutionalState>(addr, "get_constitutional_state"),
    soft("get_policy", () => readJSON<Policy>(addr, "get_policy"), {} as Policy),
    soft("get_members", () => readJSON<Member[]>(addr, "get_members"), [] as Member[]),
    soft("get_charter_rules", () => readJSON<CharterRule[]>(addr, "get_charter_rules"), [] as CharterRule[]),
    soft("get_charter", () => readString(addr, "get_charter"), ""),
    soft("get_proposal_ids", () => readJSON<string[]>(addr, "get_proposal_ids"), [] as string[]),
  ]);

  const proposals: Proposal[] = [];
  const audits: Record<string, ProposalAudit> = {};
  for (const id of ids) {
    const [p, a] = await Promise.all([
      soft(`get_proposal(${id})`, () => readJSON<Proposal>(addr, "get_proposal", [id]), null as unknown as Proposal),
      soft(`get_proposal_audit(${id})`, () => readJSON<ProposalAudit>(addr, "get_proposal_audit", [id]), null as unknown as ProposalAudit),
    ]);
    if (p) {
      proposals.push(p);
      if (a) audits[id] = a;
    }
  }

  return {
    address: addr,
    name,
    status,
    cycle,
    treasury,
    runway,
    nextTickAt,
    lastAction,
    charterVersion,
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
