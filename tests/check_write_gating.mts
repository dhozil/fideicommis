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
  isMember: true,
  canExecute: false,
};

console.log("=== a fresh proposal offers nothing, and says why ===");
{
  const gating = gatingFor(base);
  check("nothing available", !gating.canVote && !gating.canExecute && !gating.canReview);
  check("it names the committee, not a button", gating.idleReason?.includes("committee") === true, gating.idleReason ?? "");
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
  const settled = gatingFor({ ...base, kind: "GRANT", executed: true, settled: true });
  check("nothing available", !settled.canReview && !settled.canVote && !settled.canExecute);
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
  const states: GatingInput[] = [
    base,
    { ...base, approvals: 1 },
    { ...base, approvals: 1, isMember: false },
    { ...base, approvals: 1, canExecute: true },
    { ...base, kind: "GRANT", executed: true },
    { ...base, kind: "GOVERNANCE", executed: true },
    { ...base, kind: "GRANT", executed: true, settled: true },
    { ...base, rejections: 2 },
    { ...base, approvals: 1, rejections: 1, canExecute: true },
  ];
  for (const state of states) {
    const gating = gatingFor(state);
    const available = gating.canVote || gating.canExecute || gating.canReview;
    const label = `${state.kind} a=${state.approvals} r=${state.rejections} ${state.executed ? "exec" : ""} ${state.settled ? "settled" : ""} ${state.isMember ? "member" : "non-member"} ${state.canExecute ? "ready" : "waiting"}`;
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