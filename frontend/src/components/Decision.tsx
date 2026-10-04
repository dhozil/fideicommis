import { gen, isConstitutional, quorumHeldByOne, shortAddress } from "@/lib/format";
import { addressOnExplorer } from "@/lib/explorer";
import type { ConstitutionalState, Member, Proposal, ProposalAudit } from "@/lib/types";
import { ProposalActions } from "@/components/ProposalActions";
import { useWallet } from "@/lib/wallet";

/** Shares are held as a decimal string by the contract, so a string compare is wrong. */
function holdsShares(member: Member | undefined): boolean {
  return member !== undefined && BigInt(member.shares || "0") > 0n;
}

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
 * The steps are numbered because the order is the content: money cannot leave before
 * it is proposed, judged and voted, and a settlement cannot happen before delivery is
 * reviewed. A charter rewrite is not a grant, so its last three steps are marked as
 * not applicable rather than shown as though they had failed.
 */
function chain(p: Proposal, quorum: boolean | null, delaySeconds: number): Step[] {
  const steps: Step[] = [];
  const add = (name: string, what: string, got: string, state: Step["state"]) =>
    steps.push({ name, what, got, state });

  add("Proposed", "anyone may", "on the record", "done");

  if (p.verdict === "PENDING") add("Judged", "committee assessment", "not yet assessed", "waiting");
  else if (p.verdict === "NON_COMPLIANT") add("Judged", "committee assessment", "judged non-compliant", "blocked");
  else if (p.verdict === "COMPLIANT") add("Judged", "committee assessment", "judged compliant", "done");
  else add("Judged", "committee assessment", String(p.verdict).toLowerCase(), "waiting");

  const approvals = Number(p.approvals);
  const rejections = Number(p.rejections);

  if (rejections > 0)
    add("Voted", `${approvals} for, ${rejections} against`, "rejected", "blocked");
  else if (quorum === false)
    add("Voted", `${approvals} approval${approvals === 1 ? "" : "s"}`, "quorum not reached", "blocked");
  else if (approvals === 0) add("Voted", "no votes yet", "not started", "waiting");
  else add("Voted", `${approvals} approval${approvals === 1 ? "" : "s"}`, "quorum met", "done");

  if (isConstitutional(p.kind)) {
    if (p.executed) add("In force", "constitutional change", "took effect", "done");
    else if (quorum !== false && approvals > 0)
      add("In force", "constitutional change", `waiting out ${Math.round(delaySeconds / HOURS)} h`, "waiting");
    else add("In force", "constitutional change", "not approved", "inapplicable");
    add("Funded", "grant released", "not a grant", "inapplicable");
    add("Reviewed", "delivery reviewed", "not a grant", "inapplicable");
    add("Settled", "remainder settled", "not a grant", "inapplicable");
    return steps;
  }

  add(
    "Funded",
    p.executed ? "grant released" : "awaiting release",
    p.executed ? gen(p.amount_atto) : "not paid out",
    p.executed ? "done" : "waiting",
  );

  if (!p.delivery_verdict || p.delivery_verdict === "NONE")
    add("Reviewed", "delivery reviewed", "not reviewed", "waiting");
  else if (p.delivery_verdict === "ACCEPTED")
    add("Reviewed", `delivery reviewed, scored ${p.delivery_score}`, gen(p.delivery_payout), "done");
  else add("Reviewed", "delivery reviewed", String(p.delivery_verdict).toLowerCase(), "blocked");

  add(
    "Settled",
    "remainder settled",
    p.settled ? gen(p.delivery_payout) : "not settled",
    p.settled ? "done" : "waiting",
  );
  return steps;
}

