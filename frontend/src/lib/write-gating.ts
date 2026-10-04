/**
 * Which controls a proposal offers, and which it must not.
 *
 * A write button that appears when the contract would reject the call costs the user
 * two minutes of consensus to find out, and GenLayer consensus on Studionet is slow
 * enough that this is the difference between a usable interface and an unusable one.
 *
 * So the gating lives here, in the reader, rather than inside the component. It used to
 * be inline in `ProposalActions.tsx`, which meant the only way to test it was to copy it
 * — and a test of a copy is the project's own recurring failure, so the logic was moved
 * out instead. It is twelve lines of conditions over five booleans and no React, which
 * is exactly what belongs beside the other pure readers.
 *
 * The rules most likely to regress are the negative ones: offering Execute before the
 * constitutional delay has elapsed, offering a vote to a non-member, and offering
 * `assess_proposal` after the committee has ruled or before the rulebook exists. All are
 * asserted by `tests/check_write_gating.mts`.
 */

export interface GatingInput {
  kind: string;
  approvals: number;
  rejections: number;
  executed: boolean;
  settled: boolean;
  /** Whether the committee has already ruled. `assess_proposal` refuses unless PENDING. */
  verdict: string;
  /** Whether the rulebook has been derived. `assess_proposal` refuses without it. */
  hasRules: boolean;
  /** Whether the connected address holds shares. Voting is a member act. */
  isMember: boolean;
  /** Whether quorum is met and the constitutional delay has elapsed. */
  canExecute: boolean;
}

export interface Gating {
  canAssess: boolean;
  canVote: boolean;
  canExecute: boolean;
  canReview: boolean;
  /** What to say when nothing is available, which is itself a real answer. */
  idleReason: string | null;
}

export function gatingFor(proposal: GatingInput): Gating {
  const votes = proposal.approvals + proposal.rejections;
  const isGrant = proposal.kind === "GRANT";

  // `assess_proposal` guards on exactly two things: the verdict is still PENDING, and
  // the rulebook exists. It is permissionless — no member check, no vote-count check —
  // because asking the committee to judge is not a decision, it is a request. An earlier
  // version of the panel also required zero votes, which the contract never asked for.
  const canAssess = proposal.verdict === "PENDING" && proposal.hasRules;

  const canVote = !proposal.executed && votes > 0 && proposal.isMember;
  const canExecute = !proposal.executed && votes > 0 && proposal.canExecute;
  // Only a grant has anything to deliver, so only a grant can be reviewed. Offering a
  // review on a charter amendment would ask for evidence of something that never shipped.
  const canReview = isGrant && proposal.executed && !proposal.settled;

  // A member who has already voted is told they are waiting, not shown a reason about
  // membership. `idleReason` is only reached when *nothing* is available, so the vote
  // branch has to consider that a member may have both voted and still be waiting — the
  // common case, and the one the previous version answered with the wrong sentence.
  let idleReason: string | null = null;
  if (!canAssess && !canVote && !canExecute && !canReview) {
    if (proposal.settled) {
      idleReason = "Settled. Nothing further to do here.";
    } else if (proposal.executed) {
      idleReason = isGrant
        ? "Waiting for a delivery review before the next tranche can be released."
        : "In force. There is nothing to deliver, so there is nothing to review.";
    } else if (!proposal.hasRules) {
      // Without the rulebook there is nothing for the committee to judge against, so the
      // write that would unstick this is not the one on this panel. Naming the real one
      // is the difference between a dead end and an instruction.
      idleReason = "The charter has no derived rules yet, so nothing can be judged. Derive them first.";
    } else if (votes === 0) {
      idleReason = "The committee has judged it and nobody has voted. Only a member can vote.";
    } else if (proposal.canExecute) {
      idleReason = "Nothing available, though the delay has passed. Reload the record.";
    } else if (proposal.isMember) {
      idleReason = "Waiting for the constitutional delay before this can take effect.";
    } else {
      idleReason = "Only a member of this trust may vote on it.";
    }
  }

  return { canAssess, canVote, canExecute, canReview, idleReason };
}

/**
 * Whether the constitutional delay has elapsed.
 *
 * The delay is read from the contract rather than a constant here, and it is measured
 * from when quorum was *reached* rather than from when the proposal was submitted —
 * which is this project's own rule, and the reason a trust that raises its delay cannot
 * be raced by a vote that landed early.
 */
export function delayElapsed(input: {
  /** Seconds the contract says it waits. */
  amendmentDelay: number;
  /** Unix seconds at which quorum was reached, or null if it has not been. */
  quorumAt: number | null;
  now: number;
}): boolean {
  if (input.amendmentDelay <= 0) return true;
  if (input.quorumAt === null) return false;
  return input.now - input.quorumAt >= input.amendmentDelay;
}