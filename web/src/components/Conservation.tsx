import { conservation, gen } from "@/lib/format";
import type { LifetimeFlow } from "@/lib/types";

/**
 * The identity the trust can be falsified against:
 *
 *   inflow == treasury + granted + settled + dissolved + keeper_paid + burned
 *
 * Rendered as a row of figures that must total, under a brass rule, because that
 * is what it is. If it does not balance the rule turns vermilion and the page
 * says how much is unaccounted for, rather than quietly showing the inputs and
 * letting the reader do the arithmetic.
 */
export function Conservation({ flow }: { flow: LifetimeFlow }) {
  const c = conservation(flow);

  return (
    <section className="block">
      <h2>Conservation</h2>
      <div className={c.holds ? "equation" : "equation broken"}>
        <div className="terms">
          {c.terms.map((t) => (
            <div key={t.label} className={t.zero ? "term zero" : "term"}>
              <span className="label">{t.label}</span>
              <span className="value">{gen(t.value)}</span>
            </div>
          ))}
        </div>
        <div className="balance">
          <span className="lhs">Accounted for</span>
          <span className="rhs">
            {gen(c.accountedFor.toString())} of {gen(c.inflow.toString())}
          </span>
        </div>
        <p className="finding">
          {c.holds
            ? "Every attoGEN that entered is still somewhere"
            : `Does not balance. ${gen(c.unaccounted.toString())} GEN unaccounted for.`}
        </p>
      </div>

      <dl className="ledger ledger-spaced">
        <div className="ledger-row">
          <dt>Entered, lifetime</dt>
          <dd className="accent">{gen(flow.inflow_atto)} GEN</dd>
        </div>
        <div className="ledger-row">
          <dt>Left, lifetime</dt>
          <dd>{gen(flow.outflow_atto)} GEN</dd>
        </div>
        <div className="ledger-row">
          <dt>Reported by the view</dt>
          <dd>{gen(flow.conserved_atto)} GEN</dd>
        </div>
        <div className="ledger-row">
          <dt>Disagreement</dt>
          <dd>{c.holds ? "none" : "the view and the identity differ"}</dd>
        </div>
      </dl>
    </section>
  );
}
