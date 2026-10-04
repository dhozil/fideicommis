"use client";

import { useState } from "react";
import {
  bootstrapRules,
  setCodeUpgraders,
  setPolicy,
  parseGen,
} from "@/lib/actions";
import { isAddress } from "@/lib/address";
import { gen } from "@/lib/format";
import { WritePanel, type WriteButton } from "@/components/WritePanel";

/**
 * Derive the rulebook, and the things only the operator may touch.
 *
 * Two different authorities live on one panel, and that is fixed on purpose. The
 * rulebook call is permissionless — anyone may derive it, once per charter version —
 * while policy and upgraders are `_require_operator`. Showing them together with the
 * authority printed on each is how a reader learns which acts need the operator and
 * which do not, rather than finding out from a refused transaction.
 *
 * Two writes that look like they belong here do not, and each of them says why:
 *
 *   - `set_member_shares` and `set_evidence_urls` both revert unconditionally. They
 *     were removed as powers, not as functions: calling them can only produce the
 *     contract's own refusal, which costs gas to learn. So they are documented here
 *     instead of being offered, and the route to the same outcome — a GOVERNANCE
 *     proposal — is named in full.
 */

export function RulesPanel({
  trust,
  hasRules,
  policy,
}: {
  trust: string;
  /** Whether `get_charter_rules` returned anything for this charter version. */
  hasRules: boolean;
  policy: { burn_per_cycle: number; keeper_reward: number; tick_interval: number };
}) {
  const [burn, setBurn] = useState(String(policy.burn_per_cycle ?? ""));
  const [keeper, setKeeper] = useState(String(policy.keeper_reward ?? ""));
  const [tick, setTick] = useState(String(policy.tick_interval ?? ""));
  const [upgraders, setUpgraders] = useState("");

  const parsedBurn = parseGen(burn);
  const parsedKeeper = parseGen(keeper);
  const parsedTick = Number(tick);

  const policyProblem =
    parsedBurn === null
      ? "Burn is not a number."
      : parsedKeeper === null
        ? "The keeper reward is not a number."
        : !Number.isInteger(parsedTick) || parsedTick < 60
          ? "The tick interval is a whole number of seconds, at least 60."
          : null;

  const upgradersList = upgraders
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const upgradersProblem =
    !upgradersList.length
      ? null
      : upgradersList.some((entry) => !isAddress(entry))
        ? "One of those is not an address."
        : null;

  const buttons: WriteButton[] = [];

  if (!hasRules) {
    buttons.push({
      action: "bootstrap",
      label: "Derive the rulebook",
      busyLabel: "Deriving…",
      onRun: () => bootstrapRules(trust, undefined, undefined),
    });
  }

  buttons.push({
    action: "policy",
    label: "Set the policy",
    busyLabel: "Setting…",
    tone: "quiet",
    disabled: policyProblem !== null,
    reason: policyProblem ?? "Operator only. Anyone else gets a refusal, not a change.",
    onRun: () =>
      setPolicy(trust, parsedBurn ?? 0n, parsedKeeper ?? 0n, parsedTick, undefined, undefined),
  });

  buttons.push({
    action: "upgraders",
    label: "Name the code upgraders",
    busyLabel: "Naming…",
    tone: "quiet",
    disabled: !upgradersList.length || upgradersProblem !== null,
    reason:
      upgradersProblem ??
      (!upgradersList.length ? "Comma-separated addresses." : "Operator only. Anyone else gets a refusal, not a change."),
    onRun: () => setCodeUpgraders(trust, upgradersList.join(","), undefined, undefined),
  });

  return (
    <WritePanel buttons={buttons}>
      {!hasRules ? (
        <p className="faint" style={{ fontSize: "0.8rem", margin: "0 0 10px" }}>
          The charter has no derived rules yet, so nothing can be judged. Anyone may
          derive them — once per charter version — and the committee does the rest.
        </p>
      ) : null}

      <label className="eyebrow" htmlFor="policy-burn" style={{ marginTop: 4, display: "block" }}>
        Burn per cycle, in GEN
      </label>
      <div className="field" style={{ marginTop: 6 }}>
        <input id="policy-burn" value={burn} onChange={(event) => setBurn(event.target.value)} inputMode="decimal" />
      </div>

      <label className="eyebrow" htmlFor="policy-keeper" style={{ marginTop: 10, display: "block" }}>
        Keeper reward, in GEN
      </label>
      <div className="field" style={{ marginTop: 6 }}>
        <input
          id="policy-keeper"
          value={keeper}
          onChange={(event) => setKeeper(event.target.value)}
          inputMode="decimal"
        />
      </div>

      <label className="eyebrow" htmlFor="policy-tick" style={{ marginTop: 10, display: "block" }}>
        Tick interval, in seconds
      </label>
      <div className="field" style={{ marginTop: 6 }}>
        <input
          id="policy-tick"
          value={tick}
          onChange={(event) => setTick(event.target.value)}
          inputMode="numeric"
        />
      </div>
      {parsedBurn !== null && parsedKeeper !== null && parsedTick >= 60 ? (
        <p className="faint" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
          {gen(parsedBurn)} burned and {gen(parsedKeeper)} paid, every {parsedTick} seconds.
          A vote cannot cross the constitutional floor or ceiling, and this call does not
          touch them — it never could, which is why they are not parameters.
        </p>
      ) : null}

      <label className="eyebrow" htmlFor="policy-upgraders" style={{ marginTop: 12, display: "block" }}>
        Code upgraders, comma-separated
      </label>
      <div className="field" style={{ marginTop: 6 }}>
        <input
          id="policy-upgraders"
          value={upgraders}
          onChange={(event) => setUpgraders(event.target.value)}
          placeholder="0x…, 0x…"
          spellCheck={false}
        />
      </div>

      <div className="notice warn" style={{ marginTop: 14 }}>
        <strong>
          <code>set_member_shares</code> and <code>set_evidence_urls</code> are not here
          on purpose.
        </strong>{" "}
        Both revert unconditionally — membership and the evidence sources move only
        through a <code>GOVERNANCE</code> proposal, which a member votes on and which
        waits the timelock. A button for either of them would cost gas to teach what one
        sentence can say.
      </div>
    </WritePanel>
  );
}