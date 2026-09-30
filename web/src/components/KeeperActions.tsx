"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { advanceCycle, fund, parseGen, type WriteResult } from "@/lib/actions";
import { txOnExplorer, shortHash } from "@/lib/explorer";

/**
 * The two actions anyone can take, and neither of them needs to be a member.
 *
 * advance_cycle is permissionless and pays its own caller. fund is permissionless
 * and revives a dormant trust. Those two are the whole point of the design, so they
 * get a UI; the member-only actions are left to the drivers in scripts/, where the
 * sequence is explicit and reviewable.
 *
 * On success the result links to the transaction on the explorer rather than
 * printing a bare 66-character hash. A hash nobody can click is a claim the reader
 * is asking you to trust, which is the opposite of what the rest of this site is
 * for. It also says plainly that FINALIZED is not proof, because on GenLayer it
 * genuinely is not, and a reader that implied otherwise would be teaching the wrong
 * lesson at exactly the moment the user is most inclined to believe it.
 */
export function KeeperActions({ trust, treasury }: { trust: string; treasury: string }) {
  const { address, onStudionet, busy } = useWallet();
  const [amount, setAmount] = useState("0.05");
  const [result, setResult] = useState<WriteResult | null>(null);
  const [working, setWorking] = useState<"fund" | "cycle" | null>(null);

  const parsed = parseGen(amount);
  const canFund = Boolean(address) && onStudionet && parsed !== null && parsed > 0n && !working;
  const amountOk = parsed !== null && parsed > 0n;

  async function run(kind: "fund" | "cycle") {
    if (!address) return;
    setWorking(kind);
    setResult(null);
    try {
      const r =
        kind === "fund" && parsed !== null
          ? await fund(trust, parsed, address)
          : await advanceCycle(trust, address);
      setResult(r);
    } catch (err) {
      setResult({ ok: false, phase: "submit", reason: (err as Error).message });
    } finally {
      setWorking(null);
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
          <div style={{ marginBottom: 18 }}>
            <label
              className="eyebrow"
              htmlFor="fund-amount"
              style={{ marginBottom: 6 }}
            >
              Add to the estate
            </label>
            <div className="field" style={{ maxWidth: "none" }}>
              <input
                id="fund-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                spellCheck={false}
                aria-describedby="fund-help"
                aria-invalid={!amountOk ? true : undefined}
                style={{ flex: "0 1 140px" }}
              />
              <span
                className="tag"
                style={{ display: "flex", alignItems: "center", padding: "0 10px" }}
              >
                GEN
              </span>
              <button type="button" onClick={() => run("fund")} disabled={!canFund}>
                {working === "fund" ? "Sending…" : "Fund it"}
              </button>
            </div>
            <p
              id="fund-help"
              className="faint"
              style={{ fontSize: "0.82rem", margin: "8px 0 0" }}
            >
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

          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <span className="eyebrow" style={{ marginBottom: 6 }}>
              Run one cycle
            </span>
            <p className="faint" style={{ fontSize: "0.82rem", margin: "0 0 10px" }}>
              The committee decides what happens, not you. The caller is reimbursed
              from the estate, and the cycle costs a burn.
            </p>
            <button
              type="button"
              onClick={() => run("cycle")}
              disabled={busy || Boolean(working)}
            >
              {working === "cycle" ? "Running…" : "Advance the cycle"}
            </button>
          </div>
        </>
      )}

      {result ? <ResultNote result={result} /> : null}
    </div>
  );
}

function ResultNote({ result }: { result: WriteResult }) {
  if (result.ok) {
    return (
      <div className="result ok" role="status" style={{ marginTop: 18 }}>
        <h4>Sent to the chain</h4>
        <p style={{ margin: 0, maxWidth: "none" }}>
          The node accepted the transaction. That is not the same as the trust having
          acted: a transaction can reach{" "}
          <span className="data">FINALIZED</span> and still have rolled back. Read the
          leader receipt before you treat it as done.
        </p>
        <a
          className="txlink"
          href={txOnExplorer(result.hash)}
          target="_blank"
          rel="noreferrer noopener"
        >
          <span className="data">{shortHash(result.hash)}</span>
          <span>view on the explorer →</span>
        </a>
      </div>
    );
  }

  return (
    <div className="result bad" role="alert" style={{ marginTop: 18 }}>
      <h4>{result.phase === "execute" ? "The chain refused it" : `It did not go through at the ${result.phase} stage`}</h4>
      <p style={{ margin: 0, maxWidth: "none" }}>{result.reason}</p>
    </div>
  );
}
