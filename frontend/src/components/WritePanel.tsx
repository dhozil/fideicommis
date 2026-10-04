"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { shortAddress, txOnExplorer } from "@/lib/explorer";

/**
 * One write, one lock, one honest report of what happened.
 *
 * Every panel in the reader that can change a trust uses this, because the same failure
 * kept arriving in three shapes: a button that stayed clickable while a transaction was
 * already in flight, a two-minute silence that read as a hang, and a result that said
 * "done" without saying what the committee decided.
 *
 * Three things are non-negotiable here:
 *
 *   - **One lock for the panel, not one per button.** Two enabled buttons that each
 *     disable only themselves is how a single page sends two transactions. While
 *     anything is in flight every write control here is disabled.
 *   - **The stage is always visible.** GenLayer consensus takes a minute or two on
 *     Studionet, and "sent" and "in consensus" are different states — the second is
 *     where a rollback happens.
 *   - **The result reports the committee, not the site.** A transaction can reach
 *     FINALIZED and still have rolled back, so the only honest confirmation is the
 *     leader receipt. That is parsed and shown, with a link to the explorer.
 */

export type WriteAction =
  | "fund"
  | "cycle"
  | "policy"
  | "propose"
  | "vote"
  | "execute"
  | "review";

export interface WriteButton {
  /** Two buttons with the same action share a lock, which is why approve and reject do. */
  action: WriteAction;
  label: string;
  /** What the button says while it is locked, so the label is never a dead word. */
  busyLabel?: string;
  disabled?: boolean;
  /** Why it is disabled. A locked button with no stated reason is a bug report. */
  reason?: string;
  tone?: "quiet" | "danger";
  onRun: () => Promise<WriteResultLike>;
}

export interface WriteResultLike {
  ok: boolean;
  hash?: string;
  reason?: string;
  phase?: string;
  equivalence?: {
    leaderOutput: string | null;
    leaderError: string | null;
    leaderStatus: string | null;
    agreed: number;
    validators: number;
    perValidator: { address: string; result: string; vote: string | null }[];
  };
}

export type WriteStage = "sending" | "in-consensus";

const STAGE_TEXT: Record<WriteStage, string> = {
  sending: "Sent to the node — waiting for it to accept",
  "in-consensus": "In consensus — the committee is deciding (a minute or two)",
};

