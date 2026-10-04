"use client";

import { useState } from "react";
import { fund, parseGen, preflightGrant, advanceCycle } from "@/lib/actions";
import { useWallet } from "@/lib/wallet";
import { gen } from "@/lib/format";
import { WritePanel, type WriteButton } from "@/components/WritePanel";

/**
 * Fund the trust, and run one cycle.
 *
 * The two writes that need no proposal. They are here rather than inline on the trust
 * page because the lock, the stage line and the consensus report all live in
 * `WritePanel`, and re-implementing them for a second pair of buttons is how two
 * slightly different behaviours of the same control end up on one page.
 */
export function TrustWrites({
  trust,
  treasury,
  ceilingBps,
  maxCeilingBps,
}: {
  trust: string;
  treasury: string;
  ceilingBps: number;
  maxCeilingBps: number;
}) {
  const { address } = useWallet();
  const [amount, setAmount] = useState("0.05");

  const parsed = parseGen(amount);
  const held = BigInt(treasury || "0");
  // The ceiling is checked here as well as in the contract, because being told the
  // limit before spending two minutes on consensus is worth more than being told it
  // afterwards. The contract remains the authority.
  const preflight = parsed === null ? "That is not a number." : preflightGrant(parsed, held, ceilingBps, maxCeilingBps);

  const buttons: WriteButton[] = [
    {
      action: "fund",
      label: "Fund the trust",
      busyLabel: "Sending…",
      disabled: parsed === null || parsed <= 0n,
      reason: parsed !== null && parsed <= 0n ? "Enter an amount." : undefined,
      onRun: () => fund(trust, parsed ?? 0n, address ?? undefined, undefined),
    },
    {
      action: "cycle",
      label: "Run one cycle",
      busyLabel: "Sending…",
      tone: "quiet",
      onRun: () => advanceCycle(trust, address ?? undefined, undefined),
    },
  ];

  return (
    <WritePanel buttons={buttons}>
      <label className="eyebrow" htmlFor="fund-amount">
        Add to the treasury, in GEN
      </label>
      <div className="field" style={{ marginTop: 6 }}>
        <input
          id="fund-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="0.05"
          aria-describedby="fund-hint"
        />
      </div>
      <p className="faint" id="fund-hint" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
        {parsed !== null && parsed > 0n
          ? `${gen(parsed)} GEN. The trust holds ${gen(held)} GEN.`
          : preflight}
      </p>
    </WritePanel>
  );
}