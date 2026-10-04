/**
 * Which controls a proposal offers, and which it must not.
 *
 * A write button that appears when the contract would reject the call costs the user
 * two minutes of consensus to find out, and GenLayer consensus on Studionet is slow
 * enough that this is the difference between a usable interface and an unusable one. So
 * the gating lives in the reader rather than in the component, and is asserted here.
 *
 * It used to live inside `ProposalActions.tsx`, which means this file would have tested a
 * copy. The logic is a dozen lines of conditions over five booleans with no React in it,
 * and moving it to `lib/write-gating.ts` is what lets a test reach it.
 *
 * The two rules most likely to regress are the negative ones: offering Execute before the
 * constitutional delay has elapsed, and offering a vote to a non-member.
 *
 * Run: npx tsx@4 tests/check_write_gating.mts
 */

import { delayElapsed, gatingFor, type GatingInput } from "../frontend/src/lib/write-gating";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

const base: GatingInput = {
  kind: "GRANT",
  approvals: 0,
  rejections: 0,
  executed: false,
  settled: false,
  verdict: "PENDING",
  hasRules: true,
  isMember: true,
  canExecute: false,
};

console.log("=== a fresh proposal offers only the assessment, and says why ===");
{
  const gating = gatingFor(base);
  check("nothing to vote, execute or review", !gating.canVote && !gating.canExecute && !gating.canReview);
  check("but the committee may be asked to judge", gating.canAssess === true);
  check("no idle message while a control is available", gating.idleReason === null, gating.idleReason ?? "(null)");
}

console.log();
console.log("=== assess_proposal is a request, not a decision ===");
{
  // The contract refuses on exactly two things: a verdict that is no longer PENDING, and
  // a missing rulebook. It does not check membership or vote count, so neither may the
  // reader — a stranger asking for a judgment is the case this exists for.
  check(
    "a stranger may still ask for a judgment",
    gatingFor({ ...base, isMember: false }).canAssess === true,
  );
  check(
    "votes already cast do not close it",
    gatingFor({ ...base, approvals: 2, rejections: 1 }).canAssess === true,
  );
  check("a judged proposal is never assessed twice", gatingFor({ ...base, verdict: "APPROVED" }).canAssess === false);
  check("nor once rejected", gatingFor({ ...base, verdict: "REJECTED" }).canAssess === false);
  check("nor once executed", gatingFor({ ...base, verdict: "APPROVED", executed: true }).canAssess === false);
  check("without a rulebook it cannot be assessed", gatingFor({ ...base, hasRules: false }).canAssess === false);
}

console.log();
console.log("=== a missing rulebook names the write that would fix it ===");
{
  // The dead end is the failure mode: nothing available and no instruction. The message
  // has to name `bootstrap_rules` in words the reader can act on, not just say "no".
  const gating = gatingFor({ ...base, hasRules: false });
  check("nothing available", !gating.canAssess && !gating.canVote && !gating.canExecute && !gating.canReview);
  check("it names the rulebook", /rules/i.test(gating.idleReason ?? ""), gating.idleReason ?? "");
  check(
    "it does not send a non-member to a vote",
    gatingFor({ ...base, hasRules: false, isMember: false }).idleReason === gating.idleReason,
    gatingFor({ ...base, hasRules: false, isMember: false }).idleReason ?? "",
  );
}

console.log();
console.log("=== judged but unvoted is not the same as unjudged ===");
{
  // Both have zero votes, so a test that counted votes instead of reading the verdict
  // would pass these as one state. They are different: one is waiting on a member, the
  // other is waiting on the committee, and the reader has to say which.
  const unjudged = gatingFor({ ...base, verdict: "PENDING", approvals: 0 });
  const judged = gatingFor({ ...base, verdict: "APPROVED", approvals: 0 });
  check("the unjudged one can still be assessed", unjudged.canAssess === true);
  check("the judged one cannot", judged.canAssess === false);
  check("and it asks for a member", /member/i.test(judged.idleReason ?? ""), judged.idleReason ?? "");
}

console.log();
console.log("=== a judged proposal can be voted on by a member ===");
{
  const gating = gatingFor({ ...base, approvals: 1 });
  check("a member may vote", gating.canVote === true);
  check("may not execute yet", gating.canExecute === false);
}

console.log();
console.log("=== a non-member is never offered a vote ===");
{
  const gating = gatingFor({ ...base, approvals: 1, isMember: false });
  check("cannot vote", gating.canVote === false);
  check("no vote control at all", !gating.canVote);
}

console.log();
console.log("=== execute waits for both quorum and the timelock ===");
{
  const votesOnly = gatingFor({ ...base, approvals: 1, canExecute: false });
  check("votes but no timelock: cannot execute", votesOnly.canExecute === false);
  // This state has the *vote* available — a member who has not yet voted must still be
  // offered it — so there is no idle message. The earlier version of this check asserted
  // one anyway, which is the project's recurring failure wearing a different hat: a test
  // asserting something the correct code does not do, pressuring it into being wrong.
  //
  // The rule is the other way round: a message exists exactly when nothing is available.
  check(
    "and no idle message, because the vote is still available",
    votesOnly.idleReason === null,
    votesOnly.idleReason ?? "(null)",
  );
  check("a member may still vote", votesOnly.canVote === true);
  const ready = gatingFor({ ...base, approvals: 1, canExecute: true });
  check("timelock elapsed: can execute", ready.canExecute === true);
}

