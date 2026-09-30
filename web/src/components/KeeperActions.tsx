"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { advanceCycle, fund, parseGen, type WriteResult } from "@/lib/actions";
import { formatGen } from "@/lib/actions";

/**
 * The two actions anyone can take, and neither of them needs to be a member.
 *
 * advance_cycle is permissionless and pays its own caller. fund is permissionless
 * and revives a dormant trust. Those two are the whole point of the design, so
 * they get a UI; the member-only actions are left to the drivers in scripts/,
 * where the sequence is explicit and reviewable.
 */
export function KeeperActions({ trust, treasury }: { trust: string; treasury: string }) {
  const { address, onStudionet, busy } = useWallet();
  const [amount, setAmount] = useState("0.05");
  const [result, setResult] = useState<WriteResult | null>(null);
  const [working, setWorking] = useState<"fund" | "cycle" | null>(null);

  const parsed = parseGen(amount);
  const canFund = Boolean(address) && onStudionet && parsed !== null && parsed > 0n && !working;

  async function run(kind: "fund" | "cycle") {
    if (!address) return;
    setWorking(kind);
    setResult(null);
    try {
      const r = kind === "fund" && parsed !== null ? await fund(trust, parsed, address) : await advanceCycle(trust, address);
      setResult(r);
    } catch (err) {
      setResult({ ok: false, phase: "submit", reason: (err as Error).message });
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="block">
      <h2>Act</h2>

      {!address ? (
        <p className="empty">Connect a wallet above. Reading this record needs none; acting on it does.</p>
      ) : !onStudionet ? (
        <p className="empty">Switch your wallet to Studionet before sending anything.</p>
      ) : (
        <>
          <div className="keeper-row">
            <label className="keeper-label" htmlFor="fund-amount">
              Add to the estate
            </label>
            <div className="keeper-input">
              <input
                id="fund-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                spellCheck={false}
                aria-describedby="fund-help"
              />
              <span className="unit">GEN</span>
            </div>
            <button className="keeper-action" type="button" onClick={() => run("fund")} disabled={!canFund}>
              {working === "fund" ? "Sending…" : "Fund it"}
            </button>
          </div>
          <p className="keeper-help" id="fund-help">
            Anyone may fund a trust, and funding revives it permanently if it had gone dormant. Held now: {treasury} GEN.
          </p>

          <div className="keeper-row">
            <span className="keeper-label">Run one cycle</span>
            <span className="keeper-help inline">
              The committee picks what happens. The caller is reimbursed from the estate, and a cycle costs a burn.
            </span>
            <button className="keeper-action" type="button" onClick={() => run("cycle")} disabled={busy || Boolean(working)}>
              {working === "cycle" ? "Running…" : "Advance the cycle"}
            </button>
          </div>
        </>
      )}

      {result ? <ResultNote result={result} /> : null}
    </section>
  );
}

function ResultNote({ result }: { result: WriteResult }) {
  if (result.ok) {
    return (
      <p className="keeper-result ok">
        Submitted as <code className="wrap">{result.hash}</code>. Check the leader receipt before believing it: a
        transaction can reach FINALIZED and still have rolled back.
      </p>
    );
  }
  return (
    <p className="keeper-result bad">
      {result.phase === "execute" ? "The chain refused it" : `It did not go through at the ${result.phase} stage`}.{" "}
      {result.reason}
    </p>
  );
}

export { formatGen };
