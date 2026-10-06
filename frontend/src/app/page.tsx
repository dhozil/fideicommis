import Link from "next/link";
import { AddressForm } from "@/components/AddressForm";
import { Conservation } from "@/components/Conservation";
import { readFeatured } from "@/lib/featured";
import { FEATURED_TRUST } from "@/lib/registry";
import { addressOnExplorer } from "@/lib/explorer";
import { gen, utc } from "@/lib/format";

// One live read on every load: this page is a snapshot of a live chain, and a
// landing page that showed yesterday's figures would be worse than one that showed
// none.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The hero is the conservation identity, not a headline about it.
 *
 * A landing page for a ledger that has to balance to the last atto should open with
 * the balance, read live. It is the most characteristic thing about the subject, it
 * cannot be faked by a gradient, and it means a visitor learns what this project
 * considers provable before they read a word of prose about it.
 */

const GUARANTEES = [
  {
    key: "conservation",
    claim: "Every attoGEN is in a bucket, and the buckets are named on-chain.",
    why: "The estate holds a running identity, inflow equal to treasury plus granted, settled, dissolved, keeper-paid and burned. A payout declares which bucket it comes from before any value moves, so a new path cannot quietly take money without appearing. It is shown above, from the trust's own view, and a disagreement between the sum and the identity is stated rather than hidden.",
  },
  {
    key: "constitution",
    claim: "Quorum and the spending ceiling cannot be loosened past fixed limits.",
    why: "A vote may tighten the trust. It cannot move quorum below 25%, or the ceiling above 50% of the treasury, because those two numbers are constants in the contract rather than values in storage. Everything else about how the trust is governed moves through a proposal and a delay.",
  },
  {
    key: "timelock",
    claim: "A constitutional change is not effective the moment it is approved.",
    why: "The clock starts when quorum is reached, not when the proposal is made, so a vote cannot be re-voted into restarting the delay. A charter amendment with no charter text cannot execute at all: the model may propose prose, and the prose has to be carried by a member before it becomes the charter.",
  },
];

export default async function Home() {
  const featured = await readFeatured(FEATURED_TRUST);

  return (
    <main id="main">
      <section style={{ paddingTop: 34 }}>
        <span className="eyebrow">Autonomous trust · GenLayer · Studionet</span>
        <h1 style={{ maxWidth: "18ch" }}>
          An estate that keeps its own accounts.
        </h1>
        <p className="lede" style={{ marginTop: 20 }}>
          A Fideicommis is an endowment administered in perpetuity under its own
          charter, judged by a committee of validators, and funding whoever keeps it
          alive. It is not a DAO and it does not pretend to be one. What it offers is
          narrower and more checkable: a treasury whose money must reconcile to the
          last attoGEN, and a record of why every decision was made.
        </p>
      </section>

      <hr className="rule" style={{ margin: "44px 0 28px" }} />

      <section>
        <div
          style={{
            display: "flex",
            gap: 18,
            alignItems: "baseline",
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div>
            <span className="eyebrow" style={{ marginBottom: 4 }}>
              A live trust, read now
            </span>
            <h2 style={{ fontSize: "1.6rem" }}>
              {featured.reachable ? featured.name : "The reference trust"}
            </h2>
          </div>
          {featured.reachable ? (
            <div className="seal" style={{ marginLeft: "auto" }}>
              {featured.status} · cycle {featured.cycle} · charter v{featured.charterVersion}
            </div>
          ) : null}
        </div>

        {featured.reachable && featured.flow ? (
          <>
            <Conservation flow={featured.flow} />
            <p className="muted" style={{ marginTop: 14, fontSize: "0.9rem" }}>
              {gen(featured.treasury)} GEN held · runway {featured.runway} cycles ·{" "}
              <Link href={`/trust/${featured.address}`}>
                the full record, with every decision
              </Link>{" "}
              ·{" "}
              <a
                href={addressOnExplorer(featured.address)}
                target="_blank"
                rel="noreferrer noopener"
              >
                on the explorer
              </a>
            </p>
          </>
        ) : (
          <div className="notice warn">
            <strong>The node did not answer, so this page is not showing figures.</strong>{" "}
            The reference trust is deployed and its record is readable at the address
            below. The reader calls the Studionet node directly, and that node rate
            limits to thirty reads a minute, so a busy moment looks like this.
          </div>
        )}

        <div className="panel" style={{ marginTop: 20 }}>
          <h3>Open any trust</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            Any address deployed from this contract works here. This one is{" "}
            <code className="wrap">{FEATURED_TRUST}</code>.
          </p>
          <AddressForm label="Trust address" />
        </div>
      </section>

      <hr className="rule" style={{ margin: "48px 0 0" }} />

      <section className="prose" style={{ paddingTop: 34 }}>
        <span className="eyebrow">What it guarantees</span>
        <h2 style={{ maxWidth: "22ch" }}>Three things a vote cannot talk its way out of.</h2>
        <div className="guarantees" style={{ marginTop: 26 }}>
          {GUARANTEES.map((item) => (
            <div className="guarantee" key={item.key}>
              <div className="key">{item.key}</div>
              <div>
                <div className="claim">{item.claim}</div>
                <p className="why">{item.why}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 24, maxWidth: "62ch" }}>
          And one thing it cannot do. A live trust holds one member with all the
          shares, so one person satisfies quorum alone. The contract removes the
          operator&apos;s ability to manufacture that arrangement on their own; it
          cannot manufacture pluralism, and this reader does not imply otherwise.
        </p>
      </section>

      <hr className="rule" style={{ marginTop: 44 }} />

      <section style={{ paddingTop: 30 }}>
        <div className="grid-two">
          <div className="panel">
            <h3>How a trust works</h3>
            <p className="muted">
              The cycle, what the committee is judging, where the timelock fits, and
              what happens when the treasury runs dry.
            </p>
            <Link href="/how-it-works" className="btn">
              Read the mechanism
            </Link>
          </div>
          <div className="panel">
            <h3>What this is</h3>
            <p className="muted">
              The claims this project makes, and the three boundaries around them.
            </p>
            <Link href="/about" className="btn">
              Read the boundaries
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
