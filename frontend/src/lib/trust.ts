import "server-only";

import { readJSON, readMany, parseView, RateLimitedError } from "./genlayer";
import { isAddress } from "./address";
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

/**
 * Read a whole trust in one pass.
 *
 * Every fixed view is gathered together, and the proposals are gathered together, so
 * a record costs two round trips rather than one per view. The measurements that
 * forced that are in genlayer.ts: ten concurrent reads take the same wall-clock time
 * as one, because the cost is the HTTP request and not the work behind it.
 *
 * Nothing here throws for a single failed call except a rate limit. A view that
 * answers "execution failed" for a trust that has not derived its rulebook yet is a
 * normal state, and the page should show what it can rather than refuse to render.
 * The one exception is a genuine limit, which the reader cannot work around by trying
 * again sooner.
 */

/**
 * What one render is allowed to cost.
 *
 * The cap and the deadline are here rather than in the client because the fix for a
 * render that is too expensive is to render less, not to retry harder. Retrying a
 * throttled request spends more of the budget it already exceeded, which is why the
 * two bounds are a count and a deadline: the count bounds a small trust, the deadline
 * bounds a large one that the count alone would not catch.
 *
 * The count is derived from the node's limit rather than guessed, so the two cannot
 * drift apart:
 *
 *     fixed reads            15
 *     per proposal            2   (the record, and the audit that explains it)
 *     node limit per minute  30
 *     slack                   2   so a second reader in the same minute still fits
 *     => (30 - 2 - 15) / 2 = 6
 *
 * Six proposals is 27 reads, which leaves the node answerable for the rest of the
 * minute. Seven would be exactly 30 and would consume all of it, so opening the same
 * trust in two tabs would be enough to throttle the second one: the ordinary case, not
 * an edge one. Reads are batched, so 28 reads is about two requests rather than 28.
 *
 * `FIXED_READS` was 10 when there were ten fixed views, and it stayed 10 through the
 * commit that added six more. Nothing failed: `MAX_PROPOSALS` was derived from the stale
 * constant, so a page asked for 34 reads against a 30-read budget and the node throttled
 * the second tab of the same trust — which is the exact outcome the arithmetic above
 * exists to prevent. The number is asserted by `tests/check_read_budget.mts`.
 */
const NODE_CALLS_PER_MINUTE = 30;
const SLACK_CALLS = 2;
const FIXED_READS = 15;
const CALLS_PER_PROPOSAL = 2;
const MAX_PROPOSALS = Math.floor((NODE_CALLS_PER_MINUTE - SLACK_CALLS - FIXED_READS) / CALLS_PER_PROPOSAL);

/**
 * A second bound, for the case the count does not catch. MAX_PROPOSALS is a read
 * count, and a slow node can spend a long time answering nine of them, which is a
 * timeout rather than a rate limit. The deadline is checked between batches so a
 * render that is running out of time stops and returns what it has, instead of being
 * killed by the platform holding the response open.
 */
const RENDER_BUDGET_MS = 20_000;

/**
 * How much of the mission log one render reads.
 *
 * The contract caps a page at `MAX_LOG` entries and accepts any `limit`, so this is a
 * choice rather than a limit imposed by the contract. Fifty is more than a reader can
 * usefully scan and small enough that the payload stays inside the render budget. The
 * page says how many it left out when the log is longer, because a log truncated
 * silently is indistinguishable from a log that ended.
 */
const MISSION_LOG_LIMIT = 50;

