import { shortAddress } from "@/lib/format";
import type { CharterRule, Member, TrustRecord } from "@/lib/types";

export function Membership({ members, totalShares, ceiling }: { members: Member[]; totalShares: number; ceiling: string }) {
  return (
    <section className="block">
      <h2>Membership</h2>
      <dl className="ledger">
        {members.length ? (
          members.map((m) => {
            const shares = Number(m.shares);
            const share = totalShares > 0 ? ((shares / totalShares) * 100).toFixed(1) : "0.0";
            return (
              <div className="ledger-row" key={m.address}>
                <dt title={m.address}>{shortAddress(m.address)}</dt>
                <dd>
                  {shares.toLocaleString("en-US")} shares ({share}%)
                </dd>
              </div>
            );
          })
        ) : (
          <div className="ledger-row">
            <dt>No members</dt>
            <dd>it cannot vote</dd>
          </div>
        )}
        <div className="ledger-row">
          <dt>Ceiling on one grant</dt>
          <dd className="accent">{ceiling} GEN</dd>
        </div>
      </dl>
      {members.length === 1 ? (
        <p className="empty">
          One member holds every share, so quorum is whatever that member says. This is the limit the README means when it says
          the contract removes the operator&apos;s ability to manufacture that arrangement, and cannot create pluralism.
        </p>
      ) : null}
    </section>
  );
}

export function Rulebook({ rules, cited }: { rules: CharterRule[]; cited: Set<string> }) {
  return (
    <section className="block">
      <h2>The rulebook it judges by</h2>
      {rules.length ? (
        <ul className="rules">
          {rules.map((r) => (
            <li key={r.id} className={cited.has(r.id) ? "cited" : ""}>
              <span className="rid">{r.id}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">
          No rulebook derived yet. The committee derives it from the charter, and until it does, no proposal can be assessed.
        </p>
      )}
    </section>
  );
}

export function Charter({ charter, version }: { charter: string; version: string }) {
  return (
    <section className="block">
      <h2>Charter, as in force</h2>
      <div className="deed">
        <span className="version">version {version || "—"}</span>
        {charter || <span className="muted">Not readable.</span>}
      </div>
    </section>
  );
}

export function ConstitutionFacts({ record }: { record: TrustRecord }) {
  const c = record.constitution;
  return (
    <section className="block">
      <h2>What a vote cannot change</h2>
      <dl className="ledger">
        <div className="ledger-row">
          <dt>Quorum floor</dt>
          <dd>{(c.min_quorum_bps / 100).toFixed(0)}%</dd>
        </div>
        <div className="ledger-row">
          <dt>Ceiling ceiling</dt>
          <dd>{(c.max_spend_ceiling_bps / 100).toFixed(0)}%</dd>
        </div>
        <div className="ledger-row">
          <dt>Constitutional kinds</dt>
          <dd>{c.constitutional_kinds.length}</dd>
        </div>
        <div className="ledger-row">
          <dt>Governance fields</dt>
          <dd>{c.governance_fields.length}</dd>
        </div>
      </dl>
    </section>
  );
}
