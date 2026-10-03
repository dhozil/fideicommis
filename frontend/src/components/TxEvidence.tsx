import { shortHash, txOnExplorer } from "@/lib/explorer";
import type { TransactionReport } from "@/lib/verify";

/**
 * What a committee did, for someone who was not there.
 *
 * The wallet panel shows this after a write, but only to the person who signed it.
 * That is the wrong audience for it: the interesting reader is a stranger holding a
 * hash, who wants to know whether it settled, whether the committee was unanimous, and
 * — the part that matters most — whether the status lied.
 *
 * Four states, kept apart on purpose, because collapsing them is how this project would
 * end up making a claim it cannot support:
 *
 *   - no record      the node does not have the hash. Not "it failed".
 *   - not yet        the node has it but no leader receipt. Not "it was rejected".
 *   - rolled back    a leader receipt exists and says the execution did not return.
 *   - settled        it returned, and the validators' own results are below it.
 *
 * The status string is shown next to the verdict deliberately. A rolled-back
 * transaction on GenLayer can still carry FINALIZED, so printing "FINALIZED" alone
 * would be printing the one field known to disagree with what happened.
 */
export function TxEvidence({ report, hash }: { report: TransactionReport; hash: string }) {
  const { found, ran, settled, reason, status, evidence, error, cached, ageMs } = report;
  const { leaderOutput, leaderError, agreed, validators, perValidator, leaderStatus } = evidence;
  const unanimous = validators > 0 && agreed === validators;
  const split = validators > 0 && agreed < validators;

  // Shown only when it was served from the cache, and in plain numbers, because the
  // alternative is a reader assuming a fresh read that did not happen. Under a second
  // is not worth a second sentence.
  const staleBy =
    cached && ageMs !== null ? (ageMs < 1000 ? "under a second" : `${Math.round(ageMs / 1000)} seconds`) : null;

  return (
    <div className="equiv" style={{ marginTop: 20 }}>
      <h5>
        <a href={txOnExplorer(hash)} target="_blank" rel="noreferrer noopener">
          {shortHash(hash)} on the explorer →
        </a>
      </h5>

      {staleBy !== null ? (
        <p className="faint" style={{ marginTop: 6, marginBottom: 0 }}>
          served from cache, read {staleBy} ago
          — a receipt does not change once decided, but this one may not have been
          decided yet when it was read
        </p>
      ) : null}

      <dl>
        <dt>Verdict</dt>
        <dd>
          {!found ? (
            <span className="mark unknown">no record</span>
          ) : !ran ? (
            <span className="mark pending">not yet decided</span>
          ) : settled ? (
            <span className="mark compliant">settled</span>
          ) : (
            <span className="mark broken">rolled back</span>
          )}

          {status ? (
            <span className="faint" style={{ display: "block", marginTop: 6 }}>
              The node calls this transaction{" "}
              <code className="data">{status}</code>. That field is not the verdict: a
              rolled-back transaction can carry FINALIZED, which is why the sentence
              above comes from the leader&apos;s own result instead.
            </span>
          ) : null}
        </dd>

        <dt>Leader</dt>
        <dd>
          {!found || !ran ? (
            <span className="faint">
              {found
                ? "the node has this transaction but has published no leader receipt, so nothing has been decided yet"
                : "the node does not have this hash"}
            </span>
          ) : (
            <>
              {leaderStatus ? (
                <span
                  className={`mark ${leaderStatus === "return" ? "compliant" : "non-compliant"}`}
                >
                  {leaderStatus}
                </span>
              ) : (
                <span className="mark unknown">no status</span>
              )}
              {leaderOutput !== null ? (
                <code className="equiv-output">{leaderOutput}</code>
              ) : leaderError !== null ? (
                <span className="equiv-error">
                  returned nothing — the engine said:{" "}
                  <code className="equiv-output">{leaderError}</code>
                </span>
              ) : (
                <span className="faint">no value returned — this write does not return one</span>
              )}
              {!settled && reason ? (
                <span className="faint" style={{ display: "block", marginTop: 6 }}>
                  {reason}
                </span>
              ) : null}
            </>
          )}
        </dd>

        <dt>Validators</dt>
        <dd>
          {validators > 0 ? (
            <>
              <span
                className={`mark ${unanimous ? "compliant" : split ? "non-compliant" : "pending"}`}
              >
                {agreed} of {validators} agreed
              </span>
              {!unanimous ? (
                <span className="faint" style={{ display: "block", marginTop: 6 }}>
                  A split means this was decided by the round rather than by unanimity,
                  so the leader&apos;s output is not something every validator
                  reproduced.
                </span>
              ) : null}
            </>
          ) : (
            <span className="faint">
              the node reported no validators for this one, which is what a transaction
              that has not run yet looks like
            </span>
          )}
        </dd>
      </dl>

      {error ? (
        <p className="notice bad" style={{ marginTop: 14 }}>
          <strong>The node refused the read.</strong> {error}
        </p>
      ) : null}

      {!found ? (
        <p className="notice warn" style={{ marginTop: 14, maxWidth: "72ch" }}>
          <strong>This is not a claim that anything went wrong.</strong> A node answers
          only for transactions it has seen, and this one has either not reached this
          network, has aged out of its recent window, or was never a hash. The
          distinction matters: &ldquo;no record&rdquo; and &ldquo;rejected&rdquo; are
          opposite answers, and only one of them is a statement about the write.
        </p>
      ) : null}

      {perValidator.length ? (
        <>
          <h5>What each validator executed</h5>
          <ul className="equiv-list">
            {perValidator.map((validator, index) => (
              <li key={`${validator.address}-${index}`}>
                <code className="data">{validator.address || "address not reported"}</code>
                <span className={`mark ${validator.result === "SUCCESS" ? "compliant" : "broken"}`}>
                  {validator.result}
                </span>
                {validator.vote ? (
                  <span className={`mark ${validator.vote === "agree" ? "compliant" : "non-compliant"}`}>
                    {validator.vote}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
