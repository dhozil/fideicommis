"use client";

import { useState } from "react";
import {
  assessProposal,
  castVote,
  executeProposal,
  parseGen,
  reviewDelivery,
  submitProposal,
} from "@/lib/actions";
import type { Proposal, ProposalAudit } from "@/lib/types";
import { useWallet } from "@/lib/wallet";
import { isAddress } from "@/lib/address";
import { gen } from "@/lib/format";
import { WritePanel, type WriteButton } from "@/components/WritePanel";
import { gatingFor } from "@/lib/write-gating";

/**
 * Everything that can be done to a proposal.
 *
 * A proposal moves through a fixed sequence, and each step is only available while the
 * contract would accept it. So the controls are not chosen by a hand-maintained list of
 * which buttons go here — they are derived from the proposal's own fields, through
 * `gatingFor`, which is tested in `tests/check_write_gating.mts`. A button that appears
 * when the contract would reject the call costs the user two minutes of consensus to
 * find out.
 *
 * The sequence:
 *
 *   proposed  -> assessed by the committee
 *   assessed  -> members vote
 *   voted + quorum + timelock -> execute
 *   executed  -> review        grants only; a charter rewrite has nothing to deliver
 *   reviewed  -> settled       the money moves
 *
 * `assess_proposal` is deliberately absent: it is the committee's call, and there is
 * nothing for a person to press.
 */

const KIND_LABEL: Record<string, string> = {
  GRANT: "Grant",
  CHARTER_AMENDMENT: "Charter amendment",
  GOVERNANCE: "Governance",
};

