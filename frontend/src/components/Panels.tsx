import { shortAddress } from "@/lib/format";
import type { CharterRule, Member, TrustRecord } from "@/lib/types";
import { addressOnExplorer } from "@/lib/explorer";
import { Facts } from "@/components/ConstitutionGauges";

/**
 * The panels beside the decisions.
 *
 * Membership leads with the limitation rather than burying it. A trust with one
 * member satisfies quorum alone, and that is true whether or not the operator
 * arranged it, so it belongs next to the share count where nobody can miss it.
 */

export function Membership({
  members,
  totalShares,
  ceiling,
}: {
  members: Member[];
  totalShares: number;
  ceiling: string;
}) {
  return (
    <>
      {members.length ? (
        <Facts
          rows={members.map((member) => {
            const shares = Number(member.shares);
            const share = totalShares > 0 ? ((shares / totalShares) * 100).toFixed(1) : "0.0";
            return [
              shortAddress(member.address),
              `${shares.toLocaleString("en-US")} shares, ${share}%`,
            ] as [string, string];
          })}
        />
      ) : (
        <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
          This trust has no members, so it cannot reach quorum and nothing it proposes
          will execute.
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        <Facts rows={[["Ceiling on one grant", `${ceiling} GEN`]]} />
      </div>

      {members.length === 1 ? (
        <p className="notice warn" style={{ marginTop: 14, fontSize: "0.86rem" }}>
          <strong>One member holds every share.</strong> Quorum is whatever that member
          decides alone. The contract removes the operator&apos;s ability to manufacture
          this arrangement by themselves; it cannot create pluralism.
        </p>
      ) : null}

      <p style={{ marginTop: 12, marginBottom: 0 }}>
        <a
          href={addressOnExplorer(members[0]?.address ?? "")}
          target="_blank"
          rel="noreferrer noopener"
          className="data"
          style={{ fontSize: "0.78rem" }}
        >
          Members on the explorer →
        </a>
      </p>
    </>
  );
}

export function Rulebook({ rules, cited }: { rules: CharterRule[]; cited: Set<string> }) {
  if (!rules.length) {
    return (
      <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
        No rulebook derived yet. The committee derives one from the charter, and until
        it does, no proposal can be assessed. This is a normal state for a trust that
        has only just been deployed.
      </p>
    );
  }

  const hit = [...cited].filter((id) => rules.some((rule) => rule.id === id));

  return (
    <>
      <ul className="rules-list">
        {rules.map((rule) => (
          <li key={rule.id} className={cited.has(rule.id) ? "cited" : undefined}>
            <span>{rule.text}</span>
          </li>
        ))}
      </ul>
      {hit.length ? (
        <p className="muted" style={{ fontSize: "0.82rem", marginTop: 12, marginBottom: 0 }}>
          Marked in red: cited by a decision below, as a stated reason for judging
          against it.
        </p>
      ) : null}
    </>
  );
}

export function Charter({ charter, version }: { charter: string; version: string }) {
  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        Version {version || "—"}
      </p>
      <div className="charter">{charter || "The charter is not readable at this address."}</div>
    </>
  );
}

export function ConstitutionFacts({ record }: { record: TrustRecord }) {
  const constitution = record.constitution;
  // Same failure as the gauges above, in the other panel: `get_constitution` did not
  // answer, so `constitutional_kinds` and `governance_fields` were undefined and `.length`
  // on either threw. These are constants in the contract, so a reader that cannot state
  // them has to say so — the alternative, a count of zero, would be a claim about what a
  // vote may not change, made from no data at all.
  const readable = Number.isFinite(constitution?.min_quorum_bps);

  return (
    <>
      <p className="faint" style={{ fontSize: "0.82rem", marginTop: 4 }}>
        Constants in the contract, not values in storage. A vote may move quorum and
        the ceiling within these; it cannot move these.
      </p>
      {readable ? (
        <Facts
          rows={[
            ["Quorum floor", `${(constitution.min_quorum_bps / 100).toFixed(0)}%`],
            ["Ceiling ceiling", `${(constitution.max_spend_ceiling_bps / 100).toFixed(0)}%`],
            ["Constitutional kinds", constitution.constitutional_kinds?.length ?? "unreadable"],
            ["Governance fields", constitution.governance_fields?.length ?? "unreadable"],
          ]}
        />
      ) : (
        <p className="faint" style={{ fontSize: "0.84rem", margin: "0 0 10px" }}>
          <code>get_constitution</code> did not answer, so the constants a vote cannot
          move are not shown. The limits are not inferred from the state view.
        </p>
      )}
    </>
  );
}