export async function readTrust(address: string): Promise<TrustRecord> {
  const addr = address.trim();
  if (!isAddress(addr)) {
    throw new NotATrust(
      `That is not a contract address. A Fideicommis address looks like 0x followed by 40 hex characters.`,
    );
  }

  const startedAt = Date.now();
  const degraded: string[] = [];

  // Sixteen fixed views in one batched read, and get_org_summary is first among them
  // because it is both the proof of life and the source of most of what the page shows.
  // It used to be read on its own first and the other nine after it, which cost a second
  // round trip for every page view in order to make a bad address fail cheaply. Batched,
  // a wrong address still produces a 404, and a right one saves a request: the wasted
  // reads on a bad address are calls inside a batch that was going to cost a request
  // anyway.
  //
  // The summary also answers the name, cycle, treasury, runway, last action and charter
  // version. Those were separate reads, which was calls spent re-reading data the
  // summary already carried — except for three that it does *not* carry. The status, the
  // raw treasury and the mission live behind their own views too, and this reader used to
  // assert nothing about them by simply never calling them. So `get_status`,
  // `get_treasury` and `get_mission` are read outright rather than assumed from the
  // summary, and the three that the contract keeps separately — `get_charter_history`
  // (which charter texts preceded this one), `get_evidence_urls` (what the committee is
  // allowed to see), and `get_mission_log` — come along in the same batch.
  const FIXED: { method: string; args?: unknown[] }[] = [
    { method: "get_org_summary" },
    { method: "get_next_tick_at" },
    { method: "get_lifetime_flow" },
    { method: "get_constitution" },
    { method: "get_constitutional_state" },
    { method: "get_policy" },
    { method: "get_members" },
    { method: "get_charter_rules" },
    { method: "get_charter" },
    { method: "get_proposal_ids" },
    { method: "get_status" },
    { method: "get_treasury" },
    // `get_mission` is deliberately absent: `get_org_summary` carries `mission`, and
    // reading it twice was a request spent re-reading data already in hand — the exact
    // thing the comment above this list complains about. `scripts/measure_reads.cjs`
    // printed the summary's seventeen fields, and `mission` is one of them.
    //
    // `get_status` and `get_treasury` stay even though the summary carries `status` and
    // `treasury_atto`, because those two are the cross-check: the Provenance panel shows
    // the direct view beside the aggregated one so a reader can see when they disagree.
    // Dropping them would save two requests and remove the only place in the reader that
    // compares two views of the same fact against each other.
    { method: "get_charter_history" },
    { method: "get_evidence_urls" },
    // `get_mission_log` is the one view here that takes arguments: `get_mission_log(
    // offset, limit)`. It was called with none, which is not an empty log — it is a
    // missing-parameter error, so every page load logged a degraded entry and the panel
    // showed an empty list as if the trust had no history. `scripts/audit_new_views.cjs`
    // is what caught it, and it asserts the call with arguments succeeds.
    { method: "get_mission_log", args: [0, MISSION_LOG_LIMIT] },
  ];

  const answers = await readMany(addr, FIXED);

  const keep = <T>(index: number, method: string, fallback: T): T => {
    const raw = answers[index];
    if (raw === null || raw === undefined) {
      degraded.push(`${method}: did not answer`);
      return fallback;
    }
    try {
      return parseView<T>(raw, method);
    } catch (err) {
      degraded.push(`${method}: ${(err as Error).message.slice(0, 90)}`);
      return fallback;
    }
  };

  const summary = keep<OrgSummary>(0, "get_org_summary", null as unknown as OrgSummary);
  if (!summary || !summary.name) {
    throw new NotATrust(
      `Nothing answered at ${addr}. If that is a Fideicommis address it may not be deployed on Studionet yet, or the rulebook may not be derived.`,
    );
  }

  const nextTickAtRaw = answers[1];
  const nextTickAt =
    nextTickAtRaw === null || nextTickAtRaw === undefined ? "" : String(nextTickAtRaw);
  const flow = keep<LifetimeFlow>(2, "get_lifetime_flow", {} as LifetimeFlow);
  const constitution = keep<Constitution>(3, "get_constitution", {} as Constitution);
  const state = keep<ConstitutionalState>(4, "get_constitutional_state", {} as ConstitutionalState);
  const policy = keep<Policy>(5, "get_policy", {} as Policy);
  const members = keep<Member[]>(6, "get_members", []);
  const rules = keep<CharterRule[]>(7, "get_charter_rules", []);
  const charterRaw = answers[8];
  const charter = charterRaw === null || charterRaw === undefined ? "" : String(charterRaw);
  const ids = keep<string[]>(9, "get_proposal_ids", []);

  // Six views the reader used to skip. Each is kept the way the page consumes it:
  // `status` and `treasury` plain because they are displayed verbatim, and the three
  // JSON-shaped ones parsed into lists — with a degraded entry rather than an exception
  // when the contract answers something unexpected, so one malformed view cannot take
  // down the whole record.
  const statusRaw = answers[10];
  const status = statusRaw === null || statusRaw === undefined ? "" : String(statusRaw);
  const treasuryRaw = answers[11];
  const treasury = treasuryRaw === null || treasuryRaw === undefined ? "" : String(treasuryRaw);
  // The mission comes from the summary, which carries it, rather than from `get_mission`.
  const mission = String(summary.mission ?? "");

  const decodeList = (index: number, method: string): string[] => {
    const raw = answers[index];
    if (raw === null || raw === undefined) return [];
    try {
      const parsed = parseView<unknown>(raw, method);
      if (Array.isArray(parsed)) return parsed.map(String);
      if (typeof parsed === "string") return parsed ? [parsed] : [];
      return [];
    } catch (err) {
      degraded.push(`${method}: ${(err as Error).message.slice(0, 90)}`);
      return [];
    }
  };

  const charterHistory = decodeList(12, "get_charter_history");
  const evidenceUrls = decodeList(13, "get_evidence_urls");
  const missionLog = decodeList(14, "get_mission_log");

  // Newest first: an auditor opening a trust is asking what it did lately, and the
  // cap then falls on the oldest records rather than the recent ones.
  const ordered = [...ids].reverse();
  const wanted = ordered.slice(0, MAX_PROPOSALS);

  const proposals: Proposal[] = [];
  const audits: Record<string, ProposalAudit> = {};
  let stoppedOnBudget = false;

  if (wanted.length && Date.now() - startedAt <= RENDER_BUDGET_MS) {
    // Both reads for every proposal, in one request. The audit is what makes a
    // decision auditable, so it is fetched with the record rather than lazily: a
    // reader that shows a verdict without its stated reason is not a reader.
    const proposalAnswers = await readMany(addr, [
      ...wanted.flatMap((id) => [
        { method: "get_proposal", args: [id] },
        { method: "get_proposal_audit", args: [id] },
      ]),
    ]);

    wanted.forEach((id, index) => {
      const record = proposalAnswers[index * 2];
      const audit = proposalAnswers[index * 2 + 1];
      if (record === null || record === undefined) {
        degraded.push(`get_proposal(${id}): did not answer`);
        return;
      }
      try {
        const parsed = parseView<Proposal>(record, "get_proposal");
        proposals.push(parsed);
        if (audit !== null && audit !== undefined) {
          audits[id] = parseView<ProposalAudit>(audit, "get_proposal_audit");
        }
      } catch (err) {
        degraded.push(`get_proposal(${id}): ${(err as Error).message.slice(0, 90)}`);
      }
    });
  } else if (wanted.length) {
    stoppedOnBudget = true;
  }

  const notShown = ordered.length - wanted.length + (stoppedOnBudget ? wanted.length : 0);
  if (notShown > 0) {
    degraded.push(
      `${notShown} of ${ordered.length} proposals are not shown. ` +
        `This render reads ${FIXED_READS + proposals.length * CALLS_PER_PROPOSAL} of the node's ${NODE_CALLS_PER_MINUTE} calls a minute, ` +
        `so showing every proposal would deny the page to the next reader. ` +
        `The full list is readable on chain through get_proposal_ids.`,
    );
  }

  return {
    address: addr,
    name: String(summary.name),
    // `summary.status` is what the contract aggregates; the direct view is kept beside
    // it on the page, so the two can be compared. They must agree, and a reader that
    // shows only one of them cannot tell when they do not.
    status: status || String(summary.status ?? ""),
    statusView: status,
    cycle: String(summary.cycle ?? ""),
    treasury: treasury || String(summary.treasury_atto ?? "0"),
    treasuryView: treasury,
    mission,
    charterHistory,
    evidenceUrls,
    missionLog,
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

// Re-exported so pages can catch one class regardless of which module threw it.
export { isAddress, RateLimitedError };
