import Link from "next/link";
import { notFound } from "next/navigation";
import { AddressForm } from "@/components/AddressForm";
import { KeeperActions } from "@/components/KeeperActions";
import { Conservation } from "@/components/Conservation";
import { ConstitutionGauges } from "@/components/ConstitutionGauges";
import { DecisionList } from "@/components/Decision";
import { Charter, ConstitutionFacts, Membership, Rulebook } from "@/components/Panels";
import { gen, utc } from "@/lib/format";
import { NotATrust, readTrust } from "@/lib/trust";
import { addressOnExplorer } from "@/lib/explorer";
import { isListed } from "@/lib/registry";

// The record is a snapshot of a live chain, so it should not be baked into a build.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ address: string }> };

/**
 * The audit record.
 *
 * Three things are load-bearing about how this page behaves when something is
 * wrong, and all three existed before the rest of the design did:
 *
 * 1. A disagreement between the constitution view and the state view means the
 *    bytecode is not what the reader expects. That is stated at the top in plain
 *    words, and the rest of the page is marked as not meaningful, rather than
 *    leaving figures to be read as if they meant something.
 * 2. A view that fails is shown as empty and named. A trust that has not derived
 *    its rulebook yet is a normal state, not a broken reader.
 * 3. The proposals shown are capped, and the page says how many it left out and
 *    where the full list is. A reader that quietly shows a truncated record is
 *    indistinguishable from one that has nothing to hide.
 */
export default async function TrustPage({ params }: Params) {
  const { address } = await params;
  const decoded = decodeURIComponent(address);

  let record;
  try {
    record = await readTrust(decoded);
  } catch (err) {
    if (err instanceof NotATrust) notFound();
    throw err;
  }

  const cited = new Set(record.proposals.flatMap((p) => p.violations ?? []));
  const consistent = record.constitutionConsistent;

  return (
    <main id="main">
      <section style={{ paddingTop: 30 }}>
        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 320px" }}>
            <span className="eyebrow">
              {isListed(record.address) ? "Listed trust" : "Trust"} · Studionet
            </span>
            <h1 style={{ fontSize: "clamp(1.9rem, 4vw, 2.8rem)" }}>{record.name}</h1>
            <p className="data muted wrap" style={{ marginTop: 8, marginBottom: 0 }}>
              {record.address}
            </p>
            <p style={{ marginTop: 8, marginBottom: 0 }}>
              <a
                href={addressOnExplorer(record.address)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open on the explorer
              </a>
            </p>
          </div>
          <div style={{ display: "grid", gap: 10, justifyItems: "end" }}>
            {/* The wallet now lives in the header, on every page, because connecting is
                not a property of one trust. This slot keeps the seal, which is about
                *this* trust: whether its constitution view and state view agree. */}
            <div className="seal">
              {consistent ? record.status : "unverified"}
              {consistent ? ` · cycle ${record.cycle}` : ""}
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        {consistent ? (
          <div className="notice good">
            {gen(record.treasury)} GEN held · runway {record.runway} cycles · last
            action {record.lastAction} · next tick {utc(record.nextTickAt)}
          </div>
        ) : (
          <div className="notice bad">
            <strong>This is not the code the reader expects.</strong> The constitution
            view and the state view disagree about the hard limits, which means the
            deployed bytecode is not the code this reader was written against. Treat
            every figure below as unverified and do not act on it.
          </div>
        )}

        {record.degraded ? (
          <div className="notice warn" style={{ marginTop: 12 }}>
            <strong>Some views could not be read.</strong> They are shown empty rather
            than guessed: <code className="wrap">{record.degraded}</code>
          </div>
        ) : null}
      </section>

      <hr className="rule" style={{ margin: "34px 0 26px" }} />

      <div className="columns">
        <aside className="stack" aria-label="The trust's standing">
          <Conservation flow={record.flow} />
          <div className="panel">
            <h3>Constitution</h3>
            <ConstitutionGauges state={record.state} />
            <ConstitutionFacts record={record} />
          </div>
          <div className="panel">
            <h3>Keeper</h3>
            <KeeperActions trust={record.address} treasury={gen(record.treasury)} />
          </div>
          <div className="panel">
            <h3>Membership</h3>
            <Membership
              members={record.members}
              totalShares={record.state.total_shares}
              ceiling={gen(record.policy.spend_ceiling_atto ?? "0")}
            />
          </div>
          <div className="panel">
            <h3>Rulebook</h3>
            <Rulebook rules={record.rules} cited={cited} />
          </div>
          <div className="panel">
            <h3>Charter</h3>
            <Charter charter={record.charter} version={record.charterVersion} />
          </div>
        </aside>

        <section aria-label="Decisions">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
              marginBottom: 18,
            }}
          >
            <h2 style={{ fontSize: "1.5rem" }}>
              {record.proposals.length} decision
              {record.proposals.length === 1 ? "" : "s"}
            </h2>
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              newest first, each with the committee&apos;s own reasoning
            </span>
          </div>
          <DecisionList
            proposals={record.proposals}
            audits={record.audits}
            state={record.state}
            members={record.members}
          />
        </section>
      </div>

      <section style={{ marginTop: 48 }}>
        <div className="panel">
          <h3>Read another trust</h3>
          <p className="muted">
            Any address deployed from this contract. Listed ones are on{" "}
            <Link href="/trusts">the directory</Link>.
          </p>
          <AddressForm label="Trust address" />
        </div>
      </section>
    </main>
  );
}