export function Decision({
  proposal,
  audit,
  state,
  members,
  quorum,
  trust,
}: {
  proposal: Proposal;
  audit?: ProposalAudit;
  state: ConstitutionalState;
  members: Member[];
  quorum: boolean | null;
  /** The trust's own address, needed by every write. */
  trust: string;
}) {
  const { address } = useWallet();
  const steps = chain(proposal, quorum, state.amendment_delay);
  const constitutional = isConstitutional(proposal.kind);
  const violations = proposal.violations ?? [];
  const holding =
    constitutional && !proposal.executed && quorum !== false && Number(proposal.approvals) > 0;

  const verdict = String(proposal.verdict);
  const verdictClass =
    verdict === "COMPLIANT" ? "compliant" : verdict === "NON_COMPLIANT" ? "non-compliant" : "pending";

  return (
    <article className={`record ${verdictClass}`}>
      <div className="record-head">
        <span className="tag">{proposal.id}</span>
        <span className="record-title">{proposal.title}</span>
        <span className={`mark ${verdictClass}`} style={{ marginLeft: "auto" }}>
          {verdict.toLowerCase().replace("_", " ")}
        </span>
      </div>

      <div className="record-meta">
        <span>{String(proposal.kind).replace(/_/g, " ").toLowerCase()}</span>
        <span>{constitutional ? "constitutional" : `${gen(proposal.amount_atto)} GEN asked`}</span>
        <span>{Number(proposal.approvals)} for, {Number(proposal.rejections)} against</span>
        {proposal.executed ? <span style={{ color: "var(--verified)" }}>executed</span> : null}
      </div>

      {proposal.delivery_verdict && proposal.delivery_verdict !== "NONE" ? (
        <p className="record-meta" style={{ marginTop: 8 }}>
          <span className={`mark ${proposal.delivery_verdict === "ACCEPTED" ? "compliant" : "non-compliant"}`}>
            delivery {String(proposal.delivery_verdict).toLowerCase()}
          </span>
        </p>
      ) : null}

      {violations.length > 0 ? (
        <p className="record-block" style={{ marginTop: 10, paddingTop: 10 }}>
          <span style={{ color: "var(--breach)", fontFamily: "var(--data)", fontSize: "0.78rem" }}>
            cited as broken: {violations.join(", ")}
          </span>
        </p>
      ) : null}

      {/*
        The steps are an ordered sequence, so they are numbered rather than bulleted:
        the numbering carries the fact that money cannot leave before judgement and a
        vote, which is the thing a reader is here to check.
      */}
      <ol className="record-block" style={{ listStyle: "none", margin: "14px 0 0", padding: "12px 0 0" }}>
        {steps.map((step, index) => (
          <li
            key={step.name}
            style={{
              display: "grid",
              gridTemplateColumns: "26px 1fr auto",
              gap: 12,
              padding: "6px 0",
              borderTop: "1px solid var(--rule)",
              fontSize: "0.86rem",
              alignItems: "baseline",
            }}
          >
            <span
              className="data faint"
              style={{ fontSize: "0.7rem" }}
              aria-hidden="true"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              style={{
                color: step.state === "blocked" ? "var(--breach)" : step.state === "done" ? "var(--ink)" : "var(--ink-dim)",
              }}
            >
              {step.what}
            </span>
            <span
              className="data"
              style={{
                fontSize: "0.76rem",
                color:
                  step.state === "done"
                    ? "var(--verified)"
                    : step.state === "blocked"
                      ? "var(--breach)"
                      : "var(--ink-faint)",
                textAlign: "right",
              }}
            >
              {step.got}
            </span>
          </li>
        ))}
      </ol>

      <p className="record-block" style={{ fontSize: "0.9rem" }}>
        {proposal.recipient ? (
          <>
            To{" "}
            <a
              href={addressOnExplorer(proposal.recipient)}
              target="_blank"
              rel="noreferrer noopener"
              className="data"
              style={{ fontSize: "0.84em" }}
            >
              {shortAddress(proposal.recipient)}
            </a>
            ,{" "}
            {members.some(
              (m) => m.address?.toLowerCase() === proposal.recipient?.toLowerCase(),
            )
              ? "a member"
              : "a non-member beneficiary"}
            {Number(proposal.amount_atto) > 0 ? (
              <>
                {" "}· asked for <strong>{gen(proposal.amount_atto)} GEN</strong>
              </>
            ) : null}
          </>
        ) : (
          "No recipient, so nothing was paid out."
        )}
      </p>

      {holding ? (
        <div className="notice warn" style={{ marginTop: 14 }}>
          <strong>Approved, not yet in force.</strong> A constitutional change has to
          sit through its {Math.round(state.amendment_delay / HOURS)}-hour delay, and
          the clock starts when quorum was reached rather than when it was proposed.
          <br />
          <span className="faint" style={{ fontSize: "0.85rem" }}>
            The contract records that moment but does not expose it as a view, so the
            remaining time cannot be read from here. Compare the audit with the block
            time of the vote on the explorer.
          </span>
        </div>
      ) : null}

      <ProposalActions
        trust={trust}
        proposal={proposal}
        audit={audit}
        account={address ?? undefined}
        isMember={holdsShares(
          address ? members.find((m) => m.address.toLowerCase() === address.toLowerCase()) : undefined,
        )}
        quorumMet={quorum === true}
      />

      {audit?.rationale ? (
        <div className="record-block">
          <h5>Why the committee reached that verdict</h5>
          <p>{audit.rationale}</p>
        </div>
      ) : null}

      {audit?.delivery_rationale ? (
        <div className="record-block">
          <h5>Why the committee reached that on delivery</h5>
          <p>{audit.delivery_rationale}</p>
        </div>
      ) : null}

      {audit?.body ? (
        <div className="record-block">
          <h5>The text that was actually voted on</h5>
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
  trust,
}: {
  proposals: Proposal[];
  audits: Record<string, ProposalAudit>;
  state: ConstitutionalState;
  members: Member[];
  trust: string;
}) {
  if (!proposals.length) {
    return (
      <div className="panel">
        <h3>Nothing has been asked of this trust</h3>
        <p className="muted" style={{ marginBottom: 0 }}>
          No proposals yet, so no money has moved and no charter has changed. For a
          trust that has only just been deployed that is the expected state, and it
          is worth knowing rather than being left to guess.
        </p>
      </div>
    );
  }

  const quorum = quorumHeldByOne(members, state.total_shares, state.quorum_bps);

  return (
    <div>
      {proposals.map((proposal) => (
        <Decision
          key={proposal.id}
          proposal={proposal}
          audit={audits[proposal.id]}
          state={state}
          members={members}
          quorum={quorum}
          trust={trust}
        />
      ))}
    </div>
  );
}
