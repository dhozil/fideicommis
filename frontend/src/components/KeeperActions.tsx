"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import {
  advanceCycle,
  fund,
  parseGen,
  type EquivalenceEvidence,
  type WriteResult,
  type WriteStage,
} from "@/lib/actions";
import { txOnExplorer, shortHash } from "@/lib/explorer";

/**
 * The two actions anyone can take, and neither of them needs to be a member.
 *
 * advance_cycle is permissionless and pays its own caller. fund is permissionless and
 * revives a dormant trust. Those two are the whole point of the design, so they get a
 * UI; the member-only actions are left to the drivers in scripts/, where the sequence
 * is explicit and reviewable.
 *
 * On the success panel, which is the part that was wrong.
 *
 * The write is not done when the transaction is sent, and this page used to imply it
 * was: it printed a link to the transaction on the explorer the moment the receipt
 * arrived, which reads as "this happened". The rest of this project says the opposite
 * in four different places — a transaction can reach FINALIZED and still have rolled
 * back, and only `consensus_data.leader_receipt[0].result.payload` says which. A UI
 * that reports acceptance as completion is teaching the wrong lesson at the exact
 * moment a user is most inclined to believe it.
 *
 * So the result is reported in the three states that actually exist:
 *
 *   sent       the wallet signed it and the node has it. Nothing has settled.
 *   settled    consensus finished and the leader returned. This is the only state
 *              that says the trust acted.
 *   rolled back  consensus finished and it did not. The payload from the receipt is
 *              shown verbatim, because "the chain refused it" without the reason is
 *              not something a reader can check.
 *
 * The explorer link is present from the first state, because the transaction is real
 * the moment it is sent and being able to watch it is useful. It is labelled as
 * pending until consensus settles, so the link is not mistaken for an outcome.
 */
export function KeeperActions({ trust, treasury }: { trust: string; treasury: string }) {
  const { address, onStudionet, busy: walletBusy } = useWallet();
  const [amount, setAmount] = useState("0.05");
  const [result, setResult] = useState<WriteResult | null>(null);
  const [working, setWorking] = useState<"fund" | "cycle" | null>(null);
  const [stage, setStage] = useState<WriteStage | null>(null);

  const parsed = parseGen(amount);
  const amountOk = parsed !== null && parsed > 0n;
  // One lock for the whole panel, not one per button. Two enabled buttons that each
  // disable only themselves is how a user ends up sending two transactions from one
  // page, so while anything is in flight both are disabled and both say so.
  const locked = Boolean(working) || walletBusy;
  const canFund = Boolean(address) && onStudionet && amountOk && !locked;
  const canCycle = Boolean(address) && onStudionet && !locked;

  // The wallet itself can be mid-connect or mid-switch, in which case both buttons
  // are locked but neither is "working". Without this the buttons read as available
  // while the panel is not able to act, which is worse than looking briefly inert.
  const idleReason = !address
    ? "Connect a wallet to act"
    : !onStudionet
      ? "Switch to Studionet to act"
      : working
        ? "A transaction is in flight"
        : walletBusy
          ? "The wallet is busy"
          : null;

  async function run(kind: "fund" | "cycle") {
    if (!address || locked) return;
    setWorking(kind);
    setStage("sending");
    setResult(null);
    try {
      const settled =
        kind === "fund" && parsed !== null
          ? await fund(trust, parsed, address, setStage)
          : await advanceCycle(trust, address, setStage);
      setResult(settled);
    } catch (err) {
      setResult({ ok: false, phase: "submit", reason: (err as Error).message });
    } finally {
      setWorking(null);
      setStage(null);
    }
  }

  return (
    <div>
      {!address ? (
        <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
          Connect a wallet above to act. Reading this record needs none; acting on it
          does. Your key never touches this site.
        </p>
      ) : !onStudionet ? (
        <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
          Switch your wallet to the Studionet network before sending anything.
        </p>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <label className="eyebrow" htmlFor="fund-amount" style={{ marginBottom: 6 }}>
              Add to the estate
            </label>
            <div className="field" style={{ maxWidth: "none" }}>
              <input
                id="fund-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                spellCheck={false}
                aria-describedby="fund-help"
                aria-invalid={!amountOk ? true : undefined}
                disabled={locked}
                style={{ flex: "0 1 150px" }}
              />
              <span className="tag" style={{ display: "flex", alignItems: "center", padding: "0 10px" }}>
                GEN
              </span>
              <button type="button" onClick={() => run("fund")} disabled={!canFund}>
                {working === "fund" ? "Funding…" : "Fund it"}
              </button>
            </div>
            <p id="fund-help" className="faint" style={{ fontSize: "0.82rem", margin: "8px 0 0" }}>
              {amountOk ? (
                <>
                  Anyone may fund a trust, and funding revives one that has gone
                  dormant. Held now: {treasury} GEN.
                </>
              ) : (
                "Enter an amount in GEN, greater than zero."
              )}
            </p>
          </div>

          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
            <span className="eyebrow" style={{ marginBottom: 6 }}>
              Run one cycle
            </span>
            <p className="faint" style={{ fontSize: "0.82rem", margin: "0 0 10px" }}>
              The committee decides what happens, not you. The caller is reimbursed from
              the estate, and the cycle costs a burn.
            </p>
            <button type="button" onClick={() => run("cycle")} disabled={!canCycle}>
              {working === "cycle" ? "Waiting for consensus…" : "Advance the cycle"}
            </button>
            {working ? (
              <p className="faint" style={{ fontSize: "0.8rem", margin: "10px 0 0" }}>
                {stage === "in-consensus"
                  ? "Consensus is running. Every transaction goes through a validator committee on Studionet, which takes a minute or two."
                  : "Sent. Waiting for the node to accept it."}
              </p>
            ) : null}
          </div>
        </>
      )}

      {idleReason && !working ? (
        <p className="faint" style={{ fontSize: "0.8rem", margin: "12px 0 0" }}>
          {idleReason}.
        </p>
      ) : null}

      {result ? <ResultPanel result={result} /> : null}
    </div>
  );
}