export function WritePanel({
  buttons,
  onSettled,
  autoRefresh = true,
  children,
}: {
  buttons: WriteButton[];
  onSettled?: (result: WriteResultLike) => void;
  autoRefresh?: boolean;
  children?: React.ReactNode;
}) {
  const { address, onStudionet, busy: walletBusy } = useWallet();
  const [active, setActive] = useState<WriteAction | null>(null);
  const [stage, setStage] = useState<WriteStage | null>(null);
  const [result, setResult] = useState<WriteResultLike | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const locked = active !== null || walletBusy;
  const ready = Boolean(address) && onStudionet && !locked;

  // A write changes what every view method returns, so the figures on the page are stale
  // the moment one settles. The reload is a fresh render rather than a router.refresh,
  // so this component does not need the router and works wherever it is mounted.
  useEffect(() => {
    if (!result?.ok || !autoRefresh) return;
    const timer = setTimeout(() => setReload((n) => n + 1), 1400);
    return () => clearTimeout(timer);
  }, [result, autoRefresh]);

  const reason = !address
    ? "Connect a wallet, in the header, to act."
    : !onStudionet
      ? "Switch your wallet to Studionet before sending anything."
      : walletBusy
        ? "Your wallet is busy."
        : null;

  async function run(button: WriteButton) {
    if (!ready || button.disabled) return;
    setActive(button.action);
    setStage("sending");
    setResult(null);
    setProblem(null);
    try {
      const settled = await button.onRun();
      setResult(settled);
      if (settled.ok) onSettled?.(settled);
      else if (settled.phase === "submit") setProblem(settled.reason ?? "It was refused.");
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setActive(null);
      setStage(null);
    }
  }

  const shown = buttons.filter((button) => !button.disabled || button.reason);

  return (
    <div className="write-panel" data-reload={reload}>
      {children}

      {ready ? (
        <div className="write-buttons">
          {buttons.map((button, index) => (
            <button
              key={`${button.action}-${index}`}
              type="button"
              className={button.tone === "quiet" ? "quiet" : button.tone === "danger" ? "danger" : undefined}
              onClick={() => run(button)}
              disabled={!ready || Boolean(button.disabled)}
            >
              {active === button.action
                ? (button.busyLabel ?? "Sending…")
                : button.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="write-reason">{reason}</p>
      )}

      {/* A per-button reason sits under the row, not as a tooltip, because a disabled
          control gives no hover event and the user is left guessing. */}
      {ready && shown.some((button) => button.reason) ? (
        <ul className="write-reasons">
          {shown
            .filter((button) => button.reason)
            .map((button, index) => (
              <li key={`${button.action}-reason-${index}`}>{button.reason}</li>
            ))}
        </ul>
      ) : null}

      {stage ? (
        <p className="write-stage" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          {STAGE_TEXT[stage]}
        </p>
      ) : null}

      {problem ? (
        <p className="write-outcome is-bad" role="alert">
          <strong>Not sent.</strong> {problem}
        </p>
      ) : null}

      {result ? <WriteOutcome result={result} /> : null}
    </div>
  );
}

/**
 * What the committee decided.
 *
 * Success here means a committee settled the transaction, not that a button worked, and
 * the difference is the whole point of this reader. So the leader's output, the
 * agreement count and each validator's own execution are shown rather than summarised,
 * and the explorer link is given so the receipt can be read by someone who does not
 * trust this page.
 */
export function WriteOutcome({ result }: { result: WriteResultLike }) {
  if (!result.ok) {
    const phaseText: Record<string, string> = {
      submit: "The node refused it before it was sent.",
      receipt: "The node never produced a receipt.",
      execute: "It was accepted and then rolled back.",
      rejected: "It was refused before it was sent.",
    };
    return (
      <div className="write-outcome is-bad" role="alert">
        <p style={{ margin: "0 0 8px" }}>
          <strong>{result.phase === "execute" ? "Rolled back." : "Not settled."}</strong>{" "}
          {phaseText[result.phase ?? ""] ?? "It did not settle."}
          {result.reason ? ` ${result.reason}` : ""}
        </p>
        {result.hash ? (
          <p style={{ margin: 0 }}>
            <a href={txOnExplorer(result.hash)} target="_blank" rel="noreferrer noopener">
              {shortAddress(result.hash)} on the explorer →
            </a>
          </p>
        ) : null}
        {result.equivalence && result.equivalence.validators > 0 ? (
          <EquivalenceBlock evidence={result.equivalence} />
        ) : null}
      </div>
    );
  }

  const evidence = result.equivalence;
  return (
    <div className="write-outcome is-good" role="status" aria-live="polite">
      <p style={{ margin: "0 0 8px" }}>
        <strong>Settled.</strong>{" "}
        {evidence
          ? evidence.validators > 0
            ? `${evidence.agreed} of ${evidence.validators} validators agreed.`
            : "The node reported no validators for this one."
          : "Settled by consensus."}
      </p>
      {result.hash ? (
        <p style={{ margin: "0 0 4px" }}>
          <a href={txOnExplorer(result.hash)} target="_blank" rel="noreferrer noopener">
            {shortAddress(result.hash)} on the explorer →
          </a>
        </p>
      ) : null}
      {evidence ? <EquivalenceBlock evidence={evidence} /> : null}
    </div>
  );
}

function EquivalenceBlock({ evidence }: { evidence: NonNullable<WriteResultLike["equivalence"]> }) {
  return (
    <div className="equiv" style={{ marginTop: 12 }}>
      <h5>Equivalence Principle</h5>
      <dl>
        <dt>Leader</dt>
        <dd>
          {evidence.leaderStatus ? (
            <span className={`mark ${evidence.leaderStatus === "return" ? "compliant" : "non-compliant"}`}>
              {evidence.leaderStatus}
            </span>
          ) : (
            <span className="mark unknown">no status</span>
          )}
          {evidence.leaderOutput !== null ? (
            <code className="equiv-output">{evidence.leaderOutput}</code>
          ) : evidence.leaderError !== null ? (
            <span className="equiv-error">
              returned nothing — the engine said:{" "}
              <code className="equiv-output">{evidence.leaderError}</code>
            </span>
          ) : (
            <span className="faint">no value returned — this write does not return one</span>
          )}
        </dd>
        <dt>Validators</dt>
        <dd>
          {evidence.validators > 0 ? (
            <>
              <span className={`mark ${evidence.agreed === evidence.validators ? "compliant" : "non-compliant"}`}>
                {evidence.agreed} of {evidence.validators} agreed
              </span>
              {evidence.agreed < evidence.validators ? (
                <span className="faint" style={{ display: "block", marginTop: 6 }}>
                  A split means this was decided by the round rather than by unanimity, so
                  the leader&apos;s output is not something every validator reproduced.
                </span>
              ) : null}
            </>
          ) : (
            <span className="faint">the node reported no validators for this one</span>
          )}
        </dd>
      </dl>
      {evidence.perValidator.length ? (
        <ul className="equiv-list">
          {evidence.perValidator.map((validator, index) => (
            <li key={`${validator.address}-${index}`}>
              <code className="data">{validator.address || "address not reported"}</code>
              <span className={`mark ${validator.result === "SUCCESS" ? "compliant" : "broken"}`}>
                {validator.result}
              </span>
              {validator.vote ? <span className="faint"> voted {validator.vote}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}