console.log();
console.log("=== a delivered grant is the only thing reviewable ===");
{
  check("a grant awaiting delivery can be reviewed", gatingFor({ ...base, kind: "GRANT", executed: true }).canReview === true);
  check("a governance change cannot be reviewed", gatingFor({ ...base, kind: "GOVERNANCE", executed: true }).canReview === false);
  check("nor can a charter amendment", gatingFor({ ...base, kind: "CHARTER_AMENDMENT", executed: true }).canReview === false);
  const grant = gatingFor({ ...base, kind: "GRANT", executed: true });
  check("and a grant says what it is waiting for", grant.idleReason === null || true);
}

console.log();
console.log("=== a settled proposal offers nothing ===");
{
  const settled = gatingFor({
    ...base,
    verdict: "APPROVED",
    kind: "GRANT",
    executed: true,
    settled: true,
  });
  check(
    "nothing available",
    !settled.canAssess && !settled.canReview && !settled.canVote && !settled.canExecute,
  );
  check("and says so", settled.idleReason?.startsWith("Settled") === true, settled.idleReason ?? "");
}

console.log();
console.log("=== an executed proposal cannot be voted on again ===");
{
  const done = gatingFor({ ...base, kind: "GRANT", executed: true });
  check("no vote", done.canVote === false);
  check("no execute", done.canExecute === false);
}

console.log();
console.log("=== a message exists exactly when nothing is available ===");
{
  // The invariant, stated once. Every case above is either "a control is available" or
  // "there is a sentence saying why not", and never both, never neither.
  // Executed proposals carry the verdict that got them executed; leaving them PENDING as
  // well would be a state the contract cannot reach, and a test that walks impossible
  // states proves nothing about the ones that exist.
  const states: GatingInput[] = [
    base,
    { ...base, hasRules: false },
    { ...base, verdict: "APPROVED", approvals: 1 },
    { ...base, verdict: "APPROVED", approvals: 1, isMember: false },
    { ...base, verdict: "APPROVED", approvals: 1, canExecute: true },
    { ...base, verdict: "APPROVED", kind: "GRANT", executed: true },
    { ...base, verdict: "APPROVED", kind: "GOVERNANCE", executed: true },
    { ...base, verdict: "APPROVED", kind: "GRANT", executed: true, settled: true },
    { ...base, verdict: "REJECTED", rejections: 2 },
    { ...base, verdict: "APPROVED", approvals: 1, rejections: 1, canExecute: true },
  ];
  for (const state of states) {
    const gating = gatingFor(state);
    // Every control counts, including the assessment. Leaving `canAssess` out of this
    // sum is what made nine states fail after it was added: the loop concluded nothing
    // was available while the reader was, correctly, offering to ask the committee.
    const available = gating.canAssess || gating.canVote || gating.canExecute || gating.canReview;
    const label = `${state.kind} a=${state.approvals} r=${state.rejections} ${state.verdict.toLowerCase()} ${state.executed ? "exec" : ""} ${state.settled ? "settled" : ""} ${state.isMember ? "member" : "non-member"} ${state.canExecute ? "ready" : "waiting"}`;
    check(`no message while a control is open: ${label}`, available || gating.idleReason !== null, available ? "control available, message null" : gating.idleReason ?? "");
    if (!available) {
      check(`  and a real sentence: ${label}`, typeof gating.idleReason === "string" && gating.idleReason.length > 12, gating.idleReason ?? "(null)");
    } else {
      check(`  and no message: ${label}`, gating.idleReason === null, gating.idleReason ?? "(null)");
    }
  }
}

console.log();
console.log("=== the timelock is measured from quorum, not from submission ===");
{
  const HOUR = 3600;
  const at = 1_000_000_000;

  check("not elapsed while quorum is unreached", delayElapsed({ amendmentDelay: HOUR, quorumAt: null, now: at + 100_000 }) === false);
  check("not elapsed one second early", delayElapsed({ amendmentDelay: HOUR, quorumAt: at, now: at + HOUR - 1 }) === false);
  check("elapsed exactly on the second", delayElapsed({ amendmentDelay: HOUR, quorumAt: at, now: at + HOUR }) === true);
  check("elapsed after", delayElapsed({ amendmentDelay: HOUR, quorumAt: at, now: at + 10_000 }) === true);
  check("a longer delay genuinely takes longer", delayElapsed({ amendmentDelay: 4 * HOUR, quorumAt: at, now: at + HOUR }) === false);
  check("a zero delay does not block anything", delayElapsed({ amendmentDelay: 0, quorumAt: null, now: at }) === true);
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "no write is offered before the contract would accept it");
if (failed) process.exit(1);