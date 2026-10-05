/**
 * The shape of what a Fideicommis exposes, as the contract declares it.
 *
 * These are hand-written against the contract rather than generated, because a
 * generated type from a node's own schema would be silently wrong the moment the
 * contract changed, and this file is a place where a change has to be noticed.
 */

export type Verdict = "PENDING" | "COMPLIANT" | "NON_COMPLIANT" | "UNDETERMINED";
export type DeliveryVerdict = "NONE" | "ACCEPTED" | "REJECTED" | "UNDETERMINED";
export type ProposalKind = "GRANT" | "CHARTER_AMENDMENT" | "GOVERNANCE";

/** The identity that can be falsified: inflow must equal the sum of these plus the treasury. */
export interface LifetimeFlow {
  inflow_atto: string;
  outflow_atto: string;
  keeper_paid_atto: string;
  granted_atto: string;
  settled_atto: string;
  dissolved_atto: string;
  burned_atto: string;
  treasury_atto: string;
  conserved_atto: string;
}

/** Only what a vote cannot change. Separate so a reader can assert on it. */
export interface Constitution {
  amendment_delay: number;
  constitutional_kinds: string[];
  governance_fields: string[];
  max_spend_ceiling_bps: number;
  min_quorum_bps: number;
}

/** What a vote can change, alongside the limits it cannot cross. */
export interface ConstitutionalState {
  amendment_delay: number;
  charter_version: number;
  max_spend_ceiling_bps: number;
  min_quorum_bps: number;
  quorum_bps: number;
  spend_ceiling_bps: number;
  total_shares: number;
}

export interface Policy {
  burn_per_cycle: number;
  keeper_reward: number;
  quorum_bps: number;
  spend_ceiling_atto: string;
  spend_ceiling_bps: number;
  tick_interval: number;
}

export interface Member {
  address: string;
  shares: string;
}

export interface CharterRule {
  id: string;
  text: string;
}

export interface Proposal {
  id: string;
  kind: ProposalKind | string;
  title: string;
  amount_atto: string;
  recipient: string;
  verdict: Verdict | string;
  approvals: string;
  rejections: string;
  executed: boolean;
  delivery_verdict: DeliveryVerdict | string;
  delivery_score: number;
  delivery_payout: string;
  settled: boolean;
  violations: string[];
  body_len: number;
}

export interface ProposalAudit {
  id: string;
  kind: string;
  verdict: string;
  has_violation: boolean;
  violations: string[];
  rationale: string;
  confidence: number;
  delivery_verdict: string;
  delivery_score: number;
  delivery_payout: string;
  delivery_rationale: string;
  body: string;
}

export interface OrgSummary {
  name: string;
  status: string;
  treasury_atto: string;
  charter_version: number;
  cycle: number;
  proposal_count: number;
  last_action: string;
  keeper_count: number;
  keeper_paid_atto: string;
  runway_cycles: number;
  [key: string]: unknown;
}

/** Everything the audit page needs, read in one paced pass. */
export interface TrustRecord {
  address: string;
  name: string;
  status: string;
  /** What `get_status` itself says. Kept so the page can compare it with the summary. */
  statusView: string;
  cycle: string;
  treasury: string;
  /** What `get_treasury` itself says. Kept so the page can compare it with the summary. */
  treasuryView: string;
  /** The mission as declared at genesis, in the contract's own words. */
  mission: string;
  /** The charter texts that preceded this one, oldest first. */
  charterHistory: string[];
  /** The sources the committee is allowed to consult. */
  evidenceUrls: string[];
  /** Updates to the mission, in order. */
  missionLog: string[];
  runway: string;
  nextTickAt: string;
  lastAction: string;
  charterVersion: string;
  summary: OrgSummary;
  flow: LifetimeFlow;
  constitution: Constitution;
  state: ConstitutionalState;
  policy: Policy;
  members: Member[];
  rules: CharterRule[];
  charter: string;
  proposals: Proposal[];
  audits: Record<string, ProposalAudit>;
  /** False when the two constitution views disagree, which means do not trust this trust. */
  constitutionConsistent: boolean;
  /** Set when something could not be read, so the page can say which call failed. */
  degraded: string | null;
  /**
   * Writes this deployment does not have.
   *
   * Studionet cannot upgrade a contract, so a trust deployed from an earlier source is
   * missing whatever the contract gained since. Offering a button for a method that is not
   * there produces a node refusal that does not name the method, so the reader asks instead.
   * See `lib/capabilities.ts` — including the two obvious ways of finding out that do not
   * work, one of which reports every method as missing.
   */
  missingWrites: string[];
  /** False when the probe failed, so `missingWrites` is empty because nothing was ruled out. */
  capabilitiesVerified: boolean;
}

/**
 * The three-call read the landing page and the directory use.
 *
 * It lives here rather than beside the function that produces it, because a client
 * component needs the type and must not import the module that holds the chain
 * client. The server-only boundary is on the module, not on the shape.
 */
export interface FeaturedTrust {
  address: string;
  name: string;
  status: string;
  treasury: string;
  runway: number;
  charterVersion: number;
  cycle: number;
  flow: LifetimeFlow | null;
  /** False when the node could not be read. The page says so rather than guessing. */
  reachable: boolean;
}

/**
 * One entry in the trust directory.
 *
 * The purpose and the note are written by whoever added the entry. The address is a
 * starting point, not a claim: every figure shown for it is read live from the
 * contract, so a stale entry shows as stale rather than being repeated as fact.
 */
export interface ListedTrust {
  address: string;
  purpose: string;
  note: string;
}
