import { gen, isConstitutional, quorumHeldByOne, shortAddress } from "@/lib/format";
import type { ConstitutionalState, Member, Proposal, ProposalAudit } from "@/lib/types";

type Step = {
  name: string;
  what: string;
  got: string;
  state: "done" | "blocked" | "waiting" | "inapplicable";
};

const HOURS = 3600;

/**
 * The chain a decision actually went through.
 *
 * The steps are numbered because the order is the content: money cannot leave
 * before it is proposed, judged and voted, and a settlement cannot happen before
 * the delivery is reviewed. A charter rewrite is not a grant, so its last three
 * steps are marked rather than shown as failures.
 */
function chain(p: Proposal, quorum: boolean | null, delaySeconds: number): Step[] {
  const steps: Step[] = [];
  const add = (name: string, what: string, got: string, state: Step["state"]) => steps.push({ name, what, got, state });

  add("Proposed", "Anyone may", "on the record", "done");

  if (p.verdict === "PENDING") add("Judged", "Committee assessment", "not yet assessed", "waiting");
  else if (p.verdict === "NON_COMPLIANT") add("Judged", "Committee assessment", "NON_COMPLIANT", "blocked");
  else if (p.verdict === "COMPLIANT") add("Judged", "Committee assessment", "COMPLIANT", "done");
  else add("Judged", "Committee assessment", String(p.verdict), "waiting");

  const approvals = Number(p.approvals);
  const rejections = Number(p.rejections);

  if (rejections > 0) add("Voted", `${approvals} for, ${rejections} against`, "rejected", "blocked");
  else if (quorum === false) add("Voted", `${approvals} approval${approvals === 1 ? "" : "s"}`, "quorum not reached", "blocked");
  else if (approvals === 0) add("Voted", "no votes yet", "not started", "waiting");
  else add("Voted", `${approvals} approval${approvals === 1 ? "" : "s"}`, "quorum met", "done");

  if (isConstitutional(p.kind)) {
    if (p.executed) add("In force", "Constitutional change", "took effect", "done");
    else if (quorum !== false && approvals > 0)
      add("In force", "Constitutional change", `waiting out ${Math.round(delaySeconds / HOURS)} h`, "waiting");
    else add("In force", "Constitutional change", "not approved", "inapplicable");
    add("Funded", "Grant released", "not a grant", "inapplicable");
    add("Reviewed", "Delivery reviewed", "not a grant", "inapplicable");
    add("Settled", "Remainder settled", "not a grant", "inapplicable");
    return steps;
  }

  add(
    "Funded",
    p.executed ? "Grant released" : "Awaiting release",
    p.executed ? gen(p.amount_atto) : "not paid out",
    p.executed ? "done" : "waiting",
  );

  if (!p.delivery_verdict || p.delivery_verdict === "NONE") add("Reviewed", "Delivery reviewed", "not reviewed", "waiting");
  else if (p.delivery_verdict === "ACCEPTED")
    add("Reviewed", `Delivery reviewed, scored ${p.delivery_score}`, gen(p.delivery_payout), "done");
  else add("Reviewed", "Delivery reviewed", String(p.delivery_verdict), "blocked");

  add("Settled", "Remainder settled", p.settled ? gen(p.delivery_payout) : "not settled", p.settled ? "done" : "waiting");
  return steps;
}

export function Decision({
  proposal,
  audit,
  state,
  members,
  quorum,
}: {
  proposal: Proposal;
  audit?: ProposalAudit;
  state: ConstitutionalState;
  members: Member[];
  quorum: boolean | null;
}) {
  const steps = chain(proposal, quorum, state.amendment_delay);
  const constitutional = isConstitutional(proposal.kind);
  const violations = proposal.violations ?? [];

  const holding = constitutional && !proposal.executed && quorum !== false && Number(proposal.approvals) > 0;

  return (
    <article className="decision">
      <div className="head">
        <span className="pid">{proposal.id}</span>
        <span className="kind">{String(proposal.kind).replace(/_/g, " ")}</span>
        <h3>{proposal.title}</h3>
      </div>

      <div>
        <span className={proposal.verdict === "NON_COMPLIANT" ? "chop bad" : proposal.verdict === "PENDING" ? "chop pending" : "chop"}>
          {String(proposal.verdict).toLowerCase()}
        </span>
        {proposal.delivery_verdict && proposal.delivery_verdict !== "NONE" ? (
          <span className={proposal.delivery_verdict === "ACCEPTED" ? "chop" : "chop bad"}>
            {String(proposal.delivery_verdict).toLowerCase()}
          </span>
        ) : null}
      </div>

      {violations.length > 0 ? (
        <p className="prose">
          <strong>Rules cited as broken:</strong> {violations.join(", ")}
        </p>
      ) : null}

      <div className="chain">
        {steps.map((s) => (
          <div key={s.name} className={`step ${s.state}`}>
            <div className="n">{s.name}</div>
            <div className="what">{s.what}</div>
            <div className="got">{s.got}</div>
          </div>
        ))}
      </div>

      <p className="prose">
        {proposal.recipient ? (
          <>
            To <strong>{shortAddress(proposal.recipient)}</strong>
            {members.some((m) => m.address?.toLowerCase() === proposal.recipient?.toLowerCase()) ? ", a member" : ", a non-member beneficiary"}
            {Number(proposal.amount_atto) > 0 ? (
              <>
                {" "}· asked for <strong>{gen(proposal.amount_atto)} GEN</strong>
              </>
            ) : null}
          </>
        ) : (
          "No recipient: nothing was paid out."
        )}
      </p>

      {holding ? (
        <div className="hold">
          Approved, but not in force. A constitutional change does not take effect the moment it is voted on; it has to sit
          through its {Math.round(state.amendment_delay / HOURS)}-hour delay first.
          <span className="when">
            The contract records when quorum was reached but does not expose that timestamp as a view, so the remaining time
            cannot be read from here. Calling <code>get_proposal_audit({proposal.id})</code> and comparing it with the block
            time of the vote is the way to check it.
          </span>
        </div>
      ) : null}

      {audit?.rationale ? (
        <div className="why-block">
          <div className="attribution">The committee&apos;s reasoning for the verdict</div>
          <p>{audit.rationale}</p>
        </div>
      ) : null}

      {audit?.delivery_rationale ? (
        <div className="why-block">
          <div className="attribution">The committee&apos;s reasoning for the delivery</div>
          <p>{audit.delivery_rationale}</p>
        </div>
      ) : null}

      {audit?.body ? (
        <div className="why-block">
          <div className="attribution">The text that was actually voted on</div>
          <p>{audit.body}</p>
        </div>
      ) : null}
    </article>
  );
}

export function DecisionList({
  proposals,
  audits,
  state,
  members,
}: {
  proposals: Proposal[];
  audits: Record<string, ProposalAudit>;
  state: ConstitutionalState;
  members: Member[];
}) {
  if (!proposals.length) {
    return <p className="empty">This trust has no proposals yet. Nothing has asked it for anything, which is a fact about it worth knowing.</p>;
  }
  const quorum = quorumHeldByOne(members, state.total_shares, state.quorum_bps);
  return (
    <div className="decisions">
      {proposals.map((p) => (
        <Decision key={p.id} proposal={p} audit={audits[p.id]} state={state} members={members} quorum={quorum} />
      ))}
    </div>
  );
}
