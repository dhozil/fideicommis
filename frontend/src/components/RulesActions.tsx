"use client";

import { useState } from "react";
import {
  bootstrapRules,
  setPolicy,
  parseGen,
} from "@/lib/actions";
import { gen } from "@/lib/format";
import { WritePanel, type WriteButton } from "@/components/WritePanel";

/**
 * Derive the rulebook, and the thing only the operator may touch.
 *
 * Two different authorities live on one panel, and that is fixed on purpose. The
 * rulebook call is permissionless — anyone may derive it, once per charter version —
 * while policy is `_require_operator`. Showing them together with the
 * authority printed on each is how a reader learns which acts need the operator and
 * which do not, rather than finding out from a refused transaction.
 *
 * Three writes that look like they belong here do not, and each of them says why:
 *
 *   - `set_member_shares` and `set_evidence_urls` both revert unconditionally. They
 *     were removed as powers, not as functions: calling them can only produce the
 *     contract's own refusal, which costs gas to learn. So they are documented here
 *     instead of being offered, and the route to the same outcome — a GOVERNANCE
 *     proposal — is named in full.
 *   - `set_code_upgraders` does not exist. The upgrade path was removed from the
 *     contract, so there is no call to offer; code replacement is answered by the
 *     `get_code_upgraders` view, shown on the provenance panel.
 */

export function RulesPanel({
  trust,
  hasRules,
  policy,
  missing = [],
}: {
  trust: string;
  /** Whether `get_charter_rules` returned anything for this charter version. */
  hasRules: boolean;
  policy: { burn_per_cycle: number; keeper_reward: number; tick_interval: number };
  /**
   * Writes this deployment does not have. Studionet cannot upgrade a contract, so a trust
   * deployed before a method existed is missing it, and a button for it fails at the node
   * with a message that does not name the method. Omitted means "offer everything", which is
   * what an unverified probe reports — see `lib/capabilities.ts`.
   */
  missing?: string[];
}) {
  const [keeper, setKeeper] = useState(String(policy.keeper_reward ?? ""));
  const [tick, setTick] = useState(String(policy.tick_interval ?? ""));

  const absent = new Set(missing);

  const parsedKeeper = parseGen(keeper);
  const parsedTick = Number(tick);

  const policyProblem =
    parsedKeeper === null
      ? "The keeper reward is not a number."
      : !Number.isInteger(parsedTick) || parsedTick < 60
        ? "The tick interval is a whole number of seconds, at least 60."
        : null;

  const buttons: WriteButton[] = [];

  if (!hasRules && !absent.has("bootstrap_rules")) {
    buttons.push({
      action: "bootstrap",
      label: "Derive the rulebook",
      busyLabel: "Deriving…",
      onRun: () => bootstrapRules(trust, undefined, undefined),
    });
  }

  if (!absent.has("set_policy")) {
    buttons.push({
      action: "policy",
      label: "Set the policy",
      busyLabel: "Setting…",
      tone: "quiet",
      disabled: policyProblem !== null,
      reason: policyProblem ?? "Operator only. Anyone else gets a refusal, not a change.",
      onRun: () =>
        setPolicy(trust, parsedKeeper ?? 0n, parsedTick, undefined, undefined),
    });
  }

  return (
    <WritePanel buttons={buttons}>
      {!hasRules ? (
        <p className="faint" style={{ fontSize: "0.8rem", margin: "0 0 10px" }}>
          The charter has no derived rules yet, so nothing can be judged. Anyone may
          derive them — once per charter version — and the committee does the rest.
        </p>
      ) : null}

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
      <p className="faint" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
        Each cycle pays at most one percent of the treasury to the keeper, whatever
        is set here — the contract caps it where the payout happens.
      </p>
      <p className="faint" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
        The burn rate is not set here. Destroying spendable funds takes a{" "}
        <code>BURN_PER_CYCLE</code> governance proposal — a member vote plus the
        delay — and no cycle retires more than one percent regardless.
        Current burn: {gen(BigInt(policy.burn_per_cycle ?? 0))} GEN per cycle.
      </p>

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
      {parsedKeeper !== null && parsedTick >= 60 ? (
        <p className="faint" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
          {gen(parsedKeeper)} paid to the keeper, every {parsedTick} seconds.
          A vote cannot cross the constitutional floor or ceiling, and this call does not
          touch them — it never could, which is why they are not parameters.
        </p>
      ) : null}

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