/**
 * What the reader is told, and when.
 *
 * The states are named after what is actually known rather than after what the user
 * is hoping: `settled` only when the leader returned, `rolled back` only when it did
 * not, and the payload is shown rather than summarised because the whole point of
 * this project is that a failure should be checkable too.
 */
function ResultPanel({ result }: { result: WriteResult }) {
  if (result.ok) {
    return (
      <div className="result ok" role="status" style={{ marginTop: 20 }}>
        <h4>Settled</h4>
        <p style={{ margin: 0, maxWidth: "none" }}>
          Consensus finished and the leader returned, so the trust has acted. The
          reader will show it on the next load.
        </p>
        <EquivalenceReport evidence={result.equivalence} />
        <ExplorerLink hash={result.hash} />
      </div>
    );
  }

  // A receipt that says the leader did not return is a rollback, and the reason it
  // gives is the payload from the chain rather than anything this app invented.
  const rolledBack = result.phase === "execute";

  return (
    <div className="result bad" role="alert" style={{ marginTop: 20 }}>
      <h4>
        {result.phase === "rejected"
          ? "Refused before sending"
          : rolledBack
            ? "Consensus finished, and it rolled back"
            : result.phase === "receipt"
              ? "The receipt could not be read"
              : "The wallet or the node refused it"}
      </h4>
      <p style={{ margin: 0, maxWidth: "none" }}>
        {rolledBack
          ? "A transaction can reach FINALIZED and still have rolled back. The chain said:"
          : result.reason}
      </p>
      {/* Shown on a rollback too, and that is the point: a user who just lost a
          transaction is exactly the user who needs to see what the committee did,
          not a summary that the app could have invented. */}
      {result.equivalence ? <EquivalenceReport evidence={result.equivalence} /> : null}
      {result.hash ? <ExplorerLink hash={result.hash} /> : null}
    </div>
  );
}

/**
 * The Equivalence Principle, in the words the node used.
 *
 * This exists because "it worked" is a claim and the user cannot check it. What is
 * shown instead is the mechanism: the leader's output, how many validators
 * independently arrived at the same thing, and each one's own result. A reader can
 * count the validators and compare them, which is the whole point of the principle
 * being visible rather than asserted.
 *
 * Nothing here is interpreted. If the node reports no output, this says so, because an
 * empty field and a successful one look identical otherwise and the difference
 * matters.
 */
function EquivalenceReport({ evidence }: { evidence: EquivalenceEvidence }) {
  const { leaderOutput, leaderError, agreed, validators, perValidator, leaderStatus } = evidence;
  const unanimous = validators > 0 && agreed === validators;
  const split = validators > 0 && agreed < validators;

  return (
    <div className="equiv">
      <h5>Equivalence Principle</h5>

      <dl>
        <dt>Leader</dt>
        <dd>
          {leaderStatus ? (
            <span className={`mark ${leaderStatus === "return" ? "compliant" : "non-compliant"}`}>
              {leaderStatus}
            </span>
          ) : (
            <span className="mark unknown">no status</span>
          )}
          {leaderOutput !== null ? (
            <code className="equiv-output">{leaderOutput}</code>
          ) : leaderError !== null ? (
            // Shown as a reason, not a result. Rendering a rollback's payload under
            // the same heading as a return value makes a failed write look like one
            // that produced something.
            <span className="equiv-error">
              returned nothing — the engine said:{" "}
              <code className="equiv-output">{leaderError}</code>
            </span>
          ) : (
            <span className="faint">
              no value returned — this write does not return one
            </span>
          )}
        </dd>

        <dt>Validators</dt>
        <dd>
          {validators > 0 ? (
            <>
              <span className={`mark ${unanimous ? "compliant" : split ? "non-compliant" : "pending"}`}>
                {agreed} of {validators} agreed
              </span>
              {!unanimous ? (
                <span className="faint">
                  {" "}
                  A split means this transaction was decided by the round, not by
                  unanimity, and the leader's output is not something every validator
                  reproduced.
                </span>
              ) : null}
            </>
          ) : (
            <span className="faint">the node reported no validators for this one</span>
          )}
        </dd>
      </dl>

      {perValidator.length ? (
        <>
          <h5>What each validator executed</h5>
          <ul className="equiv-list">
            {perValidator.map((validator, index) => (
              <li key={`${validator.address}-${index}`}>
                <span className="data faint">{validator.address.slice(0, 12) || `#${index + 1}`}</span>
                <span
                  className={`mark ${
                    validator.result === "SUCCESS"
                      ? "compliant"
                      : validator.result === "ERROR"
                        ? "non-compliant"
                        : "pending"
                  }`}
                >
                  {validator.result.toLowerCase()}
                </span>
                {validator.vote ? <span className="faint">voted {validator.vote}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function ExplorerLink({ hash }: { hash: string }) {
  return (
    <a
      className="txlink"
      href={txOnExplorer(hash)}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className="data">{shortHash(hash)}</span>
      <span>view on the explorer →</span>
    </a>
  );
}