export function ProposalActions({
  trust,
  proposal,
  audit,
  account,
  isMember,
  quorumMet,
  hasRules,
  missing,
}: {
  trust: string;
  proposal: Proposal;
  audit?: ProposalAudit;
  account?: string;
  /** Whether the charter's rulebook has been derived. `assess_proposal` refuses without it. */
  hasRules: boolean;
  /**
   * Writes this deployment does not have. Studionet cannot upgrade a contract, so a trust
   * deployed before `assess_proposal` existed cannot be asked to judge at all. Empty means
   * every button may be offered, which is also what an unverified probe reports — see
   * `lib/capabilities.ts`.
   */
  missing?: string[];
  isMember: boolean;
  /** Whether enough shares voted for quorum. */
  quorumMet: boolean;
}) {
  const [evidence, setEvidence] = useState("");

  const gating = gatingFor({
    kind: proposal.kind,
    approvals: Number(proposal.approvals || 0),
    rejections: Number(proposal.rejections || 0),
    executed: proposal.executed,
    settled: proposal.settled,
    isMember,
    verdict: proposal.verdict,
    hasRules,
    // Quorum met is the most this reader can know. The contract stamps the timelock when
    // quorum is *reached* and keeps that timestamp in `op_ready_at`, which is not a view —
    // `get_proposal` returns no such field. So the delay cannot be computed here, and the
    // panel says so rather than guessing. Offering Execute on quorum alone costs a user
    // two minutes of consensus when the delay has not passed; refusing to offer it at
    // all would block a proposal that is genuinely ready, which is worse. The contract
    // is the authority and its refusal is shown verbatim.
    canExecute: quorumMet,
  });

  // Asking the committee to judge is permissionless and is a request, not a decision,
  // so the gate is only the two things the contract itself refuses on: no rulebook yet,
  // or a verdict that is no longer PENDING. Both live in `gatingFor` so they are tested.
  const buttons: WriteButton[] = [];
  const absent = new Set(missing ?? []);
  if (gating.canAssess && !absent.has("assess_proposal")) {
    buttons.push({
      action: "assess",
      label: "Ask the committee to judge",
      busyLabel: "Asking…",
      onRun: () => assessProposal(trust, proposal.id, account, undefined),
    });
  }

  if (gating.canVote) {
    buttons.push({
      action: "vote",
      label: "Approve",
      busyLabel: "Voting…",
      onRun: () => castVote(trust, proposal.id, true, account, undefined),
    });
    buttons.push({
      action: "vote",
      label: "Reject",
      busyLabel: "Voting…",
      tone: "danger",
      onRun: () => castVote(trust, proposal.id, false, account, undefined),
    });
  }

  if (gating.canExecute) {
    buttons.push({
      action: "execute",
      label: proposal.kind === "GRANT" ? "Release the grant" : "Put it into force",
      busyLabel: "Executing…",
      tone: "quiet",
      onRun: () => executeProposal(trust, proposal.id, account, undefined),
    });
  }

  if (gating.canReview) {
    buttons.push({
      action: "review",
      label: "Review the delivery",
      busyLabel: "Submitting…",
      disabled: evidence.trim().length === 0,
      reason:
        evidence.trim().length === 0 ? "A public link to the evidence is required." : undefined,
      onRun: () => reviewDelivery(trust, proposal.id, evidence.trim(), account, undefined),
    });
  }

  // Nothing available is a real answer, and it names which of the five states this is.
  if (!buttons.length) {
    return (
      <>
        <p className="write-reason">
          {gating.idleReason}
          {audit?.rationale ? ` The committee said: ${audit.rationale}` : ""}
        </p>
        {quorumMet && !proposal.executed ? (
          <p className="faint" style={{ fontSize: "0.78rem", margin: "8px 0 0" }}>
            The contract stamps the delay from when quorum was reached and does not expose
            that timestamp as a view, so this page cannot say whether it has passed. The
            contract is the authority and its refusal, if any, is shown in full.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <WritePanel buttons={buttons}>
      {quorumMet && !proposal.executed && gating.canExecute ? (
        <p className="faint" style={{ fontSize: "0.78rem", margin: "0 0 10px" }}>
          Quorum is met. The constitutional delay runs from that moment, and the contract
          does not publish when it ends — so if it has not passed, the contract will refuse
          and say why.
        </p>
      ) : null}
      {gating.canReview ? (
        <>
          <label className="eyebrow" htmlFor={`evidence-${proposal.id}`}>
            Evidence of delivery — a public link
          </label>
          <div className="field" style={{ marginTop: 6 }}>
            <input
              id={`evidence-${proposal.id}`}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="https://"
              aria-describedby={`evidence-help-${proposal.id}`}
            />
          </div>
          <p
            className="faint"
            id={`evidence-help-${proposal.id}`}
            style={{ fontSize: "0.78rem", margin: "6px 0 0" }}
          >
            The charter asks for a source anyone can check. A link to a public commit or
            a published release is what a reviewer can verify, which is the whole point of
            a tranche.
          </p>
        </>
      ) : null}
    </WritePanel>
  );
}

/**
 * Propose something.
 *
 * The three kinds have genuinely different required fields, and a form showing a
 * recipient box for a charter rewrite invites a mistake the contract will reject after
 * two minutes of consensus. So the fields follow the kind, and `GOVERNANCE` names what
 * it actually touches — "governance" on its own does not tell anyone that a vote on it
 * rewrites the charter.
 */
export function ProposalComposer({
  trust,
  governanceFields,
}: {
  trust: string;
  governanceFields: string[];
}) {
  const { address } = useWallet();
  const [kind, setKind] = useState<"GRANT" | "CHARTER_AMENDMENT" | "GOVERNANCE">("GRANT");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("0.05");
  const [recipient, setRecipient] = useState("");

  const parsed = parseGen(amount);
  const needsAmount = kind === "GRANT";
  const needsRecipient = kind === "GRANT";

  const problem = !title.trim()
    ? "A title is required."
    : !body.trim()
      ? "The body is what the committee reads, so it cannot be empty."
      : needsAmount && (parsed === null || parsed <= 0n)
        ? "That is not an amount in GEN."
        : needsRecipient && !isAddress(recipient.trim())
          ? "A grantee needs an address."
          : null;

  const buttons: WriteButton[] = [
    {
      action: "propose",
      label: "Submit the proposal",
      busyLabel: "Submitting…",
      disabled: problem !== null,
      reason: problem ?? undefined,
      onRun: () =>
        submitProposal(
          trust,
          title.trim(),
          body.trim(),
          kind,
          needsAmount ? (parsed ?? 0n) : 0n,
          needsRecipient ? recipient.trim() : "",
          address ?? undefined,
          undefined,
        ),
    },
  ];

  return (
    <WritePanel buttons={buttons}>
      <div className="write-kinds" role="radiogroup" aria-label="Kind of proposal">
        {(["GRANT", "CHARTER_AMENDMENT", "GOVERNANCE"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            className={kind === option ? "is-picked" : undefined}
            onClick={() => setKind(option)}
          >
            {KIND_LABEL[option]}
          </button>
        ))}
      </div>

      {kind === "GOVERNANCE" ? (
        <p className="faint" style={{ fontSize: "0.8rem", margin: "10px 0 0" }}>
          A governance proposal changes what a vote can decide — currently{" "}
          <code>{governanceFields.join(", ") || "nothing"}</code> — and waits the
          constitutional delay before it can take effect.
        </p>
      ) : kind === "CHARTER_AMENDMENT" ? (
        <p className="faint" style={{ fontSize: "0.8rem", margin: "10px 0 0" }}>
          An amendment to the charter text itself. It waits the same delay as a
          governance change, because it is the same kind of decision.
        </p>
      ) : null}

      <label className="eyebrow" htmlFor="proposal-title" style={{ marginTop: 14, display: "block" }}>
        Title
      </label>
      <div className="field" style={{ marginTop: 6 }}>
        <input
          id="proposal-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Fund the thing"
        />
      </div>

      <label className="eyebrow" htmlFor="proposal-body" style={{ marginTop: 12, display: "block" }}>
        What it is for — the committee reads this
      </label>
      <div className="field" style={{ marginTop: 6 }}>
        <textarea
          id="proposal-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="What will be delivered, and what makes it verifiable."
        />
      </div>

      {needsAmount ? (
        <>
          <label
            className="eyebrow"
            htmlFor="proposal-amount"
            style={{ marginTop: 12, display: "block" }}
          >
            Amount, in GEN
          </label>
          <div className="field" style={{ marginTop: 6 }}>
            <input
              id="proposal-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
            />
          </div>
          {parsed !== null && parsed > 0n ? (
            <p className="faint" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
              {gen(parsed)} GEN
            </p>
          ) : null}
        </>
      ) : null}

      {needsRecipient ? (
        <>
          <label
            className="eyebrow"
            htmlFor="proposal-recipient"
            style={{ marginTop: 12, display: "block" }}
          >
            Grantee address
          </label>
          <div className="field" style={{ marginTop: 6 }}>
            <input
              id="proposal-recipient"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x followed by 40 hex characters"
              spellCheck={false}
            />
          </div>
        </>
      ) : null}
    </WritePanel>
  